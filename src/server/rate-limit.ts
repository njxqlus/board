import { BoardError } from "./board";

type Entry = { attempts: number; resetAt: number };
const buckets = new Map<string, Entry>();
function rateLimitError(resetAt: number) {
	const retryAfter = Math.ceil((resetAt - Date.now()) / 1000);
	const error = new BoardError(
		429,
		`Too many attempts. Try again in ${retryAfter} seconds.`,
		"RATE_LIMITED",
	);
	(error as BoardError & { retryAfter: number }).retryAfter = retryAfter;
	return error;
}
export function assertRateLimit(key: string, limit: number) {
	const now = Date.now();
	const current = buckets.get(key);
	if (current && current.resetAt > now && current.attempts >= limit)
		throw rateLimitError(current.resetAt);
}
export function recordRateLimitAttempt(key: string, windowMs = 15 * 60_000) {
	const now = Date.now();
	const current = buckets.get(key);
	if (!current || current.resetAt <= now) {
		buckets.set(key, { attempts: 1, resetAt: now + windowMs });
		return;
	}
	current.attempts++;
}
export function checkRateLimit(key: string, limit: number, windowMs?: number) {
	assertRateLimit(key, limit);
	recordRateLimitAttempt(key, windowMs);
}
