import { randomUUID } from "node:crypto";
import { dam } from "../lib/dam";
import { sql } from "../lib/db";
import { byteRange, readBounded } from "../shared/http-bytes";
import { normalizeMediaFile } from "../shared/media-file";
import { hasExpectedSignature } from "../shared/media-signature";
import { type Actor, BoardError, getProject } from "./board";

const max = Number(process.env.UPLOAD_MAX_BYTES ?? 31_457_280);
const accepted = new Set([
	"image/jpeg",
	"image/png",
	"image/webp",
	"image/gif",
	"image/avif",
	"video/mp4",
	"video/webm",
	"audio/mpeg",
	"audio/wav",
	"audio/ogg",
	"audio/mp4",
]);
const configuredParallelUploads = Number(process.env.MAX_PARALLEL_UPLOADS ?? 3);
const maxParallelUploads =
	Number.isInteger(configuredParallelUploads) &&
	configuredParallelUploads > 0 &&
	configuredParallelUploads <= 10
		? configuredParallelUploads
		: 3;
let activeUploads = 0;

async function withUploadSlot<T>(work: () => Promise<T>) {
	if (activeUploads >= maxParallelUploads)
		throw new BoardError(
			429,
			"All media upload slots are busy; retry shortly",
			"UPLOAD_BUSY",
		);
	activeUploads++;
	try {
		return await work();
	} finally {
		activeUploads--;
	}
}
export async function upload(
	actor: Actor,
	projectId: string,
	request: Request,
) {
	await getProject(actor, projectId, true);
	const form = await request.formData();
	const input = form.get("file");
	if (!(input instanceof File)) throw new BoardError(400, "A file is required");
	if (!input.size)
		throw new BoardError(
			400,
			"The file is empty; save the screenshot and try again",
		);
	if (input.size > max)
		throw new BoardError(413, "File exceeds the 30 MiB limit");
	const file = await normalizeMediaFile(input);
	if (!accepted.has(file.type))
		throw new BoardError(415, "Unsupported media type");
	if (!(await hasExpectedSignature(file)))
		throw new BoardError(415, "File signature does not match its media type");
	return withUploadSlot(async () => {
		const jobId = randomUUID();
		const assetId = randomUUID();
		await sql`insert into media_jobs ${sql({ id: jobId, project_id: projectId, asset_id: assetId, operation: "upload", state: "uploading" })}`;
		try {
			const asset = await dam.createAsset({
				file,
				filename: file.name,
				temporary: true,
				ttlSeconds: 3600,
				metadata: {
					application: "collaborative-board",
					instanceId: process.env.APP_INSTANCE_ID ?? "local",
					projectId,
					uploadId: jobId,
				},
			});
			await sql`update media_jobs set dam_id=${asset.id},updated_at=now() where id=${jobId}`;
			await dam.finalizeAsset(asset.id);
			let deletedDuringUpload = false;
			await sql.begin(async (tx) => {
				const project = (
					await tx<{ state: string }[]>`
					select state from projects where id=${projectId} for update
				`
				)[0];
				deletedDuringUpload = project?.state !== "active";
				await tx`insert into media_assets ${tx({ id: assetId, project_id: projectId, dam_id: asset.id, original_name: file.name, mime_type: file.type, byte_size: asset.size, state: deletedDuringUpload ? "deleting" : "ready" })}`;
				if (deletedDuringUpload)
					await tx`insert into media_jobs ${tx({ id: randomUUID(), project_id: projectId, asset_id: assetId, operation: "delete", dam_id: asset.id })}`;
				await tx`update media_jobs set state='complete',dam_id=${asset.id},updated_at=now() where id=${jobId}`;
			});
			if (deletedDuringUpload) {
				void import("./cleanup").then(({ drainMediaCleanup }) =>
					drainMediaCleanup(),
				);
				throw new BoardError(
					409,
					"Board is no longer available",
					"BOARD_DELETING",
				);
			}
			return { assetId, jobId, mimeType: file.type, size: asset.size };
		} catch (error) {
			if (error instanceof BoardError) throw error;
			await sql`update media_jobs set state='retry',last_error=${error instanceof Error ? error.message : "DAM upload failed"},updated_at=now() where id=${jobId}`;
			throw new BoardError(
				503,
				"Media service is unavailable; upload is queued for recovery",
				"MEDIA_UPSTREAM_UNAVAILABLE",
			);
		}
	});
}
export async function duplicateMedia(
	actor: Actor,
	projectId: string,
	assetId: string,
) {
	await getProject(actor, projectId, true);
	const source = (
		await sql<
			{
				dam_id: string;
				original_name: string;
				mime_type: string;
				byte_size: string;
			}[]
		>`select dam_id,original_name,mime_type,byte_size from media_assets where id=${assetId} and project_id=${projectId} and state='ready'`
	)[0];
	if (!source) throw new BoardError(404, "Media not found", "NOT_FOUND");
	if (Number(source.byte_size) > max)
		throw new BoardError(413, "Media exceeds the 30 MiB limit");
	return withUploadSlot(async () => {
		const download = await dam.getAssetFile(source.dam_id);
		const bytes = await download.response.arrayBuffer();
		if (bytes.byteLength > max)
			throw new BoardError(413, "Media exceeds the 30 MiB limit");
		const file = new File([bytes], source.original_name, {
			type: source.mime_type,
		});
		const jobId = randomUUID();
		const copyAssetId = randomUUID();
		await sql`insert into media_jobs ${sql({ id: jobId, project_id: projectId, asset_id: copyAssetId, operation: "duplicate", state: "uploading" })}`;
		try {
			const asset = await dam.createAsset({
				file,
				filename: source.original_name,
				temporary: true,
				ttlSeconds: 3600,
				metadata: {
					application: "collaborative-board",
					instanceId: process.env.APP_INSTANCE_ID ?? "local",
					projectId,
					copyOf: source.dam_id,
					uploadId: jobId,
				},
			});
			await sql`update media_jobs set dam_id=${asset.id},updated_at=now() where id=${jobId}`;
			await dam.finalizeAsset(asset.id);
			let deletedDuringUpload = false;
			await sql.begin(async (tx) => {
				const project = (
					await tx<{ state: string }[]>`
					select state from projects where id=${projectId} for update
				`
				)[0];
				deletedDuringUpload = project?.state !== "active";
				await tx`insert into media_assets ${tx({ id: copyAssetId, project_id: projectId, dam_id: asset.id, original_name: source.original_name, mime_type: asset.mime_type, byte_size: asset.size, state: deletedDuringUpload ? "deleting" : "ready" })}`;
				if (deletedDuringUpload)
					await tx`insert into media_jobs ${tx({ id: randomUUID(), project_id: projectId, asset_id: copyAssetId, operation: "delete", dam_id: asset.id })}`;
				await tx`update media_jobs set state='complete',dam_id=${asset.id},updated_at=now() where id=${jobId}`;
			});
			if (deletedDuringUpload) {
				void import("./cleanup").then(({ drainMediaCleanup }) =>
					drainMediaCleanup(),
				);
				throw new BoardError(
					409,
					"Board is no longer available",
					"BOARD_DELETING",
				);
			}
			return {
				assetId: copyAssetId,
				jobId,
				mimeType: asset.mime_type,
				size: asset.size,
			};
		} catch (error) {
			if (error instanceof BoardError) throw error;
			await sql`update media_jobs set state='retry',last_error=${error instanceof Error ? error.message : "DAM duplicate failed"},updated_at=now() where id=${jobId}`;
			throw new BoardError(
				503,
				"Media service is unavailable; duplication is queued for recovery",
				"MEDIA_UPSTREAM_UNAVAILABLE",
			);
		}
	});
}
export async function discardUnattachedMedia(
	projectId: string,
	assetId: string,
) {
	return sql.begin(async (tx) => {
		const asset = (
			await tx<
				{ dam_id: string }[]
			>`select dam_id from media_assets where id=${assetId} and project_id=${projectId} and object_id is null and state='ready' for update`
		)[0];
		if (!asset) return false;
		await tx`update media_assets set state='deleting' where id=${assetId}`;
		await tx`insert into media_jobs ${tx({ id: randomUUID(), project_id: projectId, asset_id: assetId, operation: "delete", dam_id: asset.dam_id })}`;
		return true;
	});
}
export async function proxy(
	actor: Actor,
	projectId: string,
	assetId: string,
	method: string,
	range?: string | null,
) {
	await getProject(actor, projectId);
	const rows = await sql<
		{ dam_id: string; mime_type: string; byte_size: string }[]
	>`select dam_id,mime_type,byte_size from media_assets where id=${assetId} and project_id=${projectId} and state='ready'`;
	const asset = rows[0];
	if (!asset) throw new BoardError(404, "Media not found", "NOT_FOUND");
	const downloaded = await dam.getAssetFile(asset.dam_id);
	const headers = new Headers({
		"content-type": asset.mime_type,
		"cache-control": "private, no-store",
		"x-content-type-options": "nosniff",
		"content-disposition": "inline",
		"accept-ranges": "bytes",
	});
	const length = Number(
		downloaded.response.headers.get("content-length") ?? asset.byte_size,
	);
	if (length) headers.set("content-length", String(length));
	if (method === "HEAD") {
		await downloaded.response.body?.cancel();
		return new Response(null, { headers });
	}
	if (!range) return new Response(downloaded.response.body, { headers });

	const bounds = byteRange(range, length);
	if (!bounds) {
		await downloaded.response.body?.cancel();
		return new Response(null, {
			status: 416,
			headers: {
				"content-range": `bytes */${length}`,
				"cache-control": "private, no-store",
			},
		});
	}
	const { start, end } = bounds;
	const bytes = (await readBounded(downloaded.response, 31_457_280)).slice(
		start,
		end + 1,
	);
	headers.set("content-range", `bytes ${start}-${end}/${length}`);
	headers.set("content-length", String(bytes.byteLength));
	return new Response(bytes, { status: 206, headers });
}
