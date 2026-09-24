/** Recover a missing OS-provided MIME type from bytes, never from the filename. */
export async function normalizeMediaFile(file: File): Promise<File> {
	if (file.type && file.type !== "application/octet-stream") return file;
	const bytes = new Uint8Array(await file.slice(0, 16).arrayBuffer());
	const ascii = (start: number, end: number) =>
		String.fromCharCode(...bytes.slice(start, end));
	const type =
		ascii(0, 8) === "\x89PNG\r\n\x1a\n"
			? "image/png"
			: bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
				? "image/jpeg"
				: ["GIF87a", "GIF89a"].includes(ascii(0, 6))
					? "image/gif"
					: ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP"
						? "image/webp"
						: ascii(4, 8) === "ftyp" && ["avif", "avis"].includes(ascii(8, 12))
							? "image/avif"
							: "";
	return type
		? new File([file], file.name || "image", {
				type,
				lastModified: file.lastModified,
			})
		: file;
}

/** Read items during drop/paste while the browser's transfer store is accessible. */
export function transferredFiles(
	transfer: Pick<DataTransfer, "files" | "items">,
): File[] {
	const files = Array.from(transfer.files);
	if (files.length) return files;
	return Array.from(transfer.items).flatMap((item) => {
		const file = item.kind === "file" ? item.getAsFile() : null;
		return file ? [file] : [];
	});
}
