import { randomUUID } from "node:crypto";
import { z } from "zod";
import { sql } from "../lib/db";
import { pointSchema } from "../shared/board-schema";
import { getProject } from "./authorization";
import { type Actor, BoardError } from "./board-context";

const commentBody = z.string().trim().min(1).max(5_000);
const createThreadSchema = z.object({
	objectId: z.uuid().nullable().optional(),
	position: pointSchema,
	body: commentBody,
});

export type BoardComment = {
	id: string;
	body: string;
	authorId: string;
	authorEmail: string;
	createdAt: string;
};
export type CommentThread = {
	id: string;
	objectId: string | null;
	position: { x: number; y: number };
	createdBy: string;
	createdAt: string;
	comments: BoardComment[];
};

type ThreadRow = {
	id: string;
	objectId: string | null;
	x: number;
	y: number;
	createdBy: string;
	createdAt: string;
	comments: BoardComment[];
};

function threadFromRow(row: ThreadRow): CommentThread {
	return {
		id: row.id,
		objectId: row.objectId,
		position: { x: row.x, y: row.y },
		createdBy: row.createdBy,
		createdAt: row.createdAt,
		comments: row.comments ?? [],
	};
}

export async function listCommentThreads(actor: Actor, projectId: string) {
	await getProject(actor, projectId);
	const rows = await sql<ThreadRow[]>`
		select t.id,t.object_id as "objectId",t.x,t.y,t.created_by as "createdBy",t.created_at as "createdAt",
			coalesce(
				json_agg(json_build_object(
					'id',c.id,
					'body',c.body,
					'authorId',c.author_id,
					'authorEmail',u.email,
					'createdAt',c.created_at
				) order by c.created_at) filter (where c.id is not null),
				'[]'::json
			) as comments
		from board_comment_threads t
		left join board_comments c on c.thread_id=t.id
		left join "user" u on u.id=c.author_id
		where t.project_id=${projectId}
		group by t.id
		order by t.created_at
	`;
	return rows.map(threadFromRow);
}

export async function createCommentThread(
	actor: Actor,
	projectId: string,
	raw: unknown,
): Promise<CommentThread> {
	const input = createThreadSchema.parse(raw);
	return sql.begin(async (tx) => {
		await getProject(actor, projectId, true, tx);
		if (input.objectId) {
			const object = await tx<{ id: string }[]>`
				select id from board_objects where id=${input.objectId} and project_id=${projectId}
			`;
			if (!object[0])
				throw new BoardError(
					404,
					"Comment target was not found",
					"OBJECT_NOT_FOUND",
				);
		}
		const threadId = randomUUID();
		const commentId = randomUUID();
		const [thread] = await tx<
			Array<Omit<ThreadRow, "comments">>
		>`insert into board_comment_threads ${tx({ id: threadId, project_id: projectId, object_id: input.objectId ?? null, x: input.position.x, y: input.position.y, created_by: actor.id })}
			returning id,object_id as "objectId",x,y,created_by as "createdBy",created_at as "createdAt"`;
		const [comment] = await tx<BoardComment[]>`
			insert into board_comments ${tx({ id: commentId, thread_id: threadId, author_id: actor.id, body: input.body })}
			returning id,body,author_id as "authorId",${actor.email} as "authorEmail",created_at as "createdAt"`;
		if (!thread || !comment)
			throw new BoardError(500, "Unable to create comment");
		return threadFromRow({ ...thread, comments: [comment] });
	});
}

export async function addComment(
	actor: Actor,
	projectId: string,
	threadId: string,
	raw: unknown,
): Promise<BoardComment> {
	const body = z.object({ body: commentBody }).parse(raw).body;
	return sql.begin(async (tx) => {
		await getProject(actor, projectId, true, tx);
		const thread = await tx<{ id: string }[]>`
			select id from board_comment_threads where id=${threadId} and project_id=${projectId} for update
		`;
		if (!thread[0])
			throw new BoardError(
				404,
				"Comment thread was not found",
				"COMMENT_NOT_FOUND",
			);
		const [comment] = await tx<BoardComment[]>`
			insert into board_comments ${tx({ id: randomUUID(), thread_id: threadId, author_id: actor.id, body })}
			returning id,body,author_id as "authorId",${actor.email} as "authorEmail",created_at as "createdAt"`;
		if (!comment) throw new BoardError(500, "Unable to add comment");
		return comment;
	});
}
