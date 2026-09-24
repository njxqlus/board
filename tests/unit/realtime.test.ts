import { expect, test } from "bun:test";
import { foreignLease, websocket } from "../../src/server/realtime";

test("leases are per browser client, release on disconnect and do not evict another tab", () => {
	const projectId = crypto.randomUUID();
	const first = {
		data: { projectId, userId: "owner", email: "owner@test", clientId: "one" },
		send: () => 0,
		close: () => {},
	};
	const second = { ...first, data: { ...first.data, clientId: "two" } };
	type Socket = Parameters<typeof websocket.open>[0];
	const one = first as unknown as Socket,
		two = second as unknown as Socket;
	websocket.open(one);
	websocket.open(two);
	websocket.message(
		one,
		JSON.stringify({ type: "edit.lease.acquire", objectId: "object" }),
	);
	expect(foreignLease(projectId, "owner", ["object"], "one")).toBeUndefined();
	expect(foreignLease(projectId, "owner", ["object"], "two")).toBe("object");
	websocket.message(
		two,
		JSON.stringify({ type: "edit.lease.release", objectId: "object" }),
	);
	expect(foreignLease(projectId, "owner", ["object"], "two")).toBe("object");
	websocket.close(one);
	expect(foreignLease(projectId, "owner", ["object"], "two")).toBeUndefined();
	websocket.close(two);
});
