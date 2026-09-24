import { expect, test } from "bun:test";
import { normalizeYouTubeVideoId } from "../../src/shared/youtube";

const id = "dQw4w9WgXcQ";

test("normalizes canonical YouTube URL forms", () => {
	expect(normalizeYouTubeVideoId(id)).toBe(id);
	expect(normalizeYouTubeVideoId(`https://www.youtube.com/watch?v=${id}`)).toBe(
		id,
	);
	expect(normalizeYouTubeVideoId(`https://youtu.be/${id}?si=test`)).toBe(id);
	expect(normalizeYouTubeVideoId(`https://youtube.com/shorts/${id}`)).toBe(id);
	expect(normalizeYouTubeVideoId(`https://m.youtube.com/embed/${id}`)).toBe(id);
});

test("rejects malformed and lookalike YouTube URLs", () => {
	expect(
		normalizeYouTubeVideoId(`https://notyoutube.com/watch?v=${id}`),
	).toBeUndefined();
	expect(
		normalizeYouTubeVideoId(`https://youtube.com.evil.test/watch?v=${id}`),
	).toBeUndefined();
	expect(normalizeYouTubeVideoId("javascript:alert(1)")).toBeUndefined();
	expect(normalizeYouTubeVideoId("too-short")).toBeUndefined();
});
