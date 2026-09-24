import { z } from "zod";

// Inline MCP media is intentionally smaller than the browser's 30 MiB uploads.
export const remoteFileSchema = z.object({
	filename: z.string().min(1).max(255),
	mimeType: z.string().min(1).max(100),
	base64: z
		.string()
		.min(4)
		.max(5_592_408)
		.describe(
			"Base64 file bytes, at most 4 MiB decoded; no data URL or filesystem path.",
		),
});
export function remoteFile(input: z.infer<typeof remoteFileSchema>) {
	if (
		input.base64.length % 4 !== 0 ||
		!/^[A-Za-z0-9+/]*={0,2}$/.test(input.base64)
	)
		throw new Error("Invalid base64 file");
	const bytes = Buffer.from(input.base64, "base64");
	if (bytes.toString("base64") !== input.base64)
		throw new Error("Non-canonical base64 file");
	if (!bytes.length || bytes.length > 4 * 1024 * 1024)
		throw new Error("Inline file must be between 1 byte and 4 MiB");
	return {
		name: input.filename,
		file: new File([bytes], input.filename, { type: input.mimeType }),
	};
}
