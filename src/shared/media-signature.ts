export async function hasExpectedSignature(file: File) {
	const bytes = new Uint8Array(await file.slice(0, 16).arrayBuffer());
	const ascii = (start: number, end: number) =>
		String.fromCharCode(...bytes.slice(start, end));
	if (file.type === "image/jpeg")
		return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
	if (file.type === "image/png") return ascii(0, 8) === "\x89PNG\r\n\x1a\n";
	if (file.type === "image/gif")
		return ascii(0, 6) === "GIF87a" || ascii(0, 6) === "GIF89a";
	if (file.type === "image/webp")
		return ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP";
	if (
		file.type === "image/avif" ||
		file.type === "video/mp4" ||
		file.type === "audio/mp4"
	)
		return ascii(4, 8) === "ftyp";
	if (file.type === "video/webm")
		return (
			bytes[0] === 0x1a &&
			bytes[1] === 0x45 &&
			bytes[2] === 0xdf &&
			bytes[3] === 0xa3
		);
	if (file.type === "audio/mpeg")
		return ascii(0, 3) === "ID3" || bytes[0] === 0xff;
	if (file.type === "audio/wav")
		return ascii(0, 4) === "RIFF" && ascii(8, 12) === "WAVE";
	if (file.type === "audio/ogg") return ascii(0, 4) === "OggS";
	return false;
}
