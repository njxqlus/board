import { randomUUID } from "node:crypto";
import { relative, resolve } from "node:path";
import { ZodError } from "zod";
import { auth } from "../lib/auth";
import { readBounded } from "../shared/http-bytes";
import { BoardError } from "./board-context";
import { actorFromMcpToken } from "./mcp-auth";
export const production = process.env.NODE_ENV === "production";
const distRoot = resolve(process.cwd(), "dist");
const productionCsp = [
	"default-src 'self'",
	"base-uri 'self'",
	"object-src 'none'",
	"frame-ancestors 'none'",
	"script-src 'self'",
	"style-src 'self' 'unsafe-inline'",
	"img-src 'self' data:",
	"media-src 'self'",
	"connect-src 'self' ws: wss:",
	"frame-src https://www.youtube-nocookie.com",
	"form-action 'self'",
].join("; ");

export async function productionClientResponse(url: URL) {
	const pathname = decodeURIComponent(url.pathname);
	const requested = pathname === "/" ? "index.html" : pathname.slice(1);
	const candidate = resolve(distRoot, requested);
	const pathFromDist = relative(distRoot, candidate);
	if (!pathFromDist.startsWith("..") && !pathFromDist.includes("../")) {
		const file = Bun.file(candidate);
		if (await file.exists())
			return new Response(file, {
				headers: {
					"cache-control":
						requested === "index.html"
							? "no-cache"
							: "public, max-age=31536000, immutable",
					...(requested === "index.html"
						? { "content-security-policy": productionCsp }
						: {}),
				},
			});
	}
	if (requested.includes("."))
		return new Response("Not found", { status: 404 });
	return new Response(Bun.file(resolve(distRoot, "index.html")), {
		headers: {
			"cache-control": "no-cache",
			"content-security-policy": productionCsp,
		},
	});
}

export async function actor(req: Request) {
	const mcp = await actorFromMcpToken(req.headers.get("authorization"));
	if (mcp) return mcp;
	const session = await auth.api.getSession({ headers: req.headers });
	if (!session)
		throw new BoardError(401, "Authentication required", "UNAUTHENTICATED");
	return {
		id: session.user.id,
		email: session.user.email,
		clientId: `${session.session.id}:${(req.headers.get("x-board-client") ?? new URL(req.url).searchParams.get("clientId") ?? "").slice(0, 100)}`,
		channel: "browser" as const,
	};
}
export function assertMutationOrigin(
	req: Request,
	currentActor: Awaited<ReturnType<typeof actor>>,
) {
	if (
		currentActor.channel === "mcp" ||
		!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)
	)
		return;
	const expected = new URL(
		process.env.BETTER_AUTH_URL ?? new URL(req.url).origin,
	).origin;
	if (req.headers.get("origin") !== expected)
		throw new BoardError(403, "Invalid request origin", "ORIGIN_DENIED");
}
export function assertWebSocketOrigin(
	req: Request,
	currentActor: Awaited<ReturnType<typeof actor>>,
) {
	if (currentActor.channel === "mcp")
		throw new BoardError(403, "MCP sessions cannot open board sockets");
	const expected = new URL(
		process.env.BETTER_AUTH_URL ?? new URL(req.url).origin,
	).origin;
	if (req.headers.get("origin") !== expected)
		throw new BoardError(403, "Invalid request origin", "ORIGIN_DENIED");
}
export function rateLimitSource(req: Request, address?: string) {
	if (process.env.TRUST_PROXY !== "true") return address ?? "unknown";
	return req.headers.get("x-real-ip") ?? "proxy-unknown";
}
export function fail(value: unknown) {
	const e =
		value instanceof BoardError
			? value
			: value instanceof ZodError
				? new BoardError(400, "Invalid request", "VALIDATION_ERROR")
				: new BoardError(500, "Unexpected server error");
	return Response.json(
		{ error: { code: e.code, message: e.message }, requestId: randomUUID() },
		{
			status: e.status,
			headers:
				"retryAfter" in e
					? {
							"retry-after": String(
								(e as BoardError & { retryAfter: number }).retryAfter,
							),
						}
					: undefined,
		},
	);
}
export async function body(req: Request) {
	if (Number(req.headers.get("content-length") ?? 0) > 2 * 1024 * 1024)
		throw new BoardError(413, "Request is too large");
	let bytes: Uint8Array;
	try {
		bytes = await readBounded(req, 2 * 1024 * 1024);
	} catch {
		throw new BoardError(413, "Request is too large");
	}
	try {
		return JSON.parse(new TextDecoder().decode(bytes));
	} catch {
		throw new BoardError(400, "Malformed JSON", "VALIDATION_ERROR");
	}
}
