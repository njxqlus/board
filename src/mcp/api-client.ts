import { readBounded } from "../shared/http-bytes";

export function boardOrigin(
	value = process.env.BOARD_URL ?? "http://localhost:3000",
) {
	const url = new URL(value);
	const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
	if (
		url.username ||
		url.password ||
		(url.protocol !== "https:" && !(url.protocol === "http:" && loopback))
	)
		throw new Error(
			"BOARD_URL must use HTTPS (HTTP is allowed only on loopback).",
		);
	if (url.pathname !== "/" || url.search || url.hash)
		throw new Error(
			"BOARD_URL must be an origin without a path, query or fragment.",
		);
	return url.origin;
}

let token = "";
let authentication: Promise<void> | undefined;
async function login() {
	if (token) return;
	if (!authentication)
		authentication = (async () => {
			const email = process.env.BOARD_EMAIL,
				password = process.env.BOARD_PASSWORD;
			if (!email || !password)
				throw new Error("BOARD_EMAIL and BOARD_PASSWORD are required.");
			const response = await fetch(`${boardOrigin()}/api/mcp/session`, {
				method: "POST",
				redirect: "error",
				signal: AbortSignal.timeout(15000),
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ email, password }),
			});
			if (!response.ok) throw new Error("MCP authentication failed.");
			const result = (await response.json()) as { token?: string };
			if (!result.token) throw new Error("Board did not issue an MCP token.");
			token = result.token;
		})();
	try {
		await authentication;
	} finally {
		authentication = undefined;
	}
}
async function request(path: string, init?: RequestInit): Promise<Response> {
	if (!path.startsWith("/api/") || path.startsWith("//"))
		throw new Error("Invalid board API path");
	for (let attempt = 0; attempt < 2; attempt++) {
		await login();
		const headers = new Headers(init?.headers);
		headers.set("authorization", `Bearer ${token}`);
		const response = await fetch(`${boardOrigin()}${path}`, {
			...init,
			headers,
			redirect: "error",
			signal: AbortSignal.timeout(30000),
		});
		if (response.status !== 401 || attempt === 1) return response;
		await response.body?.cancel();
		token = "";
	}
	throw new Error("MCP authentication failed.");
}
async function json(response: Response) {
	const value = await response.json();
	if (!response.ok)
		throw new Error(
			value.error?.message ?? `Board request failed (${response.status})`,
		);
	return value;
}
export async function api(path: string, init?: RequestInit) {
	const headers = new Headers(init?.headers);
	headers.set("content-type", "application/json");
	return json(await request(path, { ...init, headers }));
}
export async function apiForm(path: string, body: FormData) {
	return json(await request(path, { method: "POST", body }));
}
export async function binary(path: string) {
	const response = await request(path);
	if (!response.ok)
		throw new Error(`Media request failed (${response.status})`);
	return {
		bytes: await readBounded(response, 4 * 1024 * 1024),
		mimeType:
			response.headers.get("content-type") ?? "application/octet-stream",
	};
}
