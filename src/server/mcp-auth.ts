import { createHash, randomBytes, randomUUID } from "node:crypto";
import { auth } from "../lib/auth";
import { sql } from "../lib/db";
import { type Actor, BoardError } from "./board";

const hash = (token: string) =>
	createHash("sha256").update(token).digest("hex");

function requireBrowser(actor: Actor) {
	if (actor.channel !== "browser")
		throw new BoardError(
			403,
			"Manage access keys from your browser session",
			"ACCESS_DENIED",
		);
}
export async function createMcpKey(actor: Actor) {
	requireBrowser(actor);
	const token = `board_mcp_${randomBytes(32).toString("base64url")}`;
	const id = randomUUID();
	const expiresAt = new Date(Date.now() + 90 * 86_400_000);
	await sql.begin(async (tx) => {
		await tx`select id from "user" where id=${actor.id} for update`;
		const [row] = await tx<
			{ count: number }[]
		>`select count(*)::int as count from mcp_sessions where user_id=${actor.id} and label is not null and revoked_at is null and expires_at > now()`;
		if ((row?.count ?? 0) >= 10)
			throw new BoardError(
				409,
				"Revoke an existing key before creating another (maximum 10 active keys)",
			);
		await tx`insert into mcp_sessions ${tx({ id, token_hash: hash(token), user_id: actor.id, channel: "mcp", expires_at: expiresAt, label: "Codex" })}`;
	});
	return { id, token, expiresAt };
}
export async function listMcpKeys(actor: Actor) {
	requireBrowser(actor);
	return sql`select id,label,created_at,expires_at,revoked_at from mcp_sessions where user_id=${actor.id} and label is not null and revoked_at is null and expires_at > now() order by created_at desc`;
}
export async function revokeMcpKey(actor: Actor, id: string) {
	requireBrowser(actor);
	const rows =
		await sql`update mcp_sessions set revoked_at=now() where id=${id} and user_id=${actor.id} and label is not null returning id`;
	if (!rows.length) throw new BoardError(404, "Key not found");
	return { revoked: true };
}
export async function issueMcpSession(
	email: string,
	password: string,
	url: URL,
	sourceIp: string,
) {
	const response = await auth.handler(
		new Request(`${url.origin}/api/auth/sign-in/email`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"x-board-auth-ip": sourceIp,
			},
			body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
		}),
	);
	if (!response.ok)
		throw new BoardError(401, "Invalid credentials", "INVALID_CREDENTIALS");
	const cookie = response.headers.get("set-cookie")?.split(";")[0];
	if (!cookie)
		throw new BoardError(401, "Invalid credentials", "INVALID_CREDENTIALS");
	const session = await auth.api.getSession({
		headers: new Headers({ cookie }),
	});
	if (!session)
		throw new BoardError(401, "Invalid credentials", "INVALID_CREDENTIALS");
	const authOrigin = (process.env.BETTER_AUTH_URL ?? url.origin).replace(
		/\/$/,
		"",
	);
	const signOut = await auth.handler(
		new Request(`${authOrigin}/api/auth/sign-out`, {
			method: "POST",
			headers: { cookie, origin: authOrigin, "x-board-auth-ip": sourceIp },
		}),
	);
	if (!signOut.ok)
		throw new BoardError(
			503,
			"Unable to finalize MCP authentication",
			"MCP_AUTH_FINALIZATION_FAILED",
		);
	const token = randomBytes(32).toString("base64url");
	await sql`insert into mcp_sessions ${sql({ id: randomUUID(), token_hash: hash(token), user_id: session.user.id, channel: "mcp", expires_at: new Date(Date.now() + 86_400_000) })}`;
	return { token, expiresAt: new Date(Date.now() + 86_400_000).toISOString() };
}
export async function actorFromMcpToken(
	header: string | null,
): Promise<Actor | null> {
	if (!header?.startsWith("Bearer ")) return null;
	const token = header.slice(7);
	const rows = await sql<
		{ id: string; email: string }[]
	>`select u.id,u.email from mcp_sessions s join "user" u on u.id=s.user_id where s.token_hash=${hash(token)} and s.channel='mcp' and s.revoked_at is null and s.expires_at > now()`;
	const user = rows[0];
	return user ? { id: user.id, email: user.email, channel: "mcp" } : null;
}
export async function revokeMcpSession(header: string | null) {
	if (!header?.startsWith("Bearer "))
		throw new BoardError(401, "MCP authentication required", "UNAUTHENTICATED");
	const token = header.slice(7);
	const updated = await sql<
		{ id: string }[]
	>`update mcp_sessions set revoked_at=now() where token_hash=${hash(token)} and channel='mcp' and revoked_at is null returning id`;
	if (!updated[0])
		throw new BoardError(401, "MCP authentication required", "UNAUTHENTICATED");
	return { revoked: true };
}
