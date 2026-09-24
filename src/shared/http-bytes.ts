/** Parse a single HTTP byte range; suffix ranges count backwards from EOF. */
export function byteRange(
	value: string,
	length: number,
): { start: number; end: number } | null {
	const match = /^bytes=(\d*)-(\d*)$/.exec(value);
	if (
		!match ||
		(!match[1] && !match[2]) ||
		!Number.isSafeInteger(length) ||
		length <= 0
	)
		return null;
	const suffix = !match[1];
	const first = Number(match[1] || match[2]);
	const last = match[2] ? Number(match[2]) : length - 1;
	if (
		!Number.isSafeInteger(first) ||
		!Number.isSafeInteger(last) ||
		(suffix && first <= 0)
	)
		return null;
	const start = suffix ? Math.max(0, length - first) : first;
	const end = suffix ? length - 1 : Math.min(last, length - 1);
	return start > end || start >= length ? null : { start, end };
}

/** Enforce a byte cap while reading, rather than after an unbounded allocation. */
export async function readBounded(
	response: Pick<Response, "body">,
	limit: number,
): Promise<Uint8Array> {
	const reader = response.body?.getReader();
	if (!reader) return new Uint8Array();
	const chunks: Uint8Array[] = [];
	let length = 0;
	try {
		for (;;) {
			const result = await reader.read();
			if (result.done) break;
			length += result.value.byteLength;
			if (length > limit) throw new Error(`Response exceeds ${limit} bytes`);
			chunks.push(result.value);
		}
	} catch (error) {
		await reader.cancel().catch(() => {});
		throw error;
	} finally {
		reader.releaseLock();
	}
	const bytes = new Uint8Array(length);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.length;
	}
	return bytes;
}
