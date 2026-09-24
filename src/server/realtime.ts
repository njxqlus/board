import type { ServerWebSocket } from "bun";

type Data = {
	projectId: string;
	userId: string;
	email: string;
	clientId: string;
};
type Socket = ServerWebSocket<Data>;
type Lease = {
	userId: string;
	clientId: string;
	email: string;
	expiresAt: number;
};
const rooms = new Map<string, Set<Socket>>();
const leases = new Map<string, Map<string, Lease>>();
const configuredCollaboratorLimit = Number(
	process.env.MAX_BOARD_COLLABORATORS ?? 5,
);
const maxDistinctUsers =
	Number.isInteger(configuredCollaboratorLimit) &&
	configuredCollaboratorLimit > 0 &&
	configuredCollaboratorLimit <= 5
		? configuredCollaboratorLimit
		: 5;
const leaseMs = 15_000;

function users(projectId: string) {
	return new Set(
		[...(rooms.get(projectId) ?? [])].map((socket) => socket.data.userId),
	);
}
function isJoined(ws: Socket) {
	return rooms.get(ws.data.projectId)?.has(ws) ?? false;
}
export function join(ws: Socket) {
	const room = rooms.get(ws.data.projectId) ?? new Set<Socket>();
	const alreadyPresent = users(ws.data.projectId).has(ws.data.userId);
	if (!alreadyPresent && users(ws.data.projectId).size >= maxDistinctUsers)
		return "denied" as const;
	room.add(ws);
	rooms.set(ws.data.projectId, room);
	return !alreadyPresent;
}
export function leave(ws: Socket) {
	const room = rooms.get(ws.data.projectId);
	if (!room?.delete(ws)) return false;
	if (!room.size) rooms.delete(ws.data.projectId);
	return !users(ws.data.projectId).has(ws.data.userId);
}
export function broadcast(projectId: string, event: unknown, except?: Socket) {
	const payload = JSON.stringify(event);
	for (const socket of rooms.get(projectId) ?? [])
		if (socket !== except) socket.send(payload);
}
export function disconnectUser(projectId: string, userId: string) {
	for (const socket of rooms.get(projectId) ?? [])
		if (socket.data.userId === userId)
			socket.close(4003, "Board access revoked");
}
export function disconnectBoard(projectId: string) {
	for (const socket of rooms.get(projectId) ?? [])
		socket.close(4004, "Board is being deleted");
}
export function foreignLease(
	projectId: string,
	userId: string,
	objectIds: Iterable<string>,
	clientId?: string,
) {
	const roomLeases = leases.get(projectId);
	if (!roomLeases) return undefined;
	const now = Date.now();
	for (const objectId of objectIds) {
		const lease = roomLeases.get(objectId);
		if (lease && lease.expiresAt <= now) roomLeases.delete(objectId);
		else if (lease && (lease.userId !== userId || lease.clientId !== clientId))
			return objectId;
	}
	return undefined;
}
function validPoint(value: unknown) {
	if (!value || typeof value !== "object") return false;
	const point = value as { x?: unknown; y?: unknown };
	return (
		typeof point.x === "number" &&
		typeof point.y === "number" &&
		Number.isFinite(point.x) &&
		Number.isFinite(point.y) &&
		Math.abs(point.x) <= 1_000_000_000 &&
		Math.abs(point.y) <= 1_000_000_000
	);
}
function handleLease(ws: Socket, value: Record<string, unknown>) {
	const objectId = value.objectId;
	if (typeof objectId !== "string" || objectId.length > 100) return;
	const roomLeases = leases.get(ws.data.projectId) ?? new Map<string, Lease>();
	leases.set(ws.data.projectId, roomLeases);
	const current = roomLeases.get(objectId);
	const now = Date.now();
	if (value.type === "edit.lease.release") {
		if (current?.clientId !== ws.data.clientId) return;
		roomLeases.delete(objectId);
		broadcast(ws.data.projectId, {
			type: "edit.lease",
			objectId,
			active: false,
			userId: ws.data.userId,
		});
		return;
	}
	if (
		current &&
		current.clientId !== ws.data.clientId &&
		current.expiresAt > now
	) {
		ws.send(
			JSON.stringify({
				type: "edit.lease.denied",
				objectId,
				email: current.email,
			}),
		);
		return;
	}
	roomLeases.set(objectId, {
		userId: ws.data.userId,
		clientId: ws.data.clientId,
		email: ws.data.email,
		expiresAt: now + leaseMs,
	});
	broadcast(ws.data.projectId, {
		type: "edit.lease",
		objectId,
		active: true,
		user: { id: ws.data.userId, email: ws.data.email },
		expiresAt: now + leaseMs,
	});
}
export const websocket = {
	open(ws: Socket) {
		const firstTab = join(ws);
		if (firstTab === "denied") {
			ws.close(4008, "Board collaborator limit reached");
			return;
		}
		if (firstTab)
			broadcast(
				ws.data.projectId,
				{
					type: "presence.join",
					user: { id: ws.data.userId, email: ws.data.email },
				},
				ws,
			);
	},
	message(ws: Socket, message: string | Buffer) {
		if (!isJoined(ws) || typeof message !== "string" || message.length > 131072)
			return;
		try {
			const value = JSON.parse(message) as Record<string, unknown>;
			if (
				(value.type === "presence.cursor" && validPoint(value.position)) ||
				(value.type === "gesture.preview" && validPoint(value.position))
			)
				broadcast(
					ws.data.projectId,
					{ ...value, user: { id: ws.data.userId, email: ws.data.email } },
					ws,
				);
			if (
				value.type === "edit.lease.acquire" ||
				value.type === "edit.lease.release"
			)
				handleLease(ws, value);
		} catch {}
	},
	close(ws: Socket) {
		const lastTab = leave(ws);
		for (const [objectId, lease] of leases.get(ws.data.projectId) ?? [])
			if (lease.clientId === ws.data.clientId) {
				leases.get(ws.data.projectId)?.delete(objectId);
				broadcast(ws.data.projectId, {
					type: "edit.lease",
					objectId,
					active: false,
					userId: ws.data.userId,
				});
			}
		if (!lastTab) return;
		broadcast(ws.data.projectId, {
			type: "presence.leave",
			userId: ws.data.userId,
		});
	},
};
