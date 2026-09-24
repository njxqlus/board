import { expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { handleRemoteMcp } from "../../src/mcp/http";
import { remoteFile } from "../../src/mcp/remote-file";

test("Streamable HTTP initializes, isolates users, exposes tools/resources and rejects revoked keys", async () => {
	const active = new Set(["Bearer alice", "Bearer bob"]);
	const requests: Request[] = [];
	const options = {
		origin: "https://board.example.test",
		authenticate: async (header: string) => active.has(header),
		dispatch: async (request: Request) => {
			requests.push(request);
			return Response.json({
				user: request.headers.get("authorization"),
				objects: [],
				connectors: [],
				project: { title: "Test" },
				revision: "1",
			});
		},
	};
	const clients = await Promise.all(
		["alice", "bob"].map(async (user) => {
			const client = new Client({ name: user, version: "1" });
			await client.connect(
				new StreamableHTTPClientTransport(new URL(`${options.origin}/mcp`), {
					requestInit: { headers: { authorization: `Bearer ${user}` } },
					fetch: async (input, init) =>
						handleRemoteMcp(new Request(input, init), options),
				}),
			);
			return client;
		}),
	);
	const [alice, bob] = clients;
	if (!alice || !bob) throw new Error("Missing clients");
	try {
		const tools = await alice.listTools();
		expect(tools.tools).toHaveLength(22);
		expect(
			tools.tools.find((t) => t.name === "media_upload")?.inputSchema.required,
		).toContain("file");
		expect(
			(await alice.listResourceTemplates()).resourceTemplates,
		).toHaveLength(2);
		const results = await Promise.all(
			clients.map((c) => c.callTool({ name: "boards_list", arguments: {} })),
		);
		for (const [i, result] of results.entries()) {
			const content = result.content as Array<{ text: string }>;
			expect(JSON.parse(content[0]?.text ?? "{}").user).toBe(
				i === 0 ? "Bearer alice" : "Bearer bob",
			);
		}
		const boardId = "00000000-0000-4000-8000-000000000001";
		expect(
			(await alice.readResource({ uri: `board://${boardId}/summary` }))
				.contents,
		).toHaveLength(1);
		const schema = await alice.readResource({
			uri: `board://${boardId}/schema`,
		});
		expect(JSON.stringify(schema.contents)).toContain("objectSchema");
		const denied = await alice.callTool({
			name: "media_upload",
			arguments: {
				boardId,
				absoluteFilePath: "/etc/passwd",
				operationId: crypto.randomUUID(),
			},
		});
		expect(denied.isError).toBe(true);
		expect(requests.every((r) => !r.headers.has("cookie"))).toBe(true);
		active.delete("Bearer alice");
		await expect(alice.listTools()).rejects.toThrow();
		expect((await bob.listTools()).tools).toHaveLength(22);
	} finally {
		await Promise.all(clients.map((c) => c.close()));
	}
	for (const [headers, status] of [
		[{}, 401],
		[{ authorization: "Bearer invalid" }, 401],
		[{ authorization: "Bearer bob", origin: "https://evil.test" }, 403],
	] as const) {
		expect(
			(
				await handleRemoteMcp(
					new Request(`${options.origin}/mcp`, { headers }),
					options,
				)
			).status,
		).toBe(status);
	}
	const get = await handleRemoteMcp(
		new Request(`${options.origin}/mcp`, {
			headers: { authorization: "Bearer bob" },
		}),
		options,
	);
	expect(get.status).toBe(405);
	const invalid = await handleRemoteMcp(
		new Request(`${options.origin}/mcp`, {
			method: "POST",
			headers: {
				authorization: "Bearer bob",
				"content-type": "application/json",
			},
			body: "{",
		}),
		options,
	);
	expect(invalid.status).toBe(400);
});

test("remote files are bounded inline bytes, never filesystem paths", async () => {
	const value = remoteFile({
		filename: "test.png",
		mimeType: "image/png",
		base64: "aGVsbG8=",
	});
	expect(await value.file.text()).toBe("hello");
	for (const base64 of [
		"!bad",
		"data:image/png;base64,aGVsbG8=",
		"aGVsbG8",
		"Zh==",
	])
		expect(() =>
			remoteFile({ filename: "test", mimeType: "image/png", base64 }),
		).toThrow();
	const base64 = Buffer.alloc(4 * 1024 * 1024 + 1).toString("base64");
	expect(() =>
		remoteFile({ filename: "test", mimeType: "image/png", base64 }),
	).toThrow();
});
