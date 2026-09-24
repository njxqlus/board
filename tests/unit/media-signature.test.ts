import { expect, test } from "bun:test";
import { hasExpectedSignature } from "../../src/shared/media-signature";

test("accepts PNG magic bytes", async () => {
	const file = new File(
		[new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
		"image.png",
		{ type: "image/png" },
	);
	expect(await hasExpectedSignature(file)).toBe(true);
});
test("rejects a PNG MIME label on non-PNG bytes", async () => {
	const file = new File(["not a PNG"], "fake.png", { type: "image/png" });
	expect(await hasExpectedSignature(file)).toBe(false);
});
