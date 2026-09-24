import {
	applyEdgeChanges,
	Background,
	ConnectionMode,
	type Edge,
	MiniMap,
	type Node,
	type OnConnect,
	type OnNodeDrag,
	ReactFlow,
	type ReactFlowInstance,
	ReactFlowProvider,
} from "@xyflow/react";
import { projectEdges, projectNodes } from "./projection";
import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { normalizeMediaFile, transferredFiles } from "@/shared/media-file";
import { defaultObject } from "@/shared/object-defaults";
import { normalizeYouTubeVideoId } from "@/shared/youtube";
import {
	BoardHeader,
	CanvasControls,
	type CanvasTool,
	CreationTools,
	SelectionTools,
} from "./BoardTools";
import { CommentDialog, type CommentDraft, CommentPins } from "./Comments";
import { changeBoardNodes } from "./node-state";
import { ObjectEditor } from "./ObjectEditor";
import { nodeTypes, ObjectActions, portAnchor } from "./ObjectNode";
import { PenLayer } from "./PenLayer";
import { CursorLegend, CursorReporter, RemoteCursors } from "./Presence";
import { RichTextEditor } from "./RichTextEditor";
import type {
	CommandResult,
	CommentThread,
	ConnectorRow,
	Cursor,
	HistoryEntry,
	Member,
	ObjectRow,
} from "./types";

export function BoardView({
	id,
	back,
	currentUserId,
	currentUserEmail,
}: {
	id: string;
	back: () => void;
	currentUserId: string;
	currentUserEmail: string;
}) {
	const [viewport] = useState(() => {
		try {
			return JSON.parse(
				localStorage.getItem(`board-viewport:${id}`) ??
					'{"x":0,"y":0,"zoom":1}',
			) as { x: number; y: number; zoom: number };
		} catch {
			return { x: 0, y: 0, zoom: 1 };
		}
	});
	const flow = useRef<ReactFlowInstance | null>(null);
	const [clientId] = useState(() => crypto.randomUUID());
	const [tool, setTool] = useState<CanvasTool>("select");
	const [snap, setSnap] = useState(false);
	const [minimap, setMinimap] = useState(false);
	const [plainEditing, setPlainEditing] = useState<ObjectRow | null>(null);
	const [objects, setObjects] = useState<ObjectRow[]>([]);
	const [connectors, setConnectors] = useState<ConnectorRow[]>([]);
	const [title, setTitle] = useState("");
	const [boardState, setBoardState] = useState("active");
	const [accessError, setAccessError] = useState("");
	const [editing, setEditing] = useState<ObjectRow | null>(null);
	const uploadInput = useRef<HTMLInputElement>(null);
	const lastCanvasPointer = useRef<{ x: number; y: number } | null>(null);
	const uploadPosition = useRef<{ x: number; y: number } | null>(null);
	const replaceInput = useRef<HTMLInputElement>(null);
	const [replaceTarget, setReplaceTarget] = useState<ObjectRow | null>(null);
	const socketRef = useRef<WebSocket | undefined>(undefined);
	const [settings, setSettings] = useState(false);
	const [memberEmail, setMemberEmail] = useState("");
	const [memberRows, setMemberRows] = useState<Member[]>([]);
	const [projectTitle, setProjectTitle] = useState("");
	const [deleteTitle, setDeleteTitle] = useState("");
	const [connectionStatus, setConnectionStatus] = useState("Connecting");
	const [collaborationNotice, setCollaborationNotice] = useState("");
	const [cursors, setCursors] = useState<Record<string, Cursor>>({});
	const [commentThreads, setCommentThreads] = useState<CommentThread[]>([]);
	const [openCommentThreadId, setOpenCommentThreadId] = useState<string | null>(
		null,
	);
	const [commentDraft, setCommentDraft] = useState<CommentDraft | null>(null);
	const [clipboard, setClipboard] = useState<
		Array<{ id: string; expectedVersion: number }>
	>([]);
	const [undoStack, setUndoStack] = useState<HistoryEntry[]>([]);
	const [redoStack, setRedoStack] = useState<HistoryEntry[]>([]);
	const isOwner = memberRows.some(
		(member) => member.owner && member.id === currentUserId,
	);
	const sendTransient = (message: Record<string, unknown>) => {
		if (socketRef.current?.readyState === WebSocket.OPEN)
			socketRef.current.send(JSON.stringify(message));
	};
	const projectedNodes = useMemo(
		() => projectNodes(objects, connectors, id),
		[objects, connectors, id],
	);
	const [nodes, setNodes] = useState<Node[]>([]);
	const selectedIds = useMemo(
		() => nodes.filter((node) => node.selected).map((node) => node.id),
		[nodes],
	);
	useEffect(() => {
		setNodes((current) => {
			const byId = new Map(current.map((node) => [node.id, node]));
			return projectedNodes.map((node) => ({
				...byId.get(node.id),
				...node,
				selected: byId.get(node.id)?.selected ?? false,
			}));
		});
	}, [projectedNodes]);
	const projectedEdges = useMemo(() => projectEdges(connectors), [connectors]);
	const [edges, setEdges] = useState<Edge[]>([]);
	useEffect(() => setEdges(projectedEdges), [projectedEdges]);
	const latestRevision = useRef(-1n);
	const load = useCallback(async () => {
		try {
			const r = await fetch(`/api/boards/${id}/snapshot`);
			if (r.ok) {
				const s = await r.json();
				const revision = BigInt(s.revision);
				if (revision < latestRevision.current) return;
				latestRevision.current = revision;
				setObjects(s.objects);
				setConnectors(s.connectors);
				setTitle(s.project.title);
				setProjectTitle(s.project.title);
				setBoardState(s.project.state);
				setAccessError("");
			} else if (r.status === 403)
				setAccessError(
					"You do not have access to this board. Ask the board owner to add you.",
				);
			else if (r.status === 404) setAccessError("This board no longer exists.");
		} catch {
			setCollaborationNotice(
				"Unable to refresh the board. Check your connection.",
			);
		}
	}, [id]);
	const loadMembers = useCallback(async () => {
		const response = await fetch(`/api/boards/${id}/members`);
		if (response.ok) setMemberRows(await response.json());
	}, [id]);
	const loadComments = useCallback(async () => {
		try {
			const response = await fetch(`/api/boards/${id}/comments`);
			if (response.ok) setCommentThreads(await response.json());
		} catch {
			setCollaborationNotice(
				"Unable to refresh comments. Check your connection.",
			);
		}
	}, [id]);
	useEffect(() => {
		if (settings) void loadMembers();
	}, [settings, loadMembers]);
	useEffect(() => {
		void load();
		void loadComments();
		let closed = false;
		let socket: WebSocket | undefined;
		let retry = 0;
		let timer: number | undefined;
		const connectSocket = () => {
			setConnectionStatus(retry ? "Reconnecting" : "Connecting");
			socket = new WebSocket(
				`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/boards/${id}/ws?clientId=${clientId}`,
			);
			socketRef.current = socket;
			socket.onopen = () => {
				retry = 0;
				setConnectionStatus("Saved");
				void load();
			};
			socket.onmessage = (event) => {
				try {
					const message = JSON.parse(event.data) as {
						type?: string;
						objectId?: string;
						user?: { id?: string; email?: string };
						userId?: string;
						threadId?: string;
						email?: string;
						position?: { x?: unknown; y?: unknown };
					};
					if (message.type === "board.changed") void load();
					if (message.type === "comments.changed") {
						void loadComments();
					}
					if (
						message.type === "presence.cursor" &&
						message.user?.id &&
						message.user.email &&
						typeof message.position?.x === "number" &&
						typeof message.position.y === "number"
					)
						setCursors((current) => ({
							...current,
							[message.user?.id as string]: {
								email: message.user?.email as string,
								position: {
									x: message.position?.x as number,
									y: message.position?.y as number,
								},
							},
						}));
					if (message.type === "presence.leave" && message.userId)
						setCursors((current) => {
							const next = { ...current };
							delete next[message.userId as string];
							return next;
						});
					if (message.type === "edit.lease.denied") {
						setCollaborationNotice(
							`Editing by ${message.email ?? "another collaborator"}.`,
						);
						setEditing((current) =>
							current?.id === message.objectId ? null : current,
						);
					}
				} catch {
					// Ignore malformed transient collaboration packets.
				}
			};
			socket.onclose = (event) => {
				if (closed) return;
				if ([4003, 4004, 4008].includes(event.code)) {
					setAccessError(
						event.code === 4008
							? "Board is at its beta collaboration limit."
							: event.code === 4004
								? "This board was deleted."
								: "Your access to this board was revoked.",
					);
					setConnectionStatus("Disconnected");
					return;
				}
				setConnectionStatus("Reconnecting");
				retry++;
				timer = window.setTimeout(
					connectSocket,
					Math.min(10_000, 500 * 2 ** retry),
				);
			};
		};
		connectSocket();
		return () => {
			closed = true;
			if (timer) window.clearTimeout(timer);
			socket?.close();
			if (socketRef.current === socket) socketRef.current = undefined;
		};
	}, [id, load, loadComments]);
	useEffect(() => {
		if (!editing) return;
		const renew = () =>
			sendTransient({ type: "edit.lease.acquire", objectId: editing.id });
		renew();
		const interval = window.setInterval(renew, 5_000);
		return () => window.clearInterval(interval);
	}, [editing]);
	const send = async (
		type: string,
		changes: unknown[],
		confirmIrreversible = false,
	): Promise<CommandResult | undefined> => {
		if (!changes.length || boardState !== "active") return undefined;
		setConnectionStatus("Saving");
		try {
			const r = await fetch(`/api/boards/${id}/commands`, {
				method: "POST",
				headers: {
					"content-type": "application/json",
					"x-board-client": clientId,
				},
				body: JSON.stringify({
					operationId: crypto.randomUUID(),
					type,
					changes,
					confirmIrreversible,
				}),
			});
			if (!r.ok) {
				setConnectionStatus("Save failed");
				const failure = await r.json().catch(() => null);
				setCollaborationNotice(
					failure?.error?.message ?? "Unable to save this change.",
				);
				return undefined;
			}
			const result = (await r.json()) as CommandResult;
			setConnectionStatus("Saved");
			await load();
			return result;
		} catch {
			setConnectionStatus("Save failed");
			setCollaborationNotice(
				"Connection lost while saving. Refresh the board before retrying.",
			);
			return undefined;
		}
	};
	const versions = (result: CommandResult) =>
		new Map(result.upserts?.map((value) => [value.id, value.version]) ?? []);
	const undo = async () => {
		const entry = undoStack.at(-1);
		if (!entry) return;
		const result = await send("objects.update", entry.undo);
		if (!result) {
			setCollaborationNotice("Cannot undo because this object changed.");
			return;
		}
		const applied = versions(result);
		setUndoStack((stack) => stack.slice(0, -1));
		setRedoStack((stack) => [
			...stack,
			{
				...entry,
				redo: entry.redo.map((change) => ({
					...change,
					expectedVersion: applied.get(change.id) ?? change.expectedVersion,
				})),
			},
		]);
	};
	const redo = async () => {
		const entry = redoStack.at(-1);
		if (!entry) return;
		const result = await send("objects.update", entry.redo);
		if (!result) {
			setCollaborationNotice("Cannot redo because this object changed.");
			return;
		}
		const applied = versions(result);
		setRedoStack((stack) => stack.slice(0, -1));
		setUndoStack((stack) => [
			...stack,
			{
				...entry,
				undo: entry.undo.map((change) => ({
					...change,
					expectedVersion: applied.get(change.id) ?? change.expectedVersion,
				})),
			},
		]);
	};
	const duplicate = (
		targets: Array<{ id: string; expectedVersion: number }>,
	) => {
		if (!targets.length) return;
		void (async () => {
			const source = targets
				.map((target) => objects.find((object) => object.id === target.id))
				.filter((object): object is ObjectRow => Boolean(object));
			const nonMedia = source.filter(
				(object) => !["image", "video", "audio"].includes(object.kind),
			);
			if (nonMedia.length)
				await send(
					"objects.duplicate",
					nonMedia.map((object) => ({
						id: object.id,
						expectedVersion: object.version,
						offset: { x: 24, y: 24 },
					})),
				);
			for (const object of source.filter((value) =>
				["image", "video", "audio"].includes(value.kind),
			)) {
				const assetId = object.data.assetId;
				if (typeof assetId !== "string") continue;
				const copied = await fetch(
					`/api/boards/${id}/media/${assetId}/duplicate`,
					{ method: "POST" },
				);
				if (!copied.ok) continue;
				const asset = (await copied.json()) as { assetId: string };
				await send("objects.create", [
					{
						kind: object.kind,
						x: object.x + 24,
						y: object.y + 24,
						width: object.width,
						height: object.height,
						data: { ...object.data, assetId: asset.assetId },
					},
				]);
			}
		})();
	};
	const copySelection = () => {
		setClipboard(
			objects
				.filter((object) => selectedIds.includes(object.id))
				.map((object) => ({
					id: object.id,
					expectedVersion: object.version,
				})),
		);
	};
	const stackSelection = (direction: -1 | 1) =>
		void send(
			"objects.update",
			objects
				.filter((object) => selectedIds.includes(object.id))
				.map((object) => ({
					id: object.id,
					expectedVersion: object.version,
					patch: { zIndex: (object.zIndex ?? 0) + direction },
				})),
		);
	const alignSelection = (
		axis: "x" | "y",
		mode: "start" | "center" | "end",
	) => {
		const selected = objects.filter((object) =>
			selectedIds.includes(object.id),
		);
		if (selected.length < 2) return;
		const size = (object: ObjectRow) =>
			axis === "x" ? object.width : object.height;
		const starts = selected.map((object) => object[axis]);
		const ends = selected.map((object) => object[axis] + size(object));
		const reference =
			mode === "start"
				? Math.min(...starts)
				: mode === "end"
					? Math.max(...ends)
					: (Math.min(...starts) + Math.max(...ends)) / 2;
		void send(
			"objects.update",
			selected.map((object) => ({
				id: object.id,
				expectedVersion: object.version,
				patch: {
					[axis]:
						mode === "start"
							? reference
							: mode === "end"
								? reference - size(object)
								: reference - size(object) / 2,
				},
			})),
		);
	};
	const distributeSelection = (axis: "x" | "y") => {
		const selected = objects
			.filter((object) => selectedIds.includes(object.id))
			.toSorted((a, b) => a[axis] - b[axis]);
		if (selected.length < 3) return;
		const first = selected[0];
		const last = selected.at(-1);
		if (!first || !last) return;
		const size = (object: ObjectRow) =>
			axis === "x" ? object.width : object.height;
		const gap =
			(last[axis] +
				size(last) -
				first[axis] -
				selected.reduce((total, object) => total + size(object), 0)) /
			(selected.length - 1);
		let cursor = first[axis] + size(first) + gap;
		void send(
			"objects.update",
			selected.slice(1, -1).map((object) => {
				const position = cursor;
				cursor += size(object) + gap;
				return {
					id: object.id,
					expectedVersion: object.version,
					patch: { [axis]: position },
				};
			}),
		);
	};
	const styleSelection = (patch: Record<string, unknown>) =>
		void send(
			"objects.update",
			objects
				.filter((object) => selectedIds.includes(object.id))
				.map((object) => ({
					id: object.id,
					expectedVersion: object.version,
					patch: {
						style: {
							...((object.data.style as Record<string, unknown> | undefined) ??
								{}),
							...patch,
						},
					},
				})),
		);
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			const target = event.target as HTMLElement | null;
			if (
				target?.isContentEditable ||
				["INPUT", "TEXTAREA", "SELECT"].includes(target?.tagName ?? "")
			)
				return;
			if (!(event.metaKey || event.ctrlKey)) return;
			if (event.key.toLowerCase() === "z") {
				event.preventDefault();
				if (event.shiftKey) void redo();
				else void undo();
				return;
			}
			if (event.key.toLowerCase() === "y") {
				event.preventDefault();
				void redo();
				return;
			}
			if (event.key.toLowerCase() === "c") {
				event.preventDefault();
				copySelection();
			}
			if (event.key.toLowerCase() === "v" && clipboard.length) {
				event.preventDefault();
				duplicate(clipboard);
			}
			if (event.key.toLowerCase() === "d") {
				event.preventDefault();
				duplicate(
					objects
						.filter((object) => selectedIds.includes(object.id))
						.map((object) => ({
							id: object.id,
							expectedVersion: object.version,
						})),
				);
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [clipboard, objects, selectedIds, undoStack, redoStack]);
	const groupSelection = (kind: "group" | "frame" = "group") => {
		const children = objects.filter(
			(object) =>
				selectedIds.includes(object.id) &&
				!["frame", "group"].includes(object.kind),
		);
		if (!children.length) {
			void send("objects.create", [defaultObject(kind, placement())]);
			return;
		}
		const left = Math.min(...children.map((child) => child.x));
		const top = Math.min(...children.map((child) => child.y));
		const right = Math.max(...children.map((child) => child.x + child.width));
		const bottom = Math.max(...children.map((child) => child.y + child.height));
		void send("objects.group", [
			{
				group: {
					id: crypto.randomUUID(),
					kind,
					zIndex: -1,
					x: left - 24,
					y: top - 24,
					width: right - left + 48,
					height: bottom - top + 48,
					data: { label: kind === "frame" ? "Frame" : "" },
				},
				children: children.map((child) => ({
					id: child.id,
					expectedVersion: child.version,
				})),
			},
		]);
	};

	const placement = () => {
		const pane = document.querySelector(".react-flow")?.getBoundingClientRect();
		return pane && flow.current
			? flow.current.screenToFlowPosition({
					x: pane.x + pane.width / 2,
					y: pane.y + pane.height / 2,
				})
			: { x: 0, y: 0 };
	};
	const add = (kind = "shape") => {
		setTool("select");
		if (kind === "frame" && selectedIds.length) {
			groupSelection("frame");
			return;
		}
		const object = defaultObject(kind, placement());
		object.x -= object.width / 2;
		object.y -= object.height / 2;
		void send("objects.create", [object]);
	};
	const addShape = (shape: string) => {
		setTool("select");
		const object = defaultObject("shape", placement());
		object.x -= object.width / 2;
		object.y -= object.height / 2;
		void send("objects.create", [
			{
				...object,
				width: shape === "circle" || shape === "square" ? 160 : 200,
				height: shape === "circle" || shape === "square" ? 160 : 140,
				data: { shape, label: "" },
			},
		]);
	};
	const startComment = (
		position: { x: number; y: number },
		objectId: string | null = null,
	) => {
		if (boardState !== "active") return;
		setCommentDraft({ position, objectId });
		setOpenCommentThreadId(null);
	};
	const createComment = async (draft: CommentDraft, body: string) => {
		const response = await fetch(`/api/boards/${id}/comments/threads`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ ...draft, body }),
		});
		if (!response.ok) {
			setCollaborationNotice("Unable to add comment. Please try again.");
			return false;
		}
		const thread = (await response.json()) as CommentThread;
		await loadComments();
		setCommentDraft(null);
		setOpenCommentThreadId(thread.id);
		return true;
	};
	const replyToComment = async (threadId: string, body: string) => {
		const response = await fetch(
			`/api/boards/${id}/comments/threads/${threadId}`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ body }),
			},
		);
		if (!response.ok) {
			setCollaborationNotice("Unable to post reply. Please try again.");
			return false;
		}
		await response.json();
		await loadComments();
		return true;
	};
	const editObject = (object: ObjectRow) => {
		if (
			boardState !== "active" ||
			object.kind === "group" ||
			object.kind === "freehand"
		)
			return;
		if (object.kind === "text" || object.kind === "table") {
			sendTransient({ type: "edit.lease.acquire", objectId: object.id });
			setEditing(object);
		} else setPlainEditing(object);
	};
	const addYoutube = () => {
		const videoId = normalizeYouTubeVideoId(
			window.prompt("Paste a YouTube URL") ?? "",
		);
		if (!videoId || !/^[A-Za-z0-9_-]{11}$/.test(videoId)) return;
		void send("objects.create", [
			{
				kind: "youtube",
				x: objects.length * 30,
				y: objects.length * 30,
				width: 480,
				height: 300,
				data: { videoId },
			},
		]);
	};

	const drag: OnNodeDrag = async (_, node, dragged) => {
		const moving = dragged?.length ? dragged : [node];
		const ids = new Set(moving.map((value) => value.id));
		const changes = moving.flatMap((value) => {
			const object = objects.find((object) => object.id === value.id);
			if (!object || (object.parentId && ids.has(object.parentId))) return [];
			return [
				{
					id: object.id,
					expectedVersion: object.version,
					patch: { x: value.position.x, y: value.position.y },
				},
			];
		});
		if (!changes.length) return;
		const result = await send("objects.update", changes);
		if (!result) {
			await load();
			return;
		}
		const applied = versions(result);
		setUndoStack((stack) => [
			...stack,
			{
				undo: changes.map((change) => {
					const previous = objects.find((object) => object.id === change.id);
					return {
						...change,
						expectedVersion: applied.get(change.id) ?? change.expectedVersion,
						patch: { x: previous?.x, y: previous?.y },
					};
				}),
				redo: changes.map((change) => ({
					...change,
					expectedVersion: applied.get(change.id) ?? change.expectedVersion,
				})),
			},
		]);
		setRedoStack([]);
	};
	const connect: OnConnect = (connection) => {
		if (!connection.source || !connection.target) return;
		void send("connectors.create", [
			{
				source: {
					kind: "attached",
					objectId: connection.source,
					anchor: portAnchor(connection.sourceHandle),
				},
				target: {
					kind: "attached",
					objectId: connection.target,
					anchor: portAnchor(connection.targetHandle),
				},
				style: { stroke: "#64748b", strokeWidth: 2 },
			},
		]);
	};
	const reconnect = (
		oldEdge: Edge,
		connection: {
			source: string | null;
			target: string | null;
			sourceHandle?: string | null;
			targetHandle?: string | null;
		},
	) => {
		const connector = connectors.find((value) => value.id === oldEdge.id);
		if (!connector || !connection.source || !connection.target) return;
		const endpoint = (
			nodeId: string,
			role: "source" | "target",
		): NonNullable<ConnectorRow["data"]["source"]> => {
			const existing = connector.data[role];
			if (
				nodeId === `anchor:${connector.id}:${role}` &&
				existing?.kind === "free"
			)
				return existing;
			return {
				kind: "attached",
				objectId: nodeId,
				anchor: portAnchor(
					role === "source" ? connection.sourceHandle : connection.targetHandle,
				),
			};
		};
		void send("connectors.update", [
			{
				id: connector.id,
				expectedVersion: connector.version,
				patch: {
					source: endpoint(connection.source, "source"),
					target: endpoint(connection.target, "target"),
				},
			},
		]);
	};
	const mediaPlacement = () => {
		const point = lastCanvasPointer.current;
		return point && flow.current
			? flow.current.screenToFlowPosition(point)
			: placement();
	};
	const uploadFile = async (input: File, point = mediaPlacement()) => {
		if (boardState !== "active") return;
		try {
			if (!input.size)
				throw new Error(
					"The screenshot is empty. Save it as a file and try again.",
				);
			if (input.size > 31_457_280)
				throw new Error("File exceeds the 30 MiB limit.");
			// Materialize OS drag/clipboard files before the temporary source disappears.
			const file = await normalizeMediaFile(
				new File([await input.arrayBuffer()], input.name, { type: input.type }),
			);
			let width = 420;
			let height = 120;
			if (file.type.startsWith("image/")) {
				let bitmap: ImageBitmap;
				try {
					bitmap = await createImageBitmap(file);
				} catch {
					throw new Error(
						"The image cannot be read. Save the screenshot as PNG or JPEG and try again.",
					);
				}
				const scale = Math.min(1, 480 / Math.max(bitmap.width, bitmap.height));
				width = Math.max(1, Math.round(bitmap.width * scale));
				height = Math.max(1, Math.round(bitmap.height * scale));
				bitmap.close();
			}
			const form = new FormData();
			form.set("file", file);
			const response = await fetch(`/api/boards/${id}/media`, {
				method: "POST",
				body: form,
			});
			if (!response.ok) {
				const failure = await response.json().catch(() => null);
				throw new Error(
					failure?.error?.message ??
						failure?.error ??
						`Upload failed (${response.status})`,
				);
			}
			const asset = (await response.json()) as {
				assetId: string;
				mimeType: string;
			};
			const kind = asset.mimeType.startsWith("image/")
				? "image"
				: asset.mimeType.startsWith("video/")
					? "video"
					: asset.mimeType.startsWith("audio/")
						? "audio"
						: null;
			if (!kind)
				throw new Error(
					"Unsupported media type returned by the media service.",
				);
			await send("objects.create", [
				{
					kind,
					x: point.x - width / 2,
					y: point.y - height / 2,
					width,
					height,
					data: { assetId: asset.assetId, caption: file.name },
				},
			]);
		} catch (error) {
			setCollaborationNotice(
				`${input.name || "Screenshot"}: ${error instanceof Error ? error.message : "Upload failed"}`,
			);
		}
	};
	const replaceMedia = async (file: File) => {
		const target = replaceTarget;
		setReplaceTarget(null);
		const assetId = target?.data.assetId;
		if (!target || typeof assetId !== "string") return;
		const form = new FormData();
		form.set("file", file);
		form.set("objectId", target.id);
		form.set("expectedVersion", String(target.version));
		form.set("operationId", crypto.randomUUID());
		form.set("confirmIrreversible", "true");
		setConnectionStatus("Saving");
		const response = await fetch(`/api/boards/${id}/media/${assetId}/replace`, {
			method: "POST",
			body: form,
		});
		setConnectionStatus(response.ok ? "Saved" : "Save failed");
		if (response.ok) void load();
	};
	const startReplacement = () => {
		const target = objects.find(
			(object) =>
				selectedIds.includes(object.id) &&
				["image", "video", "audio"].includes(object.kind),
		);
		if (
			!target ||
			!window.confirm(
				"Replacing media permanently deletes the existing uploaded file and cannot be undone. Continue?",
			)
		)
			return;
		setReplaceTarget(target);
		replaceInput.current?.click();
	};
	const dropFiles = (event: React.DragEvent) => {
		event.preventDefault();
		event.stopPropagation();
		const files = transferredFiles(event.dataTransfer);
		const point =
			flow.current?.screenToFlowPosition({
				x: event.clientX,
				y: event.clientY,
			}) ?? placement();
		if (!files.length)
			setCollaborationNotice(
				"No readable file was received. Save the screenshot, then drag the saved file here.",
			);
		for (const [index, file] of files.entries())
			void uploadFile(file, {
				x: point.x + index * 24,
				y: point.y + index * 24,
			});
	};
	useEffect(() => {
		const paste = (event: ClipboardEvent) => {
			const target = event.target as HTMLElement | null;
			if (
				target?.isContentEditable ||
				target?.closest("input, textarea, [role='dialog'], dialog")
			)
				return;
			const files = event.clipboardData
				? transferredFiles(event.clipboardData)
				: [];
			if (!files.length) return;
			event.preventDefault();
			for (const file of files) void uploadFile(file);
		};
		window.addEventListener("paste", paste);
		return () => window.removeEventListener("paste", paste);
	}, [uploadFile]);
	const deleteNodes = (nodesToDelete: Node[]) => {
		const selected = objects.filter((object) =>
			nodesToDelete.some((node) => node.id === object.id),
		);
		const hasMedia = selected.some((object) =>
			["image", "video", "audio"].includes(object.kind),
		);
		if (
			hasMedia &&
			!window.confirm(
				"Media deletion permanently removes the uploaded file and cannot be undone. Continue?",
			)
		)
			return;
		void send(
			"objects.delete",
			selected.map((object) => ({
				id: object.id,
				expectedVersion: object.version,
			})),
			hasMedia,
		);
	};
	const deleteEdges = (edgesToDelete: Edge[]) => {
		const selected = connectors.filter((connector) =>
			edgesToDelete.some((edge) => edge.id === connector.id),
		);
		if (!selected.length) return;
		void send(
			"connectors.delete",
			selected.map((connector) => ({
				id: connector.id,
				expectedVersion: connector.version,
			})),
		);
	};
	const rename = async () => {
		const response = await fetch(`/api/boards/${id}/rename`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				title: projectTitle,
				operationId: crypto.randomUUID(),
			}),
		});
		if (response.ok) {
			setTitle(projectTitle);
			setSettings(false);
		}
	};
	const addMember = async () => {
		const response = await fetch(`/api/boards/${id}/members`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ email: memberEmail }),
		});
		if (response.ok) {
			setMemberEmail("");
			void loadMembers();
		}
	};
	const removeMember = async (userId: string) => {
		const response = await fetch(`/api/boards/${id}/members`, {
			method: "DELETE",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ userId }),
		});
		if (response.ok) void loadMembers();
	};
	const archive = async (archived: boolean) => {
		const response = await fetch(`/api/boards/${id}/archive`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ archived, operationId: crypto.randomUUID() }),
		});
		if (response.ok) {
			setBoardState(archived ? "archived" : "active");
			if (archived) back();
		}
	};
	const deleteBoard = async () => {
		if (
			deleteTitle !== title ||
			!window.confirm(
				"This permanently deletes the board and uploaded files. Continue?",
			)
		)
			return;
		const response = await fetch(`/api/boards/${id}/delete`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				confirmTitle: deleteTitle,
				confirmIrreversible: true,
				operationId: crypto.randomUUID(),
			}),
		});
		if (response.ok) back();
	};
	const openCommentThread = commentThreads.find(
		(thread) => thread.id === openCommentThreadId,
	);
	return (
		<main
			className={`board-workspace relative flex h-dvh min-h-0 flex-col overflow-hidden tool-${tool}`}
		>
			<BoardHeader
				title={title}
				status={connectionStatus}
				back={back}
				settings={() => setSettings(true)}
				undo={() => void undo()}
				redo={() => void redo()}
				canUndo={!!undoStack.length}
				canRedo={!!redoStack.length}
			/>
			{collaborationNotice ? (
				<p role="status" className="board-notice">
					{collaborationNotice}
				</p>
			) : null}
			<CreationTools
				tool={tool}
				setTool={setTool}
				add={add}
				shape={addShape}
				youtube={addYoutube}
				upload={() => {
					uploadPosition.current = mediaPlacement();
					uploadInput.current?.click();
				}}
				snap={snap}
				setSnap={setSnap}
				minimap={minimap}
				setMinimap={setMinimap}
				disabled={boardState !== "active"}
			/>
			{boardState === "active" ? (
				<SelectionTools
					selected={objects.filter((object) => selectedIds.includes(object.id))}
					style={styleSelection}
					copy={copySelection}
					duplicate={() =>
						duplicate(
							objects
								.filter((object) => selectedIds.includes(object.id))
								.map((object) => ({
									id: object.id,
									expectedVersion: object.version,
								})),
						)
					}
					group={() => groupSelection()}
					ungroup={() =>
						deleteNodes(
							nodes.filter(
								(node) =>
									selectedIds.includes(node.id) && node.data.kind === "group",
							),
						)
					}
					stack={stackSelection}
					align={alignSelection}
					distribute={distributeSelection}
					remove={() =>
						deleteNodes(nodes.filter((node) => selectedIds.includes(node.id)))
					}
					edit={() => {
						const object = objects.find((object) =>
							selectedIds.includes(object.id),
						);
						if (object) editObject(object);
					}}
					replace={startReplacement}
				/>
			) : null}
			<input
				ref={uploadInput}
				className="hidden"
				type="file"
				accept="image/*,video/mp4,video/webm,audio/mpeg,audio/wav,audio/ogg,audio/mp4"
				onChange={(event) => {
					const file = event.target.files?.[0];
					if (file)
						void uploadFile(file, uploadPosition.current ?? mediaPlacement());
					uploadPosition.current = null;
					event.currentTarget.value = "";
				}}
			/>
			<input
				ref={replaceInput}
				className="hidden"
				type="file"
				accept="image/*,video/mp4,video/webm,audio/mpeg,audio/wav,audio/ogg,audio/mp4"
				onChange={(event) => {
					const file = event.target.files?.[0];
					if (file) void replaceMedia(file);
					event.currentTarget.value = "";
				}}
			/>

			{accessError ? (
				<section className="mx-auto flex h-full max-w-xl items-center justify-center p-6 text-center text-muted-foreground">
					{accessError}
				</section>
			) : (
				<div className="relative min-h-0 flex-1">
					{tool === "pen" && boardState === "active" ? (
						<PenLayer
							toWorld={(point) =>
								flow.current?.screenToFlowPosition(point) ?? point
							}
							save={(stroke) => {
								void send("objects.create", [{ ...stroke, kind: "freehand" }]);
							}}
						/>
					) : null}
					<ObjectActions.Provider
						value={{
							resize: (objectId, geometry) => {
								const object = objects.find((value) => value.id === objectId);
								if (object)
									void send("objects.update", [
										{
											id: object.id,
											expectedVersion: object.version,
											patch: geometry,
										},
									]);
							},
							readonly: boardState !== "active",
						}}
					>
						<ReactFlowProvider>
							<ReactFlow
								onInit={(instance) => {
									flow.current = instance;
								}}
								proOptions={{ hideAttribution: true }}
								connectionMode={ConnectionMode.Loose}
								snapToGrid={snap}
								snapGrid={[20, 20]}
								nodesDraggable={boardState === "active" && tool === "select"}
								nodesConnectable={boardState === "active" && tool !== "comment"}
								deleteKeyCode={
									boardState === "active" &&
									!editing &&
									!plainEditing &&
									!settings
										? ["Backspace", "Delete"]
										: null
								}
								panOnScroll
								onPointerMove={(event) => {
									if (
										!(event.target as HTMLElement).closest(".react-flow__panel")
									)
										lastCanvasPointer.current = {
											x: event.clientX,
											y: event.clientY,
										};
								}}
								zoomOnScroll={false}
								zoomOnPinch
								nodes={nodes}
								edges={edges}
								onNodesChange={(changes) =>
									setNodes((current) =>
										changeBoardNodes(changes, current, objects),
									)
								}
								onEdgesChange={(changes) =>
									setEdges((current) => applyEdgeChanges(changes, current))
								}
								nodeTypes={nodeTypes}
								onNodeDragStop={drag}
								onNodesDelete={deleteNodes}
								onEdgesDelete={deleteEdges}
								onConnect={connect}
								onReconnect={reconnect}
								onDragOver={(event) => event.preventDefault()}
								onDrop={dropFiles}
								onNodeDoubleClick={(_, node) => {
									const object = objects.find((value) => value.id === node.id);
									if (object) editObject(object);
								}}
								onPaneClick={(event) => {
									if (tool !== "comment") return;
									startComment(
										flow.current?.screenToFlowPosition({
											x: event.clientX,
											y: event.clientY,
										}) ?? { x: event.clientX, y: event.clientY },
									);
								}}
								onNodeClick={(event, node) => {
									if (tool !== "comment") return;
									event.preventDefault();
									event.stopPropagation();
									if (!objects.some((object) => object.id === node.id)) return;
									startComment(
										flow.current?.screenToFlowPosition({
											x: event.clientX,
											y: event.clientY,
										}) ?? { x: event.clientX, y: event.clientY },
										node.id,
									);
								}}
								minZoom={0.01}
								defaultViewport={viewport}
								onMoveEnd={(_, nextViewport) =>
									localStorage.setItem(
										`board-viewport:${id}`,
										JSON.stringify(nextViewport),
									)
								}
								selectionOnDrag={tool === "select"}
								panOnDrag={tool === "hand" ? true : [1, 2]}
							>
								<Background gap={18} />
								<CanvasControls />
								{minimap ? (
									<MiniMap
										pannable
										zoomable
										nodeColor="#64748b"
										maskColor="var(--board-map-mask)"
										style={{ background: "var(--card)" }}
									/>
								) : null}
							</ReactFlow>
							<CursorReporter socketRef={socketRef} />
							<RemoteCursors cursors={cursors} />
							<CommentPins
								threads={commentThreads}
								objects={objects}
								open={setOpenCommentThreadId}
							/>
							<CursorLegend
								cursors={cursors}
								currentUser={{ id: currentUserId, email: currentUserEmail }}
							/>
						</ReactFlowProvider>
					</ObjectActions.Provider>
				</div>
			)}
			{plainEditing ? (
				<ObjectEditor
					object={plainEditing}
					cancel={() => setPlainEditing(null)}
					save={async (patch) => {
						const result = await send("objects.update", [
							{
								id: plainEditing.id,
								expectedVersion: plainEditing.version,
								patch,
							},
						]);
						if (result) setPlainEditing(null);
					}}
				/>
			) : null}
			{editing && (
				<RichTextEditor
					content={
						(editing.data.content as Record<string, unknown>) ?? {
							type: "doc",
							content: [],
						}
					}
					table={editing.kind === "table"}
					onCancel={() => {
						sendTransient({ type: "edit.lease.release", objectId: editing.id });
						setEditing(null);
					}}
					onSave={async (content) => {
						const result = await send("objects.update", [
							{
								id: editing.id,
								expectedVersion: editing.version,
								patch: { content },
							},
						]);
						if (!result) return;
						sendTransient({ type: "edit.lease.release", objectId: editing.id });
						setEditing(null);
					}}
				/>
			)}
			{commentDraft || openCommentThread ? (
				<CommentDialog
					key={commentDraft ? "draft" : openCommentThread?.id}
					thread={openCommentThread ?? null}
					draft={commentDraft}
					readonly={boardState !== "active"}
					close={() => {
						setCommentDraft(null);
						setOpenCommentThreadId(null);
					}}
					create={createComment}
					reply={replyToComment}
				/>
			) : null}
			{settings && (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
					<div className="flex w-full max-w-md flex-col gap-4 rounded-lg border bg-card p-5 shadow-xl">
						<h2 className="text-xl font-semibold">Board settings</h2>
						<label htmlFor="board-title">
							Board title
							<Input
								id="board-title"
								value={projectTitle}
								onChange={(event) => setProjectTitle(event.target.value)}
							/>
						</label>
						<Button disabled={!isOwner} onClick={() => void rename()}>
							Save title
						</Button>
						<label htmlFor="member-email">
							Add existing member
							<Input
								id="member-email"
								type="email"
								value={memberEmail}
								onChange={(event) => setMemberEmail(event.target.value)}
							/>
						</label>
						<Button
							variant="outline"
							disabled={!isOwner}
							onClick={() => void addMember()}
						>
							Add member
						</Button>
						<section className="space-y-2" aria-label="Board members">
							<h3 className="font-medium">Members</h3>
							{memberRows.map((member) => (
								<div
									key={member.id}
									className="flex items-center gap-2 text-sm"
								>
									<span className="flex-1 truncate">{member.email}</span>
									{member.owner ? <span>Owner</span> : null}
									{isOwner ? (
										<Button
											variant="outline"
											disabled={member.owner}
											onClick={() => void removeMember(member.id)}
										>
											Remove
										</Button>
									) : null}
								</div>
							))}
						</section>
						<Button
							variant="destructive"
							disabled={!isOwner}
							onClick={() => void archive(boardState !== "archived")}
						>
							{boardState === "archived" ? "Unarchive board" : "Archive board"}
						</Button>
						<label htmlFor="delete-title">
							Type the board title to permanently delete
							<Input
								id="delete-title"
								value={deleteTitle}
								onChange={(event) => setDeleteTitle(event.target.value)}
							/>
						</label>
						<Button
							variant="destructive"
							disabled={!isOwner || deleteTitle !== title}
							onClick={() => void deleteBoard()}
						>
							Delete permanently
						</Button>
						<Button variant="outline" onClick={() => setSettings(false)}>
							Close
						</Button>
					</div>
				</div>
			)}
		</main>
	);
}
