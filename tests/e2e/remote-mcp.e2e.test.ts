import { expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { chromium } from "playwright";

const databaseUrl = process.env.TEST_DATABASE_URL;
test.skipIf(!databaseUrl)(
	"remote MCP over real HTTP: browser key, mutation, identity isolation and revocation",
	async () => {
		if (
			!databaseUrl ||
			databaseUrl !== process.env.DATABASE_URL ||
			!new URL(databaseUrl).pathname.includes("test")
		)
			throw new Error(
				"Use an isolated test database; DATABASE_URL must equal TEST_DATABASE_URL",
			);
		const origin = process.env.BETTER_AUTH_URL ?? "http://localhost:3057";
		if (new URL(origin).hostname !== "localhost")
			throw new Error("Remote MCP test server must be localhost");
		const { provisioningAuth, databasePool } = await import(
			"../../src/lib/auth"
		);
		const { sql } = await import("../../src/lib/db");
		const password = "Mcp-Test-Only-918237!";
		const email = `mcp-${crypto.randomUUID()}@example.test`;
		const otherEmail = `mcp-${crypto.randomUUID()}@example.test`;
		await provisioningAuth.api.signUpEmail({
			body: { email, password, name: "MCP test owner" },
		});
		await provisioningAuth.api.signUpEmail({
			body: { email: otherEmail, password, name: "MCP test outsider" },
		});
		const processHandle = Bun.spawn([process.execPath, "src/index.ts"], {
			env: {
				...process.env,
				NODE_ENV: "production",
				HOST: "127.0.0.1",
				PORT: new URL(origin).port,
			},
			stdout: "ignore",
			stderr: "inherit",
		});
		const browser = await chromium.launch({ headless: true });
		const clients: Client[] = [];
		try {
			for (let attempt = 0; attempt < 50; attempt++) {
				try {
					if ((await fetch(`${origin}/health/ready`)).ok) break;
				} catch {}
				await Bun.sleep(100);
			}
			const page = await browser.newPage();
			await page.goto(origin);
			await page.getByLabel("Email", { exact: true }).fill(email);
			await page.getByLabel("Password", { exact: true }).fill(password);
			await page.getByRole("button", { name: "Sign in", exact: true }).click();
			await page.getByRole("heading", { name: "Your boards" }).waitFor();
			await page.getByRole("button", { name: "Connect Codex / MCP" }).click();
			page.on("dialog", (dialog) => dialog.accept());
			await page
				.getByRole("button", { name: "Create access key", exact: true })
				.click();
			const keyElement = page.getByTestId("new-mcp-key");
			await keyElement.waitFor();
			const token = await keyElement.textContent();
			if (!token) throw new Error("No access key");
			const stored = await sql<
				{ token_hash: string }[]
			>`select token_hash from mcp_sessions where label='Codex'`;
			expect(
				stored.every(
					(row) => row.token_hash !== token && row.token_hash.length === 64,
				),
			).toBe(true);
			const connect = async (token: string) => {
				const client = new Client({
					name: "remote-verification",
					version: "1",
				});
				await client.connect(
					new StreamableHTTPClientTransport(new URL(`${origin}/mcp`), {
						requestInit: { headers: { authorization: `Bearer ${token}` } },
					}),
				);
				clients.push(client);
				return client;
			};
			const client = await connect(token);
			expect((await client.listTools()).tools).toHaveLength(22);
			const call = async (name: string, args: Record<string, unknown>) => {
				const result = await client.callTool({ name, arguments: args });
				if (result.isError) throw new Error(JSON.stringify(result.content));
				return JSON.parse(
					(result.content as Array<{ text: string }>)[0]?.text ?? "null",
				);
			};
			const board = await call("board_create", {
				title: "Remote MCP verification",
				operationId: crypto.randomUUID(),
			});
			const operationId = crypto.randomUUID();
			const create = {
				boardId: board.id,
				operationId,
				objects: [
					{
						kind: "text",
						x: 200,
						y: 180,
						width: 400,
						height: 200,
						data: {
							content: {
								type: "doc",
								content: [
									{
										type: "paragraph",
										content: [
											{ type: "text", text: "Written through remote MCP" },
										],
									},
								],
							},
						},
					},
				],
			};
			expect(await call("objects_create", create)).toEqual(
				await call("objects_create", create),
			);
			expect(
				(await call("board_get", { boardId: board.id })).objects,
			).toHaveLength(1);
			const context = page.context();
			const listing = await context.request.get(`${origin}/api/mcp/keys`);
			const keys = await listing.json();
			expect(JSON.stringify(keys)).not.toContain(token);
			expect(keys).toHaveLength(1);
			// A valid bearer cannot issue keys, and browser mutations require Origin.
			expect(
				(
					await fetch(`${origin}/api/mcp/keys`, {
						method: "POST",
						headers: { authorization: `Bearer ${token}` },
					})
				).status,
			).toBe(403);
			expect(
				(await context.request.post(`${origin}/api/mcp/keys`)).status(),
			).toBe(403);
			const login = await fetch(`${origin}/api/mcp/session`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ email: otherEmail, password }),
			});
			const outsider = await connect((await login.json()).token);
			expect(
				(
					await outsider.callTool({
						name: "board_get",
						arguments: { boardId: board.id },
					})
				).isError,
			).toBe(true);
			expect(
				await outsider
					.readResource({ uri: `board://${board.id}/summary` })
					.then(
						() => false,
						() => true,
					),
			).toBe(true);
			await page.goto(`${origin}/board/${board.id}`);
			await page
				.getByText("Written through remote MCP", { exact: true })
				.waitFor();
			expect(
				await page
					.getByText("Written through remote MCP", { exact: true })
					.isVisible(),
			).toBe(true);
			await page.getByRole("button", { name: "Back to boards" }).click();
			await page.getByRole("button", { name: "Connect Codex / MCP" }).click();
			await page.getByRole("button", { name: /^Revoke key / }).click();
			await page
				.getByRole("button", { name: /^Revoke key / })
				.waitFor({ state: "hidden" });
			await expect(client.listTools()).rejects.toThrow();
			expect((await fetch(`${origin}/mcp`)).status).toBe(401);
			await page.setViewportSize({ width: 390, height: 844 });
			expect(
				await page.evaluate(
					() => document.documentElement.scrollWidth <= innerWidth,
				),
			).toBe(true);
		} finally {
			await Promise.all(clients.map((client) => client.close()));
			await browser.close();
			processHandle.kill();
			await processHandle.exited;
			await databasePool.end();
			await sql.close();
		}
	},
	30000,
);
