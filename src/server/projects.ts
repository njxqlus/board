import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { sql } from "../lib/db";
import { getProject } from "./authorization";
import { type Actor, BoardError, type Database } from "./board-context";
import { disconnectUser } from "./realtime";
/**
 * Deduplicate project lifecycle requests independently from board commands.
 * A transaction-scoped advisory lock makes concurrent retries serialize per
 * actor, while the durable receipt makes a later retry return the first result.
 */
export async function lifecycleOperation<T>(
	actor: Actor,
	operationId: string | undefined,
	payload: unknown,
	work: (db: Database) => Promise<T>,
): Promise<T> {
	if (!operationId) return work(sql);
	if (!z.string().uuid().safeParse(operationId).success)
		throw new BoardError(400, "operationId must be a UUID", "VALIDATION_ERROR");
	const requestHash = createHash("sha256")
		.update(JSON.stringify(payload))
		.digest("hex");
	return sql.begin(async (tx) => {
		await tx`select pg_advisory_xact_lock(hashtext(${actor.id}))`;
		const existing = await tx<
			{ request_hash: string; result: T }[]
		>`select request_hash,result from lifecycle_receipts where actor_id=${actor.id} and operation_id=${operationId} and expires_at > now()`;
		if (existing[0]) {
			if (existing[0].request_hash !== requestHash)
				throw new BoardError(
					409,
					"operationId was already used for a different request",
					"OPERATION_ID_REUSED",
				);
			return existing[0].result;
		}
		const result = await work(tx);
		await tx`insert into lifecycle_receipts ${tx({ actor_id: actor.id, operation_id: operationId, request_hash: requestHash, result, expires_at: new Date(Date.now() + 86_400_000) })}`;
		return result;
	});
}
export async function listBoards(actor: Actor, state?: string) {
	return sql`select p.id,p.title,p.state,p.revision,p.updated_at,(p.owner_id=${actor.id}) as owner from projects p where p.state <> 'deleting' and (p.owner_id=${actor.id} or exists(select 1 from project_members m where m.project_id=p.id and m.user_id=${actor.id})) ${state ? sql`and p.state=${state}` : sql``} order by p.updated_at desc`;
}
export async function snapshot(actor: Actor, projectId: string) {
	return sql.begin(async (tx) => {
		await tx`select id from projects where id=${projectId} for share`;
		const project = await getProject(actor, projectId, false, tx);
		const [objects, connectors] = await Promise.all([
			tx`select id,kind,x,y,width,height,z_index as "zIndex",parent_id as "parentId",data,version,created_by as "createdBy",updated_by as "updatedBy",created_at as "createdAt",updated_at as "updatedAt" from board_objects where project_id=${projectId} order by z_index`,
			tx`select id,data,version,created_at as "createdAt",updated_at as "updatedAt" from board_connectors where project_id=${projectId}`,
		]);
		return {
			schemaVersion: 1,
			project: { id: project.id, title: project.title, state: project.state },
			revision: project.revision,
			objects,
			connectors,
		};
	});
}
export async function operationStatus(
	actor: Actor,
	projectId: string,
	operationId: string,
) {
	await getProject(actor, projectId);
	const receipt = (
		await sql<
			{ result: unknown }[]
		>`select result from command_receipts where project_id=${projectId} and actor_id=${actor.id} and operation_id=${operationId} and expires_at > now()`
	)[0];
	if (!receipt)
		throw new BoardError(
			404,
			"Operation receipt not found",
			"OPERATION_NOT_FOUND",
		);
	return receipt.result;
}
export async function cleanupStatus(actor: Actor, projectId: string) {
	const project = (
		await sql<
			{ state: "active" | "archived" | "deleting"; owner_id: string }[]
		>`select state,owner_id from projects where id=${projectId} and (owner_id=${actor.id} or exists(select 1 from project_members m where m.project_id=projects.id and m.user_id=${actor.id}))`
	)[0];
	if (!project) throw new BoardError(404, "Board not found", "NOT_FOUND");
	const jobs = await sql<
		{ state: string; count: string }[]
	>`select state,count(*)::text as count from media_jobs where project_id=${projectId} and state <> 'complete' group by state`;
	return {
		state: project.state,
		cleanupPending: jobs.some((job) => Number(job.count) > 0),
		jobs: jobs.map((job) => ({ state: job.state, count: Number(job.count) })),
		canManage: project.owner_id === actor.id && actor.channel !== "mcp",
	};
}
export async function createBoard(
	actor: Actor,
	title = "Untitled board",
	db: Database = sql,
) {
	title = title.trim();
	if (!title || title.length > 120)
		throw new BoardError(400, "Title must be 1–120 characters");
	const id = randomUUID();
	await db`insert into projects ${db({ id, title, owner_id: actor.id })}`;
	return { id, title, state: "active", revision: "0" };
}
export async function renameBoard(
	actor: Actor,
	id: string,
	title: string,
	db: Database = sql,
) {
	const project = await getProject(actor, id, true, db);
	if (project.owner_id !== actor.id)
		throw new BoardError(403, "Only the owner can rename this board");
	title = title.trim();
	if (!title || title.length > 120)
		throw new BoardError(400, "Title must be 1–120 characters");
	await db`update projects set title=${title},updated_at=now() where id=${id}`;
	return { title };
}
export async function addMember(actor: Actor, id: string, email: string) {
	const project = await getProject(actor, id, true);
	if (project.owner_id !== actor.id || actor.channel === "mcp")
		throw new BoardError(403, "Membership management is not permitted");
	const users = await sql<
		{ id: string }[]
	>`select id from "user" where lower(email)=${email.trim().toLowerCase()}`;
	if (!users[0])
		throw new BoardError(
			404,
			"No account exists for that email",
			"ACCOUNT_NOT_FOUND",
		);
	await sql`insert into project_members ${sql({ project_id: id, user_id: users[0].id, added_by: actor.id })} on conflict do nothing`;
	return { added: true };
}
export async function members(actor: Actor, id: string) {
	if (actor.channel === "mcp")
		throw new BoardError(403, "Membership management is not permitted");
	await getProject(actor, id);
	return sql`select u.id,u.email,(p.owner_id=u.id) as owner from projects p join "user" u on u.id=p.owner_id where p.id=${id} union all select u.id,u.email,false as owner from project_members m join "user" u on u.id=m.user_id where m.project_id=${id} order by owner desc,email`;
}
export async function removeMember(actor: Actor, id: string, userId: string) {
	const project = await getProject(actor, id, true);
	if (project.owner_id !== actor.id || actor.channel === "mcp")
		throw new BoardError(403, "Membership management is not permitted");
	if (userId === project.owner_id)
		throw new BoardError(409, "The owner cannot be removed");
	await sql`delete from project_members where project_id=${id} and user_id=${userId}`;
	disconnectUser(id, userId);
	return { removed: true };
}
export async function archiveBoard(
	actor: Actor,
	id: string,
	archived: boolean,
	db: Database = sql,
) {
	const project = await getProject(actor, id, !archived, db);
	if (project.owner_id !== actor.id)
		throw new BoardError(403, "Only the owner can archive this board");
	await db`update projects set state=${archived ? "archived" : "active"},updated_at=now() where id=${id}`;
	return { state: archived ? "archived" : "active" };
}
export async function deleteBoard(
	actor: Actor,
	id: string,
	confirmTitle: string,
	confirmIrreversible: boolean,
	db: Database = sql,
): Promise<{ deleting: true }> {
	// Direct service callers retain atomic deletion; lifecycleOperation already
	// supplies its transaction so the receipt and deletion commit together.
	if (db === sql)
		return sql.begin((tx) =>
			deleteBoard(actor, id, confirmTitle, confirmIrreversible, tx),
		);
	const project = await getProject(actor, id, false, db);
	if (project.owner_id !== actor.id)
		throw new BoardError(403, "Only the owner can delete this board");
	if (!confirmIrreversible || confirmTitle !== project.title)
		throw new BoardError(
			409,
			"Deletion confirmation does not match this board",
			"DELETE_CONFIRMATION_REQUIRED",
		);
	await db`update projects set state='deleting' where id=${id}`;
	const assets = await db<
		{ id: string; dam_id: string }[]
	>`select id,dam_id from media_assets where project_id=${id}`;
	for (const asset of assets)
		await db`insert into media_jobs ${db({ id: randomUUID(), project_id: id, asset_id: asset.id, operation: "delete", dam_id: asset.dam_id })}`;
	await db`delete from board_connectors where project_id=${id}`;
	await db`delete from board_objects where project_id=${id}`;
	return { deleting: true };
}
