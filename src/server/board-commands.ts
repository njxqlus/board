import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { sql } from "../lib/db";
import {
	commandSchema,
	connectorInputSchema,
	LIMITS,
	objectInputSchema,
	pointSchema,
} from "../shared/board-schema";
import { getProject } from "./authorization";
import { type Actor, BoardError, type StoredObject } from "./board-context";
import { foreignLease } from "./realtime";
export async function command(
	actor: Actor,
	projectId: string,
	input: {
		operationId: string;
		type: string;
		changes: unknown[];
		confirmIrreversible?: boolean;
	},
) {
	input = commandSchema.parse(input);
	await getProject(actor, projectId, true);
	if (
		["objects.update", "objects.delete", "objects.duplicate"].includes(
			input.type,
		)
	) {
		const leaseConflict = foreignLease(
			projectId,
			actor.id,
			input.changes.flatMap((change) =>
				change &&
				typeof change === "object" &&
				typeof (change as { id?: unknown }).id === "string"
					? [(change as { id: string }).id]
					: [],
			),
			actor.clientId,
		);
		if (leaseConflict)
			throw new BoardError(
				409,
				"Object is being edited by a collaborator",
				"LEASE_CONFLICT",
			);
	}
	const hash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
	return sql.begin(async (tx) => {
		// Serialize before looking up receipts: simultaneous retries must see the
		// first commit, not both attempt the same insert.
		await tx`select id from projects where id=${projectId} for update`;
		await getProject(actor, projectId, true, tx);
		const receipts = await tx<
			{ request_hash: string; result: unknown }[]
		>`select request_hash,result from command_receipts where project_id=${projectId} and actor_id=${actor.id} and operation_id=${input.operationId}`;
		if (receipts[0]) {
			if (receipts[0].request_hash !== hash)
				throw new BoardError(
					409,
					"Operation ID was reused with a different payload",
					"IDEMPOTENCY_CONFLICT",
				);
			return receipts[0].result;
		}
		const upserts: unknown[] = [];
		const deleted: string[] = [];
		if (input.type === "objects.create")
			for (const raw of input.changes) {
				const value = objectInputSchema.parse(raw);
				const id = value.id ?? randomUUID();
				if (value.parentId) {
					if (["frame", "group"].includes(value.kind))
						throw new BoardError(
							409,
							"Containers cannot be nested",
							"INVALID_PARENT",
						);
					const parent = (
						await tx<
							{
								kind: string;
								parent_id: string | null;
								grandparent_kind: string | null;
							}[]
						>`select parent.kind,parent.parent_id,grandparent.kind as grandparent_kind from board_objects parent left join board_objects grandparent on grandparent.id=parent.parent_id where parent.id=${value.parentId} and parent.project_id=${projectId}`
					)[0];
					if (
						!parent ||
						(parent.kind !== "group" && parent.kind !== "frame") ||
						(parent.parent_id &&
							!(parent.kind === "frame" && parent.grandparent_kind === "group"))
					)
						throw new BoardError(
							409,
							"Parent must be a top-level frame or group on this board",
							"INVALID_PARENT",
						);
				}
				if (["image", "video", "audio"].includes(value.kind)) {
					const assetId = (value.data as { assetId: string }).assetId;
					const asset = (
						await tx<
							{ id: string; object_id: string | null }[]
						>`select id,object_id from media_assets where id=${assetId} and project_id=${projectId} and state='ready' for update`
					)[0];
					if (!asset)
						throw new BoardError(
							404,
							"Media asset not found",
							"MEDIA_NOT_FOUND",
						);
					if (asset.object_id)
						throw new BoardError(
							409,
							"A media asset can only belong to one board object",
							"MEDIA_ALREADY_ATTACHED",
						);
				}
				await tx`insert into board_objects ${tx({ id, project_id: projectId, kind: value.kind, x: value.x, y: value.y, width: value.width, height: value.height, z_index: value.zIndex ?? 0, parent_id: value.parentId ?? null, data: { ...value.data, style: value.style ?? {} }, created_by: actor.id, updated_by: actor.id })}`;
				if (["image", "video", "audio"].includes(value.kind))
					await tx`update media_assets set object_id=${id} where id=${(value.data as { assetId: string }).assetId}`;
				upserts.push({ ...value, id, version: 1 });
			}
		else if (input.type === "objects.update")
			for (const raw of input.changes as Array<{
				id: string;
				expectedVersion: number;
				patch: Record<string, unknown>;
			}>) {
				const current = (
					await tx<
						StoredObject[]
					>`select id,kind,parent_id,x,y,width,height,z_index,data,version from board_objects where id=${raw.id} and project_id=${projectId} for update`
				)[0];
				if (!current) throw new BoardError(404, "Object not found");
				if (current.version !== raw.expectedVersion)
					throw new BoardError(
						409,
						"Object changed by a collaborator",
						"VERSION_CONFLICT",
					);
				const patch = { ...current.data, ...raw.patch };
				const parsed = objectInputSchema.parse({
					id: current.id,
					kind: current.kind,
					x: raw.patch.x ?? current.x,
					y: raw.patch.y ?? current.y,
					width: raw.patch.width ?? current.width,
					height: raw.patch.height ?? current.height,
					parentId:
						raw.patch.parentId === undefined
							? current.parent_id
							: raw.patch.parentId,
					zIndex: raw.patch.zIndex ?? current.z_index,
					data: patch,
					style:
						raw.patch.style === undefined
							? current.data.style
							: {
									...((current.data.style as Record<string, unknown>) ?? {}),
									...z.record(z.string(), z.unknown()).parse(raw.patch.style),
								},
				});
				if (parsed.parentId) {
					if (
						parsed.parentId === raw.id ||
						["frame", "group"].includes(parsed.kind)
					)
						throw new BoardError(
							409,
							"Invalid container parent",
							"INVALID_PARENT",
						);
					const parent = (
						await tx<
							{
								kind: string;
								parent_id: string | null;
								grandparent_kind: string | null;
							}[]
						>`select parent.kind,parent.parent_id,grandparent.kind as grandparent_kind from board_objects parent left join board_objects grandparent on grandparent.id=parent.parent_id where parent.id=${parsed.parentId} and parent.project_id=${projectId}`
					)[0];
					if (
						!parent ||
						(parent.kind !== "group" && parent.kind !== "frame") ||
						(parent.parent_id &&
							!(parent.kind === "frame" && parent.grandparent_kind === "group"))
					)
						throw new BoardError(
							409,
							"Invalid container parent",
							"INVALID_PARENT",
						);
				}
				if (["image", "video", "audio"].includes(current.kind)) {
					const previousAssetId = (current.data as { assetId?: string })
						.assetId;
					const nextAssetId = (parsed.data as { assetId?: string }).assetId;
					if (!previousAssetId || !nextAssetId)
						throw new BoardError(
							409,
							"Media asset is required",
							"MEDIA_NOT_FOUND",
						);
					if (previousAssetId !== nextAssetId) {
						if (!input.confirmIrreversible)
							throw new BoardError(
								409,
								"Media replacement requires irreversible confirmation",
								"MEDIA_CONFIRMATION_REQUIRED",
							);
						const nextAsset = (
							await tx<
								{ id: string; object_id: string | null }[]
							>`select id,object_id from media_assets where id=${nextAssetId} and project_id=${projectId} and state='ready' for update`
						)[0];
						if (!nextAsset || nextAsset.object_id)
							throw new BoardError(
								409,
								"Replacement media asset is unavailable",
								"MEDIA_NOT_FOUND",
							);
						const previousAsset = (
							await tx<
								{ dam_id: string }[]
							>`select dam_id from media_assets where id=${previousAssetId} and project_id=${projectId} for update`
						)[0];
						if (previousAsset) {
							await tx`update media_assets set state='deleting',object_id=null where id=${previousAssetId}`;
							await tx`insert into media_jobs ${tx({ id: randomUUID(), project_id: projectId, asset_id: previousAssetId, operation: "delete", dam_id: previousAsset.dam_id })}`;
						}
						await tx`update media_assets set object_id=${raw.id} where id=${nextAssetId}`;
					}
				}
				if (
					["frame", "group"].includes(current.kind) &&
					raw.patch.width === undefined &&
					raw.patch.height === undefined &&
					(parsed.x !== current.x || parsed.y !== current.y)
				) {
					const delta = { x: parsed.x - current.x, y: parsed.y - current.y };
					const children = await tx<StoredObject[]>`
						with recursive descendant_ids as (
							select id from board_objects where project_id=${projectId} and parent_id=${current.id}
							union all
							select object.id from board_objects object join descendant_ids on object.parent_id=descendant_ids.id
						)
						select id,kind,parent_id,x,y,width,height,z_index,data,version
						from board_objects where id in (select id from descendant_ids) for update
					`;
					const leaseConflict = foreignLease(
						projectId,
						actor.id,
						children.map((child) => child.id),
						actor.clientId,
					);
					if (leaseConflict)
						throw new BoardError(
							409,
							"A contained object is being edited by a collaborator",
							"LEASE_CONFLICT",
						);
					for (const child of children) {
						const x = child.x + delta.x;
						const y = child.y + delta.y;
						objectInputSchema.parse({
							id: child.id,
							kind: child.kind,
							x,
							y,
							width: child.width,
							height: child.height,
							parentId: child.parent_id,
							zIndex: child.z_index,
							data: child.data,
						});
						await tx`update board_objects set x=${x},y=${y},version=version+1,updated_by=${actor.id},updated_at=now() where id=${child.id}`;
						upserts.push({
							id: child.id,
							kind: child.kind,
							x,
							y,
							width: child.width,
							height: child.height,
							data: child.data,
							version: child.version + 1,
						});
					}
				}
				const data = { ...parsed.data, style: parsed.style ?? {} };
				await tx`update board_objects set x=${parsed.x},y=${parsed.y},width=${parsed.width},height=${parsed.height},z_index=${parsed.zIndex ?? current.z_index},parent_id=${parsed.parentId ?? null},data=${data},version=version+1,updated_by=${actor.id},updated_at=now() where id=${raw.id}`;
				upserts.push({ ...parsed, data, version: current.version + 1 });
			}
		else if (input.type === "objects.delete") {
			// A batch may contain a container and one of its children. Do not bump
			// the child's version while detaching the container: the child is about
			// to be deleted by this same command with its original expected version.
			const deletingIds = new Set(
				(input.changes as Array<{ id: string }>).map((change) => change.id),
			);
			for (const raw of input.changes as Array<{
				id: string;
				expectedVersion: number;
			}>) {
				const current = (
					await tx<
						StoredObject[]
					>`select id,kind,parent_id,x,y,width,height,data,version from board_objects where id=${raw.id} and project_id=${projectId} for update`
				)[0];
				if (!current) continue;
				if (current.version !== raw.expectedVersion)
					throw new BoardError(
						409,
						"Object changed by a collaborator",
						"VERSION_CONFLICT",
					);
				if (
					["image", "video", "audio"].includes(current.kind) &&
					!input.confirmIrreversible
				)
					throw new BoardError(
						409,
						"Media deletion requires irreversible confirmation",
						"MEDIA_CONFIRMATION_REQUIRED",
					);
				const children = await tx<{ id: string }[]>`
					select id from board_objects
					where project_id=${projectId} and parent_id=${raw.id} for update
				`;
				for (const child of children)
					if (!deletingIds.has(child.id))
						await tx`update board_objects set parent_id=null,version=version+1,updated_by=${actor.id},updated_at=now() where id=${child.id}`;
				await tx`delete from board_objects where id=${raw.id}`;
				if (["image", "video", "audio"].includes(current.kind)) {
					const assetId = (current.data as { assetId?: string }).assetId;
					if (assetId) {
						const asset = (
							await tx<
								{ dam_id: string }[]
							>`select dam_id from media_assets where id=${assetId} and project_id=${projectId} for update`
						)[0];
						if (asset)
							await tx`update media_assets set state='deleting',object_id=null where id=${assetId}`;
						if (asset)
							await tx`insert into media_jobs ${tx({ id: randomUUID(), project_id: projectId, asset_id: assetId, operation: "delete", dam_id: asset.dam_id })}`;
					}
				}
				await tx`delete from board_connectors where project_id=${projectId} and (data->'source'->>'objectId'=${raw.id} or data->'target'->>'objectId'=${raw.id})`;
				deleted.push(raw.id);
			}
		} else if (input.type === "objects.group") {
			const request = z
				.object({
					group: objectInputSchema,
					children: z
						.array(
							z.object({
								id: z.uuid(),
								expectedVersion: z.number().int().positive(),
							}),
						)
						.min(1)
						.max(LIMITS.batch),
				})
				.parse(input.changes[0]);
			if (
				!["group", "frame"].includes(request.group.kind) ||
				request.group.parentId
			)
				throw new BoardError(409, "Invalid group", "INVALID_PARENT");
			const groupId = request.group.id ?? randomUUID();
			await tx`insert into board_objects ${tx({ id: groupId, project_id: projectId, kind: request.group.kind, x: request.group.x, y: request.group.y, width: request.group.width, height: request.group.height, z_index: request.group.zIndex ?? -1, data: { ...request.group.data, style: request.group.style ?? {} }, created_by: actor.id, updated_by: actor.id })}`;
			if (
				foreignLease(
					projectId,
					actor.id,
					request.children.map((child) => child.id),
					actor.clientId,
				)
			)
				throw new BoardError(
					409,
					"A selected object is being edited",
					"LEASE_CONFLICT",
				);
			upserts.push({ ...request.group, id: groupId, version: 1 });
			for (const childRequest of request.children) {
				const child = (
					await tx<StoredObject[]>`
						select id,kind,parent_id,x,y,width,height,z_index,data,version from board_objects where id=${childRequest.id} and project_id=${projectId} for update
					`
				)[0];
				if (!child) throw new BoardError(404, "Object not found");
				if (
					child.kind === "group" ||
					(child.kind === "frame" && child.parent_id)
				)
					throw new BoardError(
						409,
						"Nested containers cannot be grouped",
						"INVALID_PARENT",
					);
				if (child.version !== childRequest.expectedVersion)
					throw new BoardError(
						409,
						"Object changed by a collaborator",
						"VERSION_CONFLICT",
					);
				await tx`update board_objects set parent_id=${groupId},version=version+1,updated_by=${actor.id},updated_at=now() where id=${child.id}`;
				upserts.push({
					id: child.id,
					kind: child.kind,
					x: child.x,
					y: child.y,
					width: child.width,
					height: child.height,
					data: child.data,
					version: child.version + 1,
				});
			}
		} else if (input.type === "objects.duplicate") {
			const requests = z
				.array(
					z.object({
						id: z.uuid(),
						expectedVersion: z.number().int().positive(),
						offset: pointSchema.optional(),
					}),
				)
				.min(1)
				.max(LIMITS.batch)
				.parse(input.changes);
			const sourceById = new Map<string, StoredObject>();
			for (const request of requests) {
				const source = (
					await tx<
						StoredObject[]
					>`select id,kind,parent_id,x,y,width,height,z_index,data,version from board_objects where id=${request.id} and project_id=${projectId} for update`
				)[0];
				if (!source) throw new BoardError(404, "Object not found");
				if (source.version !== request.expectedVersion)
					throw new BoardError(
						409,
						"Object changed by a collaborator",
						"VERSION_CONFLICT",
					);
				if (["image", "video", "audio"].includes(source.kind))
					throw new BoardError(
						409,
						"Media objects require the dedicated media duplication flow",
						"MEDIA_DUPLICATION_REQUIRED",
					);
				sourceById.set(source.id, source);
			}
			const copiedIds = new Map(
				[...sourceById.keys()].map((sourceId) => [sourceId, randomUUID()]),
			);
			for (const request of requests) {
				const source = sourceById.get(request.id);
				if (!source) continue;
				const id = copiedIds.get(source.id);
				if (!id) continue;
				const offset = request.offset ?? { x: 24, y: 24 };
				await tx`insert into board_objects ${tx({ id, project_id: projectId, kind: source.kind, x: source.x + offset.x, y: source.y + offset.y, width: source.width, height: source.height, z_index: source.z_index + 1, parent_id: source.parent_id ? (copiedIds.get(source.parent_id) ?? source.parent_id) : null, data: source.data, created_by: actor.id, updated_by: actor.id })}`;
				upserts.push({
					id,
					kind: source.kind,
					x: source.x + offset.x,
					y: source.y + offset.y,
					width: source.width,
					height: source.height,
					data: source.data,
					version: 1,
				});
			}
			const connectors = await tx<
				{ data: unknown }[]
			>`select data from board_connectors where project_id=${projectId}`;
			for (const row of connectors) {
				const connector = connectorInputSchema.safeParse(row.data);
				if (!connector.success) continue;
				const source = connector.data.source;
				const target = connector.data.target;
				if (
					source.kind !== "attached" ||
					target.kind !== "attached" ||
					!copiedIds.has(source.objectId) ||
					!copiedIds.has(target.objectId)
				)
					continue;
				const id = randomUUID();
				const data = {
					...connector.data,
					id,
					source: { ...source, objectId: copiedIds.get(source.objectId) },
					target: { ...target, objectId: copiedIds.get(target.objectId) },
				};
				await tx`insert into board_connectors ${tx({ id, project_id: projectId, data, created_by: actor.id, updated_by: actor.id })}`;
				upserts.push({ ...data, version: 1 });
			}
		} else if (input.type === "connectors.create")
			for (const raw of input.changes) {
				const value = connectorInputSchema.parse(raw);
				const attachedIds = [value.source, value.target].flatMap((endpoint) =>
					endpoint.kind === "attached" ? [endpoint.objectId] : [],
				);
				for (const objectId of new Set(attachedIds)) {
					const found = (
						await tx<
							{ id: string }[]
						>`select id from board_objects where project_id=${projectId} and id=${objectId}`
					)[0];
					if (!found)
						throw new BoardError(
							404,
							"Connector endpoint object not found on this board",
							"ENDPOINT_NOT_FOUND",
						);
				}
				const id = value.id ?? randomUUID();
				await tx`insert into board_connectors ${tx({ id, project_id: projectId, data: value, created_by: actor.id, updated_by: actor.id })}`;
				upserts.push({ ...value, id, version: 1 });
			}
		else if (input.type === "connectors.update")
			for (const raw of input.changes as Array<{
				id: string;
				expectedVersion: number;
				patch: Record<string, unknown>;
			}>) {
				const current = (
					await tx<
						{ data: Record<string, unknown>; version: number }[]
					>`select data,version from board_connectors where id=${raw.id} and project_id=${projectId} for update`
				)[0];
				if (!current) throw new BoardError(404, "Connector not found");
				if (current.version !== raw.expectedVersion)
					throw new BoardError(
						409,
						"Connector changed by a collaborator",
						"VERSION_CONFLICT",
					);
				const value = connectorInputSchema.parse({
					...current.data,
					...raw.patch,
					id: raw.id,
				});
				const attachedIds = [value.source, value.target].flatMap((endpoint) =>
					endpoint.kind === "attached" ? [endpoint.objectId] : [],
				);
				for (const objectId of new Set(attachedIds)) {
					const found = (
						await tx<
							{ id: string }[]
						>`select id from board_objects where project_id=${projectId} and id=${objectId}`
					)[0];
					if (!found)
						throw new BoardError(
							404,
							"Connector endpoint object not found on this board",
							"ENDPOINT_NOT_FOUND",
						);
				}
				await tx`update board_connectors set data=${value},version=version+1,updated_by=${actor.id},updated_at=now() where id=${raw.id}`;
				upserts.push({ ...value, version: current.version + 1 });
			}
		else if (input.type === "connectors.delete")
			for (const raw of input.changes as Array<{
				id: string;
				expectedVersion: number;
			}>) {
				const connector = (
					await tx<
						{ version: number }[]
					>`select version from board_connectors where id=${raw.id} and project_id=${projectId} for update`
				)[0];
				if (!connector) continue;
				if (connector.version !== raw.expectedVersion)
					throw new BoardError(
						409,
						"Connector changed by a collaborator",
						"VERSION_CONFLICT",
					);
				await tx`delete from board_connectors where id=${raw.id} and project_id=${projectId}`;
				deleted.push(raw.id);
			}
		else throw new BoardError(400, "Unsupported command");
		const updated = (
			await tx<
				{ revision: string }[]
			>`update projects set revision=revision+1,updated_at=now() where id=${projectId} returning revision`
		)[0];
		const result = { revision: updated?.revision, upserts, deleted };
		await tx`insert into command_receipts ${tx({ project_id: projectId, actor_id: actor.id, operation_id: input.operationId, request_hash: hash, result, expires_at: new Date(Date.now() + 86_400_000) })}`;
		return result;
	});
}
