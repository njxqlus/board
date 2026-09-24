import { expect, test } from "bun:test";
import { byteRange, readBounded } from "../../src/shared/http-bytes";

test("byte ranges include suffixes, open ends and clamped ends", () => {
	expect(byteRange("bytes=-10", 100)).toEqual({ start: 90, end: 99 });
	expect(byteRange("bytes=25-", 100)).toEqual({ start: 25, end: 99 });
	expect(byteRange("bytes=20-200", 100)).toEqual({ start: 20, end: 99 });
	expect(byteRange("bytes=-200", 100)).toEqual({ start: 0, end: 99 });
	for (const invalid of [
		"bytes=-",
		"bytes=-0",
		"bytes=100-",
		"bytes=20-10",
		"bytes=0-1,3-4",
		"bytes=99999999999999999-",
	])
		expect(byteRange(invalid, 100)).toBeNull();
});
test("stream cap rejects actual bytes without trusting Content-Length", async () => {
	await expect(
		readBounded(
			new Response("12345", { headers: { "content-length": "1" } }),
			4,
		),
	).rejects.toThrow("exceeds");
	expect(
		new TextDecoder().decode(await readBounded(new Response("1234"), 4)),
	).toBe("1234");
});
