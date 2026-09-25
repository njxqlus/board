import { expect, test } from "bun:test";

const databaseUrl = process.env.TEST_DATABASE_URL;
test.skipIf(!databaseUrl)(
	"PostgreSQL command persistence and idempotency",
	async () => {
		const { randomUUID } = await import("node:crypto");
		const {
			command,
			createBoard,
			getProject,
			lifecycleOperation,
			members,
			renameBoard,
		} = await import("../../src/server/board");
		const { sql } = await import("../../src/lib/db");
		const userId = randomUUID();
		const operationId = randomUUID();
		let boardId = "";
		try {
			await sql`insert into "user" (id,name,email,"emailVerified","createdAt","updatedAt") values (${userId},${"Integration owner"},${`integration-${userId}@example.test`},false,now(),now())`;
			const lifecycleId = randomUUID();
			const lifecyclePayload = {
				type: "board.create",
				title: "Integration board",
			};
			const created = await lifecycleOperation(
				{ id: userId, email: "owner@example.test" },
				lifecycleId,
				lifecyclePayload,
				(db) =>
					createBoard(
						{ id: userId, email: "owner@example.test" },
						"Integration board",
						db,
					),
			);
			const replayedCreate = await lifecycleOperation(
				{ id: userId, email: "owner@example.test" },
				lifecycleId,
				lifecyclePayload,
				(db) =>
					createBoard(
						{ id: userId, email: "owner@example.test" },
						"Should not exist",
						db,
					),
			);
			expect(replayedCreate).toEqual(created);
			boardId = created.id;
			const renameId = randomUUID();
			const renamed = await lifecycleOperation(
				{ id: userId, email: "owner@example.test" },
				renameId,
				{
					type: "board.rename",
					id: boardId,
					title: "Renamed integration board",
				},
				(db) =>
					renameBoard(
						{ id: userId, email: "owner@example.test" },
						boardId,
						"Renamed integration board",
						db,
					),
			);
			expect(renamed).toEqual({ title: "Renamed integration board" });
			await expect(
				lifecycleOperation(
					{ id: userId, email: "owner@example.test" },
					renameId,
					{ type: "board.rename", id: boardId, title: "Different title" },
					(db) =>
						renameBoard(
							{ id: userId, email: "owner@example.test" },
							boardId,
							"Different title",
							db,
						),
				),
			).rejects.toMatchObject({ code: "OPERATION_ID_REUSED" });
			await expect(
				members(
					{ id: userId, email: "owner@example.test", channel: "mcp" },
					boardId,
				),
			).rejects.toThrow("Membership management is not permitted");
			await sql`insert into mcp_sessions ${sql({ id: randomUUID(), token_hash: randomUUID().replaceAll("-", ""), user_id: userId, channel: "mcp", expires_at: new Date(Date.now() + 86_400_000) })}`;
			await expect(
				getProject(
					{ id: randomUUID(), email: "outsider@example.test" },
					boardId,
				),
			).rejects.toMatchObject({ status: 403, code: "ACCESS_DENIED" });
			const payload = {
				operationId,
				type: "objects.create",
				changes: [
					{
						kind: "shape",
						x: 0,
						y: 0,
						width: 100,
						height: 80,
						data: { label: "Persisted" },
					},
				],
			};
			const [first, replay] = await Promise.all([
				command({ id: userId, email: "owner@example.test" }, boardId, payload),
				command({ id: userId, email: "owner@example.test" }, boardId, payload),
			]);
			expect(first).toEqual(replay);
			expect((first as { revision?: string }).revision).toBe("1");
			const originalId = (first as { upserts?: Array<{ id?: string }> })
				.upserts?.[0]?.id;
			expect(originalId).toBeTruthy();
			if (!originalId)
				throw new Error("Create command did not return an object ID");
			const duplicated = await command(
				{ id: userId, email: "owner@example.test" },
				boardId,
				{
					operationId: randomUUID(),
					type: "objects.duplicate",
					changes: [{ id: originalId, expectedVersion: 1 }],
				},
			);
			expect((duplicated as { revision?: string }).revision).toBe("2");
			const frameId = randomUUID();
			const childId = randomUUID();
			await command({ id: userId, email: "owner@example.test" }, boardId, {
				operationId: randomUUID(),
				type: "objects.create",
				changes: [
					{
						id: frameId,
						kind: "frame",
						x: 0,
						y: 0,
						width: 400,
						height: 300,
						data: { label: "Frame" },
					},
					{
						id: childId,
						kind: "sticky",
						x: 20,
						y: 30,
						width: 100,
						height: 80,
						parentId: frameId,
						data: { label: "Child" },
					},
				],
			});
			await command({ id: userId, email: "owner@example.test" }, boardId, {
				operationId: randomUUID(),
				type: "objects.update",
				changes: [
					{
						id: frameId,
						expectedVersion: 1,
						patch: { x: 100, y: 40 },
					},
				],
			});
			const child = (
				await sql<{ x: number; y: number; version: number }[]>`
					select x,y,version from board_objects where id=${childId}
				`
			)[0];
			expect(child).toEqual({ x: 120, y: 70, version: 2 });
			const duplicateId = (duplicated as { upserts?: Array<{ id?: string }> })
				.upserts?.[0]?.id;
			if (!duplicateId)
				throw new Error("Duplicate did not return an object ID");
			const groupId = randomUUID();
			await command({ id: userId, email: "owner@example.test" }, boardId, {
				operationId: randomUUID(),
				type: "objects.group",
				changes: [
					{
						group: {
							id: groupId,
							kind: "group",
							x: -10,
							y: -10,
							width: 300,
							height: 200,
							data: { label: "Grouped" },
						},
						children: [
							{ id: originalId, expectedVersion: 1 },
							{ id: duplicateId, expectedVersion: 1 },
						],
					},
				],
			});
			const grouped = await sql<{ parent_id: string | null }[]>`
				select parent_id from board_objects where id in (${originalId},${duplicateId}) order by id
			`;
			expect(grouped.map((row) => row.parent_id)).toEqual([groupId, groupId]);
			const connectorId = randomUUID();
			await command({ id: userId, email: "owner@example.test" }, boardId, {
				operationId: randomUUID(),
				type: "connectors.create",
				changes: [
					{
						id: connectorId,
						source: {
							kind: "attached",
							objectId: originalId,
							anchor: { x: 0.5, y: 0.5 },
						},
						target: {
							kind: "attached",
							objectId: duplicateId,
							anchor: { x: 0.5, y: 0.5 },
						},
					},
				],
			});
			await command({ id: userId, email: "owner@example.test" }, boardId, {
				operationId: randomUUID(),
				type: "connectors.update",
				changes: [
					{
						id: connectorId,
						expectedVersion: 1,
						patch: {
							label: "Updated connector",
							target: { kind: "free", point: { x: 320, y: 40 } },
						},
					},
				],
			});
			const connector = (
				await sql<{ data: { label?: string; target?: { kind?: string } } }[]>`
					select data from board_connectors where id=${connectorId}
				`
			)[0];
			expect(connector?.data).toMatchObject({
				label: "Updated connector",
				target: { kind: "free" },
			});
			const styledId = randomUUID();
			await command({ id: userId, email: "owner@example.test" }, boardId, {
				operationId: randomUUID(),
				type: "objects.create",
				changes: [
					{
						id: styledId,
						kind: "shape",
						x: 12,
						y: 34,
						width: 100,
						height: 80,
						data: { label: "Styled" },
						style: { fill: "#123456" },
					},
				],
			});
			for (const [index, opacity] of [0.4, 0, 1].entries()) {
				await command({ id: userId, email: "owner@example.test" }, boardId, {
					operationId: randomUUID(),
					type: "objects.update",
					changes: [
						{
							id: styledId,
							expectedVersion: index + 1,
							patch: { style: { opacity } },
						},
					],
				});
				const rows =
					await sql`select x,y,data from board_objects where id=${styledId}`;
				expect(rows[0]).toMatchObject({
					x: 12,
					y: 34,
					data: { label: "Styled", style: { fill: "#123456", opacity } },
				});
			}
			await command({ id: userId, email: "owner@example.test" }, boardId, {
				operationId: randomUUID(),
				type: "objects.update",
				changes: [{ id: styledId, expectedVersion: 4, patch: { x: 56 } }],
			});
			const styled =
				await sql`select data from board_objects where id=${styledId}`;
			expect(styled[0]?.data.style).toEqual({ fill: "#123456", opacity: 1 });
			const objects = await sql<
				{ count: string }[]
			>`select count(*)::text as count from board_objects where project_id=${boardId}`;
			expect(objects[0]?.count).toBe("6");
			await command({ id: userId, email: "owner@example.test" }, boardId, {
				operationId: randomUUID(),
				type: "objects.delete",
				changes: [
					{ id: frameId, expectedVersion: 2 },
					{ id: childId, expectedVersion: 2 },
				],
			});
			const remaining = await sql<
				{ count: string }[]
			>`select count(*)::text as count from board_objects where project_id=${boardId}`;
			expect(remaining[0]?.count).toBe("4");
		} finally {
			if (boardId) {
				await sql`delete from command_receipts where project_id=${boardId}`;
				await sql`delete from board_connectors where project_id=${boardId}`;
				await sql`delete from board_objects where project_id=${boardId}`;
				await sql`delete from projects where id=${boardId}`;
			}
			await sql`delete from "user" where id=${userId}`;
			await sql.close();
		}
	},
);
