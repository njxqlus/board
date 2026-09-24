const videoId = /^[A-Za-z0-9_-]{11}$/;
const youtubeHosts = new Set([
	"youtube.com",
	"www.youtube.com",
	"m.youtube.com",
	"music.youtube.com",
]);

/** Accept canonical IDs and ordinary YouTube watch, short, and embed URLs only. */
export function normalizeYouTubeVideoId(value: string) {
	const input = value.trim();
	if (videoId.test(input)) return input;
	try {
		const url = new URL(input);
		if (!["https:", "http:"].includes(url.protocol)) return undefined;
		const host = url.hostname.toLowerCase();
		if (host === "youtu.be") {
			const id = url.pathname.split("/").filter(Boolean)[0];
			return id && videoId.test(id) ? id : undefined;
		}
		if (!youtubeHosts.has(host)) return undefined;
		const segments = url.pathname.split("/").filter(Boolean);
		const id =
			url.pathname === "/watch"
				? url.searchParams.get("v")
				: ["shorts", "embed", "live"].includes(segments[0] ?? "")
					? segments[1]
					: undefined;
		return id && videoId.test(id) ? id : undefined;
	} catch {
		return undefined;
	}
}
