import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { readBounded } from "../shared/http-bytes";
import { remoteClient } from "./remote-client";
import { createMcpServer } from "./tools";

export async function handleRemoteMcp(
	request: Request,
	options: {
		origin: string;
		authenticate: (authorization: string) => Promise<boolean>;
		dispatch: (request: Request) => Promise<Response>;
	},
) {
	const error = (status: number, message: string) =>
		Response.json(
			{ jsonrpc: "2.0", error: { code: -32000, message }, id: null },
			{
				status,
				headers: {
					"cache-control": "no-store",
					...(status === 401
						? { "www-authenticate": 'Bearer realm="board-mcp"' }
						: {}),
				},
			},
		);
	const origin = request.headers.get("origin");
	if (origin !== null && origin !== options.origin)
		return error(403, "Invalid request origin");
	const authorization = request.headers.get("authorization") ?? "";
	if (
		!authorization.startsWith("Bearer ") ||
		!(await options.authenticate(authorization))
	)
		return error(401, "A valid MCP access key is required");
	if (request.method !== "POST") {
		const response = error(405, "Stateless MCP accepts POST only");
		response.headers.set("allow", "POST");
		return response;
	}
	if (
		!request.headers
			.get("content-type")
			?.toLowerCase()
			.startsWith("application/json")
	)
		return error(415, "Expected application/json");
	let bytes: Uint8Array;
	try {
		bytes = await readBounded(new Response(request.body), 6 * 1024 * 1024);
	} catch {
		return error(413, "MCP request exceeds 6 MiB");
	}
	let parsedBody: unknown;
	try {
		parsedBody = JSON.parse(new TextDecoder().decode(bytes));
	} catch {
		return error(400, "Invalid JSON");
	}
	const transport = new WebStandardStreamableHTTPServerTransport({
		sessionIdGenerator: undefined,
		enableJsonResponse: true,
	});
	const server = createMcpServer(
		remoteClient(options.dispatch, authorization),
		true,
	);
	try {
		await server.connect(transport);
		const response = await transport.handleRequest(request, { parsedBody });
		response.headers.set("cache-control", "no-store");
		return response;
	} finally {
		await server.close();
	}
}
