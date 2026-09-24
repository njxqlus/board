import { randomUUID } from "node:crypto";
import { dam } from "../lib/dam";
import { sql } from "../lib/db";

type UploadJob = {
	id: string;
	project_id: string;
	asset_id: string;
	dam_id: string | null;
	operation: "upload" | "duplicate";
};

function isMissing(error: unknown) {
	return (
		typeof error === "object" &&
		error !== null &&
		"status" in error &&
		error.status === 404
	);
}

async function reconcileUpload(job: UploadJob) {
	let remote: Awaited<ReturnType<typeof dam.getAsset>> | undefined;
	if (job.dam_id) {
		try {
			remote = await dam.getAsset(job.dam_id);
		} catch (error) {
			if (isMissing(error)) return "missing" as const;
			throw error;
		}
	}
	if (!remote) {
		const listed = await dam.listAssets({
			limit: 10,
			metadata: {
				application: "collaborative-board",
				instanceId: process.env.APP_INSTANCE_ID ?? "local",
				projectId: job.project_id,
				uploadId: job.id,
			},
		});
		remote = listed.data[0];
	}
	if (!remote) return "pending" as const;
	if (remote.expires_at) remote = await dam.finalizeAsset(remote.id);
	const project = (
		await sql<{ state: "active" | "archived" | "deleting" }[]>`
			select state from projects where id=${job.project_id}
		`
	)[0];
	await sql.begin(async (tx) => {
		if (project?.state !== "active") {
			await tx`insert into media_assets ${tx({ id: job.asset_id, project_id: job.project_id, dam_id: remote.id, original_name: remote.original_filename, mime_type: remote.mime_type, byte_size: remote.size, state: "deleting" })} on conflict (id) do nothing`;
			await tx`insert into media_jobs ${tx({ id: randomUUID(), project_id: job.project_id, asset_id: job.asset_id, operation: "delete", dam_id: remote.id })}`;
		} else {
			await tx`insert into media_assets ${tx({ id: job.asset_id, project_id: job.project_id, dam_id: remote.id, original_name: remote.original_filename, mime_type: remote.mime_type, byte_size: remote.size, state: "ready" })} on conflict (id) do nothing`;
		}
		await tx`update media_jobs set state='complete',dam_id=${remote.id},updated_at=now() where id=${job.id}`;
	});
	return "reconciled" as const;
}

export async function drainMediaCleanup(limit = 25) {
	// A process can stop after DAM accepts a file but before our database commit.
	// Reconcile those jobs by their unique, persisted DAM metadata marker rather
	// than retrying createAsset and risking an orphaned duplicate.
	await sql`update media_jobs set state='retry',next_attempt_at=now(),updated_at=now() where operation in ('upload','duplicate') and state='uploading' and updated_at < now() - interval '1 minute'`;
	const uploads = await sql<UploadJob[]>`
		select id,project_id,asset_id,dam_id,operation from media_jobs
		where operation in ('upload','duplicate') and state='retry' and next_attempt_at <= now()
		order by next_attempt_at limit ${limit}
	`;
	for (const job of uploads) {
		try {
			const outcome = await reconcileUpload(job);
			if (outcome === "reconciled") continue;
			if (outcome === "missing") {
				await sql`update media_jobs set state='complete',last_error='DAM asset was already missing',updated_at=now() where id=${job.id}`;
				await sql`delete from media_assets where id=${job.asset_id}`;
				continue;
			}
			await sql`update media_jobs set attempts=attempts+1,next_attempt_at=now()+interval '5 minutes',last_error='Upload record was not found in DAM yet',updated_at=now() where id=${job.id}`;
		} catch (error) {
			await sql`update media_jobs set attempts=attempts+1,next_attempt_at=now()+interval '5 minutes',last_error=${error instanceof Error ? error.message : "DAM reconciliation failed"},updated_at=now() where id=${job.id}`;
		}
	}
	const unattached = await sql<
		{ id: string; project_id: string; dam_id: string }[]
	>`select a.id,a.project_id,a.dam_id from media_assets a where a.state='ready' and a.object_id is null and a.created_at < now() - interval '1 hour' and not exists (select 1 from media_jobs j where j.asset_id=a.id and j.state <> 'complete') limit ${limit}`;
	for (const asset of unattached) {
		await sql.begin(async (tx) => {
			const claimed = await tx<
				{ id: string }[]
			>`update media_assets set state='deleting' where id=${asset.id} and object_id is null and state='ready' returning id`;
			if (claimed[0])
				await tx`insert into media_jobs ${tx({ id: randomUUID(), project_id: asset.project_id, asset_id: asset.id, operation: "delete", dam_id: asset.dam_id })}`;
		});
	}
	const jobs = await sql<
		{ id: string; dam_id: string; asset_id: string | null }[]
	>`select id,dam_id,asset_id from media_jobs where operation='delete' and state in ('pending','retry') and next_attempt_at <= now() order by next_attempt_at limit ${limit}`;
	let completed = 0;
	for (const job of jobs) {
		try {
			await dam.deleteAsset(job.dam_id);
			await sql.begin(async (tx) => {
				await tx`update media_jobs set state='complete',updated_at=now() where id=${job.id}`;
				if (job.asset_id)
					await tx`delete from media_assets where id=${job.asset_id}`;
			});
			completed++;
		} catch (error) {
			const message = error instanceof Error ? error.message : "DAM failure";
			if (isMissing(error)) {
				await sql.begin(async (tx) => {
					await tx`update media_jobs set state='complete',updated_at=now() where id=${job.id}`;
					if (job.asset_id)
						await tx`delete from media_assets where id=${job.asset_id}`;
				});
				completed++;
			} else
				await sql`update media_jobs set state='retry',attempts=attempts+1,next_attempt_at=now()+interval '5 minutes',last_error=${message},updated_at=now() where id=${job.id}`;
		}
	}
	const deletable = await sql<
		{ id: string }[]
	>`select p.id from projects p where p.state='deleting' and not exists (select 1 from media_jobs j where j.project_id=p.id and j.state <> 'complete')`;
	for (const project of deletable) {
		await sql.begin(async (tx) => {
			await tx`delete from project_members where project_id=${project.id}`;
			await tx`delete from command_receipts where project_id=${project.id}`;
			await tx`delete from media_assets where project_id=${project.id}`;
			await tx`delete from media_jobs where project_id=${project.id}`;
			await tx`delete from projects where id=${project.id} and state='deleting'`;
		});
	}
	return {
		inspected: jobs.length + unattached.length + uploads.length,
		completed,
		finalizedProjects: deletable.length,
	};
}
