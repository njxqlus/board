import { realpath, stat } from "node:fs/promises";
import { basename, isAbsolute, relative } from "node:path";

export async function permittedFile(absoluteFilePath: string) {
	const root = process.env.BOARD_MCP_UPLOAD_ROOT;
	if (!root)
		throw new Error(
			"BOARD_MCP_UPLOAD_ROOT must be configured before reading local files.",
		);
	if (!isAbsolute(absoluteFilePath))
		throw new Error("absoluteFilePath must be absolute.");
	const [realRoot, filePath] = await Promise.all([
		realpath(root),
		realpath(absoluteFilePath),
	]);
	const relativePath = relative(realRoot, filePath);
	if (
		!relativePath ||
		relativePath === ".." ||
		relativePath.startsWith("../") ||
		isAbsolute(relativePath)
	)
		throw new Error("File must be inside BOARD_MCP_UPLOAD_ROOT.");
	const metadata = await stat(filePath);
	if (!metadata.isFile())
		throw new Error("Only regular files can be uploaded.");
	if (metadata.size > 31_457_280)
		throw new Error("File exceeds the 30 MiB limit.");
	return { file: Bun.file(filePath), name: basename(filePath) };
}
