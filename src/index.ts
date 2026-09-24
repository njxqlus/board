import { randomUUID } from "node:crypto";
import { serve } from "bun";
import { z } from "zod";
import index from "./index.html";
import { auth } from "./lib/auth";
import { sql } from "./lib/db";
import { handleRemoteMcp } from "./mcp/http";
import {
	addComment,
	addMember,
	archiveBoard,
	BoardError,
	cleanupStatus,
	command,
	createBoard,
	createCommentThread,
	deleteBoard,
	deleteComment,
	getProject,
	lifecycleOperation,
	listBoards,
	listCommentThreads,
	members,
	operationStatus,
	removeMember,
	renameBoard,
	snapshot,
} from "./server/board";
import { drainMediaCleanup } from "./server/cleanup";
import {
	actor,
	assertMutationOrigin,
	assertWebSocketOrigin,
	body,
	fail,
	production,
	productionClientResponse,
	rateLimitSource,
} from "./server/http";
import {
	actorFromMcpToken,
	createMcpKey,
	issueMcpSession,
	listMcpKeys,
	revokeMcpKey,
	revokeMcpSession,
} from "./server/mcp-auth";
import {
	discardUnattachedMedia,
	duplicateMedia,
	proxy,
	upload,
} from "./server/media";
import {
	assertRateLimit,
	checkRateLimit,
	recordRateLimitAttempt,
} from "./server/rate-limit";
import { broadcast, disconnectBoard, websocket } from "./server/realtime";

const server = serve<{
	projectId: string;
	userId: string;
	email: string;
	clientId: string;
}>({
	port: Number(process.env.PORT ?? 3000),
	hostname: process.env.HOST ?? "0.0.0.0",
	maxRequestBodySize: 32 * 1024 * 1024,
	routes: production
		? undefined
		: {
				"/": index,
				"/board/*": index,
			},
	development: process.env.NODE_ENV !== "production" && {
		hmr: true,
		console: true,
	},
	websocket,
	fetch: async (req, server) => {
		const url = new URL(req.url);
		try {
			if (url.pathname === "/mcp") {
				checkRateLimit(
					`mcp-http:${rateLimitSource(req, server.requestIP(req)?.address)}`,
					300,
				);
				return await handleRemoteMcp(req, {
					origin: new URL(process.env.BETTER_AUTH_URL ?? url.origin).origin,
					authenticate: async (header) =>
						Boolean(await actorFromMcpToken(header)),
					dispatch: async (request) => await server.fetch(request),
				});
			}
			if (url.pathname === "/api/mcp/keys") {
				const currentActor = await actor(req);
				assertMutationOrigin(req, currentActor);
				const headers = { "cache-control": "no-store" };
				if (req.method === "GET")
					return Response.json(await listMcpKeys(currentActor), { headers });
				if (req.method === "POST")
					return Response.json(await createMcpKey(currentActor), {
						status: 201,
						headers,
					});
				if (req.method === "DELETE") {
					const value = z.object({ id: z.uuid() }).parse(await body(req));
					return Response.json(await revokeMcpKey(currentActor, value.id), {
						headers,
					});
				}
				return new Response(null, {
					status: 405,
					headers: { allow: "GET, POST, DELETE" },
				});
			}
			if (url.pathname === "/health/live")
				return Response.json({ status: "ok" });
			if (url.pathname === "/health/ready") {
				const schema = await sql<{ projects: string | null }[]>`
					select to_regclass('public.projects')::text as projects
				`;
				if (!schema[0]?.projects)
					throw new BoardError(503, "Database schema is not ready");
				return Response.json({ status: "ok", database: "ok" });
			}
			if (url.pathname.startsWith("/api/auth/")) {
				const authHeaders = new Headers(req.headers);
				authHeaders.set(
					"x-board-auth-ip",
					rateLimitSource(req, server.requestIP(req)?.address),
				);
				const authRequest = new Request(req, { headers: authHeaders });
				if (url.pathname.includes("sign-in") && req.method === "POST") {
					checkRateLimit(
						`browser:${rateLimitSource(req, server.requestIP(req)?.address)}`,
						30,
					);
					const credentials = (await authRequest
						.clone()
						.json()
						.catch(() => null)) as {
						email?: unknown;
					} | null;
					const email =
						typeof credentials?.email === "string"
							? credentials.email.trim().toLowerCase()
							: "invalid";
					assertRateLimit(`browser-account:${email}`, 5);
					const response = await auth.handler(authRequest);
					if (!response.ok) recordRateLimitAttempt(`browser-account:${email}`);
					return response;
				}
				return auth.handler(authRequest);
			}
			if (url.pathname === "/api/mcp/session" && req.method === "POST") {
				checkRateLimit(
					`mcp-ip:${rateLimitSource(req, server.requestIP(req)?.address)}`,
					30,
				);
				const value = z
					.object({ email: z.email(), password: z.string().min(1).max(1024) })
					.parse(await body(req));
				const email = value.email.trim().toLowerCase();
				assertRateLimit(`mcp:${email}`, 5);
				try {
					return Response.json(
						await issueMcpSession(
							value.email,
							value.password,
							url,
							rateLimitSource(req, server.requestIP(req)?.address),
						),
					);
				} catch (error) {
					recordRateLimitAttempt(`mcp:${email}`);
					throw error;
				}
			}
			if (url.pathname === "/api/mcp/session" && req.method === "DELETE")
				return Response.json(
					await revokeMcpSession(req.headers.get("authorization")),
				);
			if (url.pathname === "/api/health") {
				await sql`select 1`;
				return Response.json({ status: "ok", database: "ok" });
			}
			if (url.pathname === "/api/me" && req.method === "GET") {
				const currentActor = await actor(req);
				return Response.json({
					id: currentActor.id,
					email: currentActor.email,
					channel: currentActor.channel ?? "browser",
				});
			}
			if (url.pathname === "/api/boards" && req.method === "GET")
				return Response.json(
					await listBoards(
						await actor(req),
						url.searchParams.get("state") ?? undefined,
					),
				);
			if (url.pathname === "/api/boards" && req.method === "POST") {
				const value = (await body(req)) as {
					title?: string;
					operationId?: string;
				};
				const currentActor = await actor(req);
				assertMutationOrigin(req, currentActor);
				return Response.json(
					await lifecycleOperation(
						currentActor,
						value.operationId,
						{ type: "board.create", title: value.title ?? "Untitled board" },
						(db) => createBoard(currentActor, value.title, db),
					),
					{
						status: 201,
					},
				);
			}
			const mediaDuplicateMatch = url.pathname.match(
				/^\/api\/boards\/([0-9a-f-]{36})\/media\/([0-9a-f-]{36})\/duplicate$/i,
			);
			if (mediaDuplicateMatch && req.method === "POST") {
				const boardId = mediaDuplicateMatch[1];
				const assetId = mediaDuplicateMatch[2];
				if (!boardId || !assetId)
					throw new BoardError(404, "Media not found", "NOT_FOUND");
				const currentActor = await actor(req);
				assertMutationOrigin(req, currentActor);
				return Response.json(
					await duplicateMedia(currentActor, boardId, assetId),
					{ status: 201 },
				);
			}
			const mediaReplaceMatch = url.pathname.match(
				/^\/api\/boards\/([0-9a-f-]{36})\/media\/([0-9a-f-]{36})\/replace$/i,
			);
			if (mediaReplaceMatch && req.method === "POST") {
				const boardId = mediaReplaceMatch[1];
				const previousAssetId = mediaReplaceMatch[2];
				if (!boardId || !previousAssetId)
					throw new BoardError(404, "Media not found", "NOT_FOUND");
				const currentActor = await actor(req);
				assertMutationOrigin(req, currentActor);
				const form = await req.formData();
				const file = form.get("file");
				const objectId = form.get("objectId");
				const operationId = form.get("operationId");
				const expectedVersion = Number(form.get("expectedVersion"));
				const confirmed = form.get("confirmIrreversible") === "true";
				if (
					!(file instanceof File) ||
					typeof objectId !== "string" ||
					typeof operationId !== "string" ||
					!Number.isInteger(expectedVersion) ||
					!confirmed
				)
					throw new BoardError(
						400,
						"File, objectId, expectedVersion, operationId, and irreversible confirmation are required",
						"VALIDATION_ERROR",
					);
				const object = (
					await sql<{ data: { assetId?: string } }[]>`
						select data from board_objects where id=${objectId} and project_id=${boardId}
					`
				)[0];
				if (object?.data.assetId !== previousAssetId)
					throw new BoardError(404, "Media object not found", "NOT_FOUND");
				const uploadForm = new FormData();
				uploadForm.set("file", file, file.name);
				const replacement = await upload(
					currentActor,
					boardId,
					new Request(url, { method: "POST", body: uploadForm }),
				);
				try {
					const result = await command(currentActor, boardId, {
						operationId,
						type: "objects.update",
						confirmIrreversible: true,
						changes: [
							{
								id: objectId,
								expectedVersion,
								patch: { assetId: replacement.assetId },
							},
						],
					});
					broadcast(boardId, {
						type: "board.changed",
						result,
						actorId: currentActor.id,
					});
					void drainMediaCleanup();
					return Response.json({ replacement, result });
				} catch (error) {
					await discardUnattachedMedia(boardId, replacement.assetId);
					void drainMediaCleanup();
					throw error;
				}
			}
			const mediaMatch = url.pathname.match(
				/^\/api\/boards\/([0-9a-f-]{36})\/media(?:\/([0-9a-f-]{36}))?$/i,
			);
			if (mediaMatch) {
				const boardId = mediaMatch[1];
				if (!boardId) throw new BoardError(404, "Board not found", "NOT_FOUND");
				if (req.method === "POST" && !mediaMatch[2]) {
					const currentActor = await actor(req);
					assertMutationOrigin(req, currentActor);
					return Response.json(await upload(currentActor, boardId, req), {
						status: 201,
					});
				}
				if ((req.method === "GET" || req.method === "HEAD") && mediaMatch[2])
					return proxy(
						await actor(req),
						boardId,
						mediaMatch[2],
						req.method,
						req.headers.get("range"),
					);
				if (req.method === "DELETE" && mediaMatch[2]) {
					const currentActor = await actor(req);
					assertMutationOrigin(req, currentActor);
					await getProject(currentActor, boardId, true);
					const discarded = await discardUnattachedMedia(
						boardId,
						mediaMatch[2],
					);
					void drainMediaCleanup();
					return Response.json({ discarded });
				}
			}
			const commentsMatch = url.pathname.match(
				/^\/api\/boards\/([0-9a-f-]{36})\/comments(?:\/threads(?:\/([0-9a-f-]{36})(?:\/messages\/([0-9a-f-]{36}))?)?)?$/i,
			);
			if (commentsMatch) {
				const boardId = commentsMatch[1];
				const threadId = commentsMatch[2];
				const commentId = commentsMatch[3];
				if (!boardId) throw new BoardError(404, "Board not found", "NOT_FOUND");
				const currentActor = await actor(req);
				assertMutationOrigin(req, currentActor);
				if (req.method === "GET" && !threadId)
					return Response.json(await listCommentThreads(currentActor, boardId));
				if (req.method === "POST" && !threadId) {
					const thread = await createCommentThread(
						currentActor,
						boardId,
						await body(req),
					);
					broadcast(boardId, { type: "comments.changed", threadId: thread.id });
					return Response.json(thread, { status: 201 });
				}
				if (req.method === "POST" && threadId) {
					const comment = await addComment(
						currentActor,
						boardId,
						threadId,
						await body(req),
					);
					broadcast(boardId, { type: "comments.changed", threadId });
					return Response.json(comment, { status: 201 });
				}
				if (req.method === "DELETE" && threadId && commentId) {
					const result = await deleteComment(
						currentActor,
						boardId,
						threadId,
						commentId,
					);
					broadcast(boardId, { type: "comments.changed", threadId });
					return Response.json(result);
				}
				return new Response(null, {
					status: 405,
					headers: { allow: "GET, POST, DELETE" },
				});
			}
			const match = url.pathname.match(
				/^\/api\/boards\/([0-9a-f-]{36})(?:\/(snapshot|commands|members|rename|archive|delete|operations|cleanup-status|ws))?$/i,
			);
			if (match) {
				const id = match[1];
				if (!id) throw new BoardError(404, "Board not found", "NOT_FOUND");
				const action = match[2];
				const a = await actor(req);
				assertMutationOrigin(req, a);
				if (action === "ws") {
					assertWebSocketOrigin(req, a);
					await getProject(a, id);
					return server.upgrade(req, {
						data: {
							projectId: id,
							userId: a.id,
							email: a.email,
							clientId: a.clientId ?? randomUUID(),
						},
					})
						? undefined
						: new Response("Upgrade failed", { status: 500 });
				}
				if ((!action || action === "snapshot") && req.method === "GET")
					return Response.json(await snapshot(a, id));
				if (action === "commands" && req.method === "POST") {
					const result = await command(a, id, (await body(req)) as never);
					broadcast(id, { type: "board.changed", result, actorId: a.id });
					void drainMediaCleanup().catch((error) =>
						console.error(
							"Media cleanup failed",
							error instanceof Error ? error.message : "unknown error",
						),
					);
					return Response.json(result);
				}
				if (action === "operations" && req.method === "GET") {
					const operationId = url.searchParams.get("operationId");
					if (!operationId)
						throw new BoardError(400, "operationId is required");
					return Response.json(await operationStatus(a, id, operationId));
				}
				if (action === "cleanup-status" && req.method === "GET")
					return Response.json(await cleanupStatus(a, id));
				if (action === "rename" && req.method === "POST") {
					const value = (await body(req)) as {
						title: string;
						operationId?: string;
					};
					return Response.json(
						await lifecycleOperation(
							a,
							value.operationId,
							{ type: "board.rename", id, title: value.title },
							(db) => renameBoard(a, id, value.title, db),
						),
					);
				}
				if (action === "members" && req.method === "POST")
					return Response.json(
						await addMember(
							a,
							id,
							((await body(req)) as { email: string }).email,
						),
					);
				if (action === "members" && req.method === "GET")
					return Response.json(await members(a, id));
				if (action === "members" && req.method === "DELETE")
					return Response.json(
						await removeMember(
							a,
							id,
							((await body(req)) as { userId: string }).userId,
						),
					);
				if (action === "archive" && req.method === "POST") {
					const value = (await body(req)) as {
						archived: boolean;
						operationId?: string;
					};
					return Response.json(
						await lifecycleOperation(
							a,
							value.operationId,
							{ type: "board.archive", id, archived: value.archived },
							(db) => archiveBoard(a, id, value.archived, db),
						),
					);
				}
				if (action === "delete" && req.method === "POST") {
					const value = (await body(req)) as {
						confirmTitle: string;
						confirmIrreversible: boolean;
						operationId?: string;
					};
					const result = await lifecycleOperation(
						a,
						value.operationId,
						{
							type: "board.delete",
							id,
							confirmTitle: value.confirmTitle,
							confirmIrreversible: value.confirmIrreversible,
						},
						(db) =>
							deleteBoard(
								a,
								id,
								value.confirmTitle,
								value.confirmIrreversible,
								db,
							),
					);
					disconnectBoard(id);
					void drainMediaCleanup().catch((error) =>
						console.error(
							"Media cleanup failed",
							error instanceof Error ? error.message : "unknown error",
						),
					);
					return Response.json(result, { status: 202 });
				}
			}
			if (url.pathname.startsWith("/api/"))
				throw new BoardError(404, "API route not found", "NOT_FOUND");
			if (production) return productionClientResponse(url);
			return new Response("Not found", { status: 404 });
		} catch (error) {
			return fail(error);
		}
	},
});
console.log(`Board server listening on ${server.url}`);
const cleanupTimer = setInterval(
	() =>
		void drainMediaCleanup().catch((error) =>
			console.error(
				"Media cleanup failed",
				error instanceof Error ? error.message : "unknown error",
			),
		),
	60_000,
);
const shutdown = () => {
	clearInterval(cleanupTimer);
	server.stop(true);
};
process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
