import { sql } from "../lib/db";
import {
	type Actor,
	BoardError,
	type Database,
	type Project,
} from "./board-context";
export async function getProject(
	actor: Actor,
	id: string,
	write = false,
	db: Database = sql,
): Promise<Project> {
	const rows = await db<
		Project[]
	>`select p.id,p.title,p.owner_id,p.state,p.revision from projects p where p.id=${id}`;
	const project = rows[0];
	if (!project) throw new BoardError(404, "Board not found", "NOT_FOUND");
	if (project.owner_id !== actor.id) {
		const membership = await db<{ user_id: string }[]>`
			select user_id from project_members where project_id=${id} and user_id=${actor.id}
		`;
		if (!membership[0])
			throw new BoardError(
				403,
				"You do not have access to this board",
				"ACCESS_DENIED",
			);
	}
	if (project.state === "deleting")
		throw new BoardError(404, "Board not found", "NOT_FOUND");
	if (write && project.state !== "active")
		throw new BoardError(409, "This board is read-only", "BOARD_READ_ONLY");
	return project;
}
