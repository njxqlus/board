import {
	McpServer,
	ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
	connectorInputSchema,
	objectInputSchema,
} from "../shared/board-schema";
import { normalizeYouTubeVideoId } from "../shared/youtube";
import * as localClient from "./api-client";
import { permittedFile } from "./local-file";
import type { BoardClient } from "./remote-client";
import { remoteFile, remoteFileSchema } from "./remote-file";
export function createMcpServer(
	client: BoardClient = localClient,
	remote = false,
) {
	const { api, apiForm, binary } = client;
	const fileFields = remote
		? { file: remoteFileSchema, absoluteFilePath: z.never().optional() }
		: { file: remoteFileSchema.optional(), absoluteFilePath: z.string() };
	const readFile = async (input: {
		file?: z.infer<typeof remoteFileSchema>;
		absoluteFilePath?: string;
	}) => {
		if (remote) {
			if (!input.file)
				throw new Error("Inline file is required for remote MCP");
			return remoteFile(input.file);
		}
		if (!input.absoluteFilePath)
			throw new Error("absoluteFilePath is required");
		return permittedFile(input.absoluteFilePath);
	};
	const text = (value: unknown) => ({
		content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
	});
	const server = new McpServer(
		{
			name: "collaborative-board",
			version: "0.2.0",
		},
		{
			instructions:
				"Read board_get or object_get before editing; send current expectedVersion and a unique operationId for each mutation. Reuse that operationId only when retrying the same mutation. Text and tables use Tiptap JSON, not Markdown. Read board://{boardId}/schema for object formats. Ask the user before irreversible media or board deletion. Remote media tools accept inline base64 bytes, never server filesystem paths. Keys act with the user's board permissions; membership management is unavailable.",
		},
	);
	server.resource(
		"board-summary",
		new ResourceTemplate("board://{boardId}/summary", { list: undefined }),
		async (uri, { boardId }) => {
			const snapshot = (await api(`/api/boards/${boardId}/snapshot`)) as {
				project: unknown;
				revision: unknown;
				objects: unknown[];
				connectors: unknown[];
			};
			return {
				contents: [
					{
						uri: uri.href,
						text: JSON.stringify({
							schemaVersion: 1,
							project: snapshot.project,
							revision: snapshot.revision,
							objectCount: snapshot.objects.length,
							connectorCount: snapshot.connectors.length,
						}),
					},
				],
			};
		},
	);
	server.resource(
		"board-schema",
		new ResourceTemplate("board://{boardId}/schema", { list: undefined }),
		async (uri, { boardId }) => {
			await api(`/api/boards/${boardId}/snapshot`);
			return {
				contents: [
					{
						uri: uri.href,
						text: JSON.stringify({
							schemaVersion: 1,
							objectKinds: [
								"shape",
								"sticky",
								"card",
								"frame",
								"group",
								"text",
								"table",
								"freehand",
								"image",
								"video",
								"audio",
								"youtube",
							],
							endpointKinds: ["attached", "free"],
							objectSchema: z.toJSONSchema(objectInputSchema, { io: "input" }),
							connectorSchema: z.toJSONSchema(connectorInputSchema, {
								io: "input",
							}),
							textExample: {
								kind: "text",
								x: 100,
								y: 100,
								width: 400,
								height: 200,
								data: {
									content: {
										type: "doc",
										content: [
											{
												type: "paragraph",
												content: [{ type: "text", text: "Documentation" }],
											},
										],
									},
								},
							},
						}),
					},
				],
			};
		},
	);
	server.registerTool(
		"boards_list",
		{
			description: "List boards accessible to the authenticated user.",
			inputSchema: { state: z.enum(["active", "archived"]).optional() },
		},
		async ({ state }) =>
			text(await api(`/api/boards${state ? `?state=${state}` : ""}`)),
	);
	server.registerTool(
		"board_get",
		{
			description: "Read a board snapshot with objects and connectors.",
			inputSchema: { boardId: z.uuid() },
		},
		async ({ boardId }) => text(await api(`/api/boards/${boardId}/snapshot`)),
	);
	server.registerTool(
		"board_create",
		{
			description: "Create a board owned by the authenticated user.",
			inputSchema: { title: z.string().min(1).max(120), operationId: z.uuid() },
		},
		async ({ title, operationId }) =>
			text(
				await api("/api/boards", {
					method: "POST",
					body: JSON.stringify({ title, operationId }),
				}),
			),
	);
	server.registerTool(
		"board_rename",
		{
			description: "Rename a board when the authenticated user is its owner.",
			inputSchema: {
				boardId: z.uuid(),
				title: z.string().min(1).max(120),
				operationId: z.uuid(),
			},
		},
		async ({ boardId, title, operationId }) =>
			text(
				await api(`/api/boards/${boardId}/rename`, {
					method: "POST",
					body: JSON.stringify({ title, operationId }),
				}),
			),
	);
	server.registerTool(
		"board_archive",
		{
			description: "Archive or unarchive an owned board.",
			inputSchema: {
				boardId: z.uuid(),
				archived: z.boolean(),
				operationId: z.uuid(),
			},
		},
		async ({ boardId, archived, operationId }) =>
			text(
				await api(`/api/boards/${boardId}/archive`, {
					method: "POST",
					body: JSON.stringify({ archived, operationId }),
				}),
			),
	);
	server.registerTool(
		"board_delete",
		{
			description:
				"Permanently delete an owned board only after explicit irreversible confirmation and exact title confirmation.",
			inputSchema: {
				boardId: z.uuid(),
				confirmTitle: z.string(),
				confirmIrreversible: z.boolean(),
				operationId: z.uuid(),
			},
		},
		async ({ boardId, confirmTitle, confirmIrreversible, operationId }) =>
			text(
				await api(`/api/boards/${boardId}/delete`, {
					method: "POST",
					body: JSON.stringify({
						confirmTitle,
						confirmIrreversible,
						operationId,
					}),
				}),
			),
	);
	server.registerTool(
		"objects_create",
		{
			description: "Atomically create non-media board objects.",
			inputSchema: {
				boardId: z.uuid(),
				objects: z.array(objectInputSchema).min(1).max(100),
				operationId: z.uuid(),
			},
		},
		async ({ boardId, objects, operationId }) =>
			text(
				await api(`/api/boards/${boardId}/commands`, {
					method: "POST",
					body: JSON.stringify({
						operationId,
						type: "objects.create",
						changes: objects,
					}),
				}),
			),
	);
	server.registerTool(
		"objects_update",
		{
			description: "Update objects using expected versions.",
			inputSchema: {
				boardId: z.uuid(),
				updates: z.array(
					z.object({
						id: z.uuid(),
						expectedVersion: z.number().int(),
						patch: z.record(z.string(), z.unknown()),
					}),
				),
				operationId: z.uuid(),
			},
		},
		async ({ boardId, updates, operationId }) =>
			text(
				await api(`/api/boards/${boardId}/commands`, {
					method: "POST",
					body: JSON.stringify({
						operationId,
						type: "objects.update",
						changes: updates,
					}),
				}),
			),
	);
	server.registerTool(
		"objects_delete",
		{
			description:
				"Delete objects. Set confirmIrreversible only after the user explicitly confirms media deletion.",
			inputSchema: {
				boardId: z.uuid(),
				targets: z.array(
					z.object({ id: z.uuid(), expectedVersion: z.number().int() }),
				),
				confirmIrreversible: z.boolean().optional(),
				operationId: z.uuid(),
			},
		},
		async ({ boardId, targets, confirmIrreversible, operationId }) =>
			text(
				await api(`/api/boards/${boardId}/commands`, {
					method: "POST",
					body: JSON.stringify({
						operationId,
						type: "objects.delete",
						changes: targets,
						confirmIrreversible,
					}),
				}),
			),
	);
	server.registerTool(
		"objects_duplicate",
		{
			description:
				"Atomically duplicate non-media objects and internal connectors. Media objects require the dedicated media duplication lifecycle.",
			inputSchema: {
				boardId: z.uuid(),
				targets: z
					.array(
						z.object({
							id: z.uuid(),
							expectedVersion: z.number().int().positive(),
							offset: z.object({ x: z.number(), y: z.number() }).optional(),
						}),
					)
					.min(1)
					.max(100),
				operationId: z.uuid(),
			},
		},
		async ({ boardId, targets, operationId }) =>
			text(
				await api(`/api/boards/${boardId}/commands`, {
					method: "POST",
					body: JSON.stringify({
						operationId,
						type: "objects.duplicate",
						changes: targets,
					}),
				}),
			),
	);
	server.registerTool(
		"media_upload",
		{
			description: remote
				? "Upload inline base64 media (up to 4 MiB) and place it on the board. Server filesystem access is not allowed."
				: "Upload an absolute local file confined to BOARD_MCP_UPLOAD_ROOT and place a media object on the board.",
			inputSchema: {
				boardId: z.uuid(),
				...fileFields,
				position: z.object({ x: z.number(), y: z.number() }).optional(),
				caption: z.string().max(2000).optional(),
				operationId: z.uuid(),
			},
		},
		async ({
			boardId,
			file,
			absoluteFilePath,
			position,
			caption,
			operationId,
		}: {
			boardId: string;
			file?: z.infer<typeof remoteFileSchema>;
			absoluteFilePath?: string;
			position?: { x: number; y: number };
			caption?: string;
			operationId: string;
		}) => {
			const local = await readFile({ file, absoluteFilePath });
			const form = new FormData();
			form.set("file", local.file, local.name);
			const asset = (await apiForm(`/api/boards/${boardId}/media`, form)) as {
				assetId: string;
				mimeType: string;
			};
			const kind = asset.mimeType.startsWith("image/")
				? "image"
				: asset.mimeType.startsWith("video/")
					? "video"
					: "audio";
			try {
				const placed = await api(`/api/boards/${boardId}/commands`, {
					method: "POST",
					body: JSON.stringify({
						operationId,
						type: "objects.create",
						changes: [
							{
								kind,
								x: position?.x ?? 0,
								y: position?.y ?? 0,
								width: kind === "image" ? 320 : 420,
								height: kind === "image" ? 240 : 120,
								data: {
									assetId: asset.assetId,
									caption: caption ?? local.name,
								},
							},
						],
					}),
				});
				return text({ asset, placed });
			} catch (error) {
				await api(`/api/boards/${boardId}/media/${asset.assetId}`, {
					method: "DELETE",
				}).catch(() => undefined);
				throw error;
			}
		},
	);
	server.registerTool(
		"objects_arrange",
		{
			description:
				"Arrange versioned non-media objects: align, distribute, stack, group, or ungroup. Uses the shared atomic board command service.",
			inputSchema: {
				boardId: z.uuid(),
				targets: z
					.array(
						z.object({
							id: z.uuid(),
							expectedVersion: z.number().int().positive(),
						}),
					)
					.min(1)
					.max(100),
				action: z.enum([
					"align-left",
					"align-right",
					"align-top",
					"align-bottom",
					"distribute-horizontal",
					"distribute-vertical",
					"bring-forward",
					"send-backward",
					"group",
					"ungroup",
				]),
				operationId: z.uuid(),
			},
		},
		async ({ boardId, targets, action, operationId }) => {
			const snapshot = (await api(`/api/boards/${boardId}/snapshot`)) as {
				objects: Array<{
					id: string;
					kind: string;
					x: number;
					y: number;
					width: number;
					height: number;
					zIndex?: number;
					parentId?: string | null;
					version: number;
					data: Record<string, unknown>;
				}>;
			};
			const selected = targets.map((target) => {
				const object = snapshot.objects.find((value) => value.id === target.id);
				if (!object) throw new Error("Object not found");
				return { ...object, expectedVersion: target.expectedVersion };
			});
			const update = (changes: unknown[]) =>
				api(`/api/boards/${boardId}/commands`, {
					method: "POST",
					body: JSON.stringify({
						operationId,
						type: "objects.update",
						changes,
					}),
				});
			if (action === "bring-forward" || action === "send-backward")
				return text(
					await update(
						selected.map((object) => ({
							id: object.id,
							expectedVersion: object.expectedVersion,
							patch: {
								zIndex:
									(object.zIndex ?? 0) + (action === "bring-forward" ? 1 : -1),
							},
						})),
					),
				);
			if (action === "ungroup") {
				const groups = selected.filter((object) => object.kind === "group");
				if (groups.length) {
					if (groups.length !== selected.length)
						throw new Error(
							"Ungroup either group containers or their children, not both",
						);
					return text(
						await api(`/api/boards/${boardId}/commands`, {
							method: "POST",
							body: JSON.stringify({
								operationId,
								type: "objects.delete",
								changes: groups.map((object) => ({
									id: object.id,
									expectedVersion: object.expectedVersion,
								})),
							}),
						}),
					);
				}
				return text(
					await update(
						selected.map((object) => ({
							id: object.id,
							expectedVersion: object.expectedVersion,
							patch: { parentId: null },
						})),
					),
				);
			}
			if (action === "group") {
				const leaves = selected.filter(
					(object) => !["frame", "group"].includes(object.kind),
				);
				if (!leaves.length)
					throw new Error("Select at least one non-container object");
				const left = Math.min(...leaves.map((object) => object.x));
				const top = Math.min(...leaves.map((object) => object.y));
				const right = Math.max(
					...leaves.map((object) => object.x + object.width),
				);
				const bottom = Math.max(
					...leaves.map((object) => object.y + object.height),
				);
				return text(
					await api(`/api/boards/${boardId}/commands`, {
						method: "POST",
						body: JSON.stringify({
							operationId,
							type: "objects.group",
							changes: [
								{
									group: {
										kind: "group",
										x: left - 24,
										y: top - 24,
										width: right - left + 48,
										height: bottom - top + 48,
										data: { label: "Group" },
									},
									children: leaves.map((object) => ({
										id: object.id,
										expectedVersion: object.expectedVersion,
									})),
								},
							],
						}),
					}),
				);
			}
			if (selected.length < 2)
				throw new Error("Select at least two objects to align or distribute");
			const horizontal =
				action.includes("horizontal") ||
				action.includes("left") ||
				action.includes("right");
			const axis = horizontal ? "x" : "y";
			const size = (object: (typeof selected)[number]) =>
				horizontal ? object.width : object.height;
			const ordered = selected.toSorted((a, b) => a[axis] - b[axis]);
			const positions = new Map<string, number>();
			if (action.startsWith("distribute")) {
				if (ordered.length < 3)
					throw new Error("Distribution needs at least three objects");
				const first = ordered[0];
				const last = ordered.at(-1);
				if (!first || !last) throw new Error("No objects selected");
				const gap =
					(last[axis] +
						size(last) -
						first[axis] -
						ordered.reduce((total, object) => total + size(object), 0)) /
					(ordered.length - 1);
				let cursor = first[axis] + size(first) + gap;
				for (const object of ordered.slice(1, -1)) {
					positions.set(object.id, cursor);
					cursor += size(object) + gap;
				}
			} else {
				const reference =
					action.endsWith("left") || action.endsWith("top")
						? Math.min(...selected.map((object) => object[axis]))
						: Math.max(
								...selected.map((object) => object[axis] + size(object)),
							);
				for (const object of selected)
					positions.set(
						object.id,
						action.endsWith("right") || action.endsWith("bottom")
							? reference - size(object)
							: reference,
					);
			}
			return text(
				await update(
					selected.map((object) => ({
						id: object.id,
						expectedVersion: object.expectedVersion,
						patch: { [axis]: positions.get(object.id) ?? object[axis] },
					})),
				),
			);
		},
	);
	server.registerTool(
		"media_read",
		{
			description:
				"Read media metadata, or return bounded image content for an image object.",
			inputSchema: {
				boardId: z.uuid(),
				objectId: z.uuid(),
				mode: z.enum(["metadata", "image"]).optional(),
			},
		},
		async ({ boardId, objectId, mode }) => {
			const snapshot = (await api(`/api/boards/${boardId}/snapshot`)) as {
				objects: Array<{
					id: string;
					kind: string;
					data: Record<string, unknown>;
				}>;
			};
			const object = snapshot.objects.find((value) => value.id === objectId);
			if (!object) throw new Error("Object not found");
			const assetId = object.data.assetId;
			if (typeof assetId !== "string")
				throw new Error("Object has no uploaded media asset.");
			if (mode !== "image" || object.kind !== "image")
				return text({ kind: object.kind, data: object.data });
			const content = await binary(`/api/boards/${boardId}/media/${assetId}`);
			if (!content.mimeType.startsWith("image/"))
				throw new Error("Asset is not a supported image.");
			return {
				content: [
					{
						type: "image" as const,
						data: Buffer.from(content.bytes).toString("base64"),
						mimeType: content.mimeType,
					},
				],
			};
		},
	);
	server.registerTool(
		"media_duplicate",
		{
			description:
				"Create an independent DAM copy of one media object and place it with an offset. This action creates a new file and is not undoable.",
			inputSchema: {
				boardId: z.uuid(),
				objectId: z.uuid(),
				offset: z.object({ x: z.number(), y: z.number() }).optional(),
				operationId: z.uuid(),
			},
		},
		async ({ boardId, objectId, offset, operationId }) => {
			const snapshot = (await api(`/api/boards/${boardId}/snapshot`)) as {
				objects: Array<{
					id: string;
					kind: string;
					x: number;
					y: number;
					width: number;
					height: number;
					data: Record<string, unknown>;
				}>;
			};
			const source = snapshot.objects.find((value) => value.id === objectId);
			if (!source || !["image", "video", "audio"].includes(source.kind))
				throw new Error("Object is not a media object.");
			const assetId = source.data.assetId;
			if (typeof assetId !== "string")
				throw new Error("Media asset is missing.");
			const asset = (await api(
				`/api/boards/${boardId}/media/${assetId}/duplicate`,
				{ method: "POST" },
			)) as { assetId: string };
			try {
				return text(
					await api(`/api/boards/${boardId}/commands`, {
						method: "POST",
						body: JSON.stringify({
							operationId,
							type: "objects.create",
							changes: [
								{
									kind: source.kind,
									x: source.x + (offset?.x ?? 24),
									y: source.y + (offset?.y ?? 24),
									width: source.width,
									height: source.height,
									data: { ...source.data, assetId: asset.assetId },
								},
							],
						}),
					}),
				);
			} catch (error) {
				await api(`/api/boards/${boardId}/media/${asset.assetId}`, {
					method: "DELETE",
				}).catch(() => undefined);
				throw error;
			}
		},
	);
	server.registerTool(
		"media_replace",
		{
			description:
				"Irreversibly replace one uploaded media file. Call only after the user explicitly confirms permanent removal of the previous file.",
			inputSchema: {
				boardId: z.uuid(),
				objectId: z.uuid(),
				expectedVersion: z.number().int().positive(),
				...fileFields,
				confirmIrreversible: z.literal(true),
				operationId: z.uuid(),
			},
		},
		async ({
			boardId,
			objectId,
			expectedVersion,
			absoluteFilePath,
			file,
			confirmIrreversible,
			operationId,
		}: {
			boardId: string;
			objectId: string;
			expectedVersion: number;
			absoluteFilePath?: string;
			file?: z.infer<typeof remoteFileSchema>;
			confirmIrreversible: true;
			operationId: string;
		}) => {
			const snapshot = (await api(`/api/boards/${boardId}/snapshot`)) as {
				objects: Array<{
					id: string;
					kind: string;
					data: Record<string, unknown>;
				}>;
			};
			const source = snapshot.objects.find((value) => value.id === objectId);
			if (!source || !["image", "video", "audio"].includes(source.kind))
				throw new Error("Object is not uploaded media.");
			const assetId = source.data.assetId;
			if (typeof assetId !== "string")
				throw new Error("Media asset is missing.");
			const local = await readFile({ file, absoluteFilePath });
			const form = new FormData();
			form.set("file", local.file, local.name);
			form.set("objectId", objectId);
			form.set("expectedVersion", String(expectedVersion));
			form.set("operationId", operationId);
			form.set("confirmIrreversible", String(confirmIrreversible));
			return text(
				await apiForm(`/api/boards/${boardId}/media/${assetId}/replace`, form),
			);
		},
	);
	server.registerTool(
		"operation_get",
		{
			description:
				"Resolve the persisted result of a previously submitted operation ID.",
			inputSchema: { boardId: z.uuid(), operationId: z.uuid() },
		},
		async ({ boardId, operationId }) =>
			text(
				await api(
					`/api/boards/${boardId}/operations?operationId=${operationId}`,
				),
			),
	);
	server.registerTool(
		"objects_list",
		{
			description: "List board objects, optionally filtered by kind or text.",
			inputSchema: {
				boardId: z.uuid(),
				kinds: z.array(z.string()).optional(),
				text: z.string().optional(),
			},
		},
		async ({ boardId, kinds, text: query }) => {
			const snapshot = (await api(`/api/boards/${boardId}/snapshot`)) as {
				objects: Array<{ kind: string; data: unknown }>;
			};
			const objects = snapshot.objects.filter(
				(value) =>
					(!kinds?.length || kinds.includes(value.kind)) &&
					(!query ||
						JSON.stringify(value.data)
							.toLowerCase()
							.includes(query.toLowerCase())),
			);
			return text({ ...snapshot, objects, connectors: undefined });
		},
	);
	server.registerTool(
		"object_get",
		{
			description: "Get one current board object and related connectors.",
			inputSchema: { boardId: z.uuid(), objectId: z.uuid() },
		},
		async ({ boardId, objectId }) => {
			const snapshot = (await api(`/api/boards/${boardId}/snapshot`)) as {
				objects: Array<{ id: string }>;
				connectors: Array<unknown>;
			};
			const object = snapshot.objects.find((value) => value.id === objectId);
			if (!object) throw new Error("Object not found");
			return text({
				object,
				connectors: snapshot.connectors.filter((value) =>
					JSON.stringify(value).includes(objectId),
				),
			});
		},
	);
	server.registerTool(
		"connectors_create",
		{
			description: "Create canonical free or attached connectors.",
			inputSchema: {
				boardId: z.uuid(),
				connectors: z.array(connectorInputSchema).min(1).max(100),
				operationId: z.uuid(),
			},
		},
		async ({ boardId, connectors, operationId }) =>
			text(
				await api(`/api/boards/${boardId}/commands`, {
					method: "POST",
					body: JSON.stringify({
						operationId,
						type: "connectors.create",
						changes: connectors,
					}),
				}),
			),
	);
	server.registerTool(
		"connectors_delete",
		{
			description: "Delete connectors using current expected versions.",
			inputSchema: {
				boardId: z.uuid(),
				connectors: z.array(
					z.object({ id: z.uuid(), expectedVersion: z.number().int() }),
				),
				operationId: z.uuid(),
			},
		},
		async ({ boardId, connectors, operationId }) =>
			text(
				await api(`/api/boards/${boardId}/commands`, {
					method: "POST",
					body: JSON.stringify({
						operationId,
						type: "connectors.delete",
						changes: connectors,
					}),
				}),
			),
	);
	server.registerTool(
		"connectors_update",
		{
			description:
				"Update connector endpoints, line style, label, or markers using current expected versions.",
			inputSchema: {
				boardId: z.uuid(),
				updates: z
					.array(
						z.object({
							id: z.uuid(),
							expectedVersion: z.number().int().positive(),
							patch: z.record(z.string(), z.unknown()),
						}),
					)
					.min(1)
					.max(100),
				operationId: z.uuid(),
			},
		},
		async ({ boardId, updates, operationId }) =>
			text(
				await api(`/api/boards/${boardId}/commands`, {
					method: "POST",
					body: JSON.stringify({
						operationId,
						type: "connectors.update",
						changes: updates,
					}),
				}),
			),
	);
	server.registerTool(
		"youtube_embed",
		{
			description: "Place a validated YouTube video ID or URL on a board.",
			inputSchema: {
				boardId: z.uuid(),
				url: z.string(),
				position: z.object({ x: z.number(), y: z.number() }).optional(),
				title: z.string().optional(),
				operationId: z.uuid(),
			},
		},
		async ({ boardId, url, position, title, operationId }) => {
			const id = normalizeYouTubeVideoId(url);
			if (!id) throw new Error("A valid YouTube video URL or ID is required");
			return text(
				await api(`/api/boards/${boardId}/commands`, {
					method: "POST",
					body: JSON.stringify({
						operationId,
						type: "objects.create",
						changes: [
							{
								kind: "youtube",
								x: position?.x ?? 0,
								y: position?.y ?? 0,
								width: 480,
								height: 270,
								data: { videoId: id, title },
							},
						],
					}),
				}),
			);
		},
	);

	return server;
}
