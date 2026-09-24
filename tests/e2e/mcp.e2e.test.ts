import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

test.skipIf(
	!process.env.E2E_BASE_URL ||
		!process.env.E2E_EMAIL ||
		!process.env.E2E_PASSWORD,
)(
	"real stdio MCP lifecycle, content and optional DAM upload",
	async () => {
		const directory = await mkdtemp(join(tmpdir(), "board-mcp-test-"));
		const client = new Client({ name: "board-regression", version: "1" });
		const transport = new StdioClientTransport({
			command: process.execPath,
			args: [resolve("src/mcp/server.ts")],
			env: {
				PATH: process.env.PATH ?? "",
				BOARD_URL: process.env.E2E_BASE_URL ?? "",
				BOARD_EMAIL: process.env.E2E_EMAIL ?? "",
				BOARD_PASSWORD: process.env.E2E_PASSWORD ?? "",
				BOARD_MCP_UPLOAD_ROOT: directory,
			},
		});
		let boardId = "";
		const title = `MCP regression ${crypto.randomUUID()}`;
		const call = async (name: string, args: Record<string, unknown>) => {
			const result = await client.callTool({ name, arguments: args });
			if (result.isError) throw new Error(JSON.stringify(result.content));
			const content = result.content as Array<{ type: string; text?: string }>;
			return JSON.parse(
				content.find((item) => item.type === "text")?.text ?? "null",
			);
		};
		try {
			await client.connect(transport);
			const tools = await client.listTools();
			expect(tools.tools.map((tool) => tool.name)).toContain("objects_create");
			expect(tools.tools.some((tool) => tool.name.includes("member"))).toBe(
				false,
			);
			boardId = (
				await call("board_create", { title, operationId: crypto.randomUUID() })
			).id;
			const operationId = crypto.randomUUID();
			const input = {
				boardId,
				operationId,
				objects: [
					{
						kind: "shape",
						x: 10,
						y: 20,
						width: 200,
						height: 100,
						data: { label: "From MCP" },
					},
				],
			};
			const created = await call("objects_create", input);
			expect(await call("objects_create", input)).toEqual(created);
			const snapshot = await call("board_get", { boardId });
			expect(snapshot.objects).toHaveLength(1);
			await call("objects_update", {
				boardId,
				operationId: crypto.randomUUID(),
				updates: [
					{
						id: snapshot.objects[0].id,
						expectedVersion: 1,
						patch: { style: { opacity: 0.4 } },
					},
				],
			});
			expect(
				(await call("board_get", { boardId })).objects[0].data.style.opacity,
			).toBe(0.4);
			const resources = await client.readResource({
				uri: `board://${boardId}/summary`,
			});
			expect(resources.contents).toHaveLength(1);
			if (process.env.E2E_DAM === "1") {
				const path = join(directory, "pixel.png");
				await Bun.write(
					path,
					Buffer.from(
						"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRZkAAAAASUVORK5CYII=",
						"base64",
					),
				);
				await call("media_upload", {
					boardId,
					absoluteFilePath: path,
					operationId: crypto.randomUUID(),
				});
				const uploaded = (await call("board_get", { boardId })).objects.find(
					(object: { kind: string }) => object.kind === "image",
				);
				expect(uploaded).toBeTruthy();
				const image = await client.callTool({
					name: "media_read",
					arguments: { boardId, objectId: uploaded.id, mode: "image" },
				});
				expect((image.content as Array<{ type: string }>)[0]?.type).toBe(
					"image",
				);
				await call("objects_delete", {
					boardId,
					operationId: crypto.randomUUID(),
					confirmIrreversible: true,
					targets: [{ id: uploaded.id, expectedVersion: uploaded.version }],
				});
				expect((await call("board_get", { boardId })).objects).toHaveLength(1);
			}
		} finally {
			if (boardId)
				await call("board_delete", {
					boardId,
					operationId: crypto.randomUUID(),
					confirmTitle: title,
					confirmIrreversible: true,
				});
			await client.close();
			await rm(directory, { recursive: true });
		}
	},
	30000,
);
