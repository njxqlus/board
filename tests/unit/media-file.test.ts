import { expect, test } from "bun:test";
import {
	normalizeMediaFile,
	transferredFiles,
} from "../../src/shared/media-file";
import { hasExpectedSignature } from "../../src/shared/media-signature";

test("OS screenshot files without MIME are detected by bytes, not filename", async () => {
	const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
	for (const type of ["", "application/octet-stream"]) {
		const file = await normalizeMediaFile(
			new File([png], "Screenshot at 10.45.00 AM.png", { type }),
		);
		expect(file.type).toBe("image/png");
		expect(await hasExpectedSignature(file)).toBe(true);
		expect(file.name).toBe("Screenshot at 10.45.00 AM.png");
	}
	const fake = await normalizeMediaFile(
		new File(["not an image"], "screenshot.png"),
	);
	expect(fake.type).toBe("");
	const mismatch = await normalizeMediaFile(
		new File([png], "test.jpg", { type: "image/jpeg" }),
	);
	expect(await hasExpectedSignature(mismatch)).toBe(false);
});

test("file transfer falls back to items without duplicating files", () => {
	const file = new File(["bytes"], "test.png");
	const transfer = (files: File[]) =>
		({
			files,
			items: [{ kind: "file", getAsFile: () => file }],
		}) as unknown as DataTransfer;
	expect(transferredFiles(transfer([]))).toEqual([file]);
	expect(transferredFiles(transfer([file]))).toEqual([file]);
});
