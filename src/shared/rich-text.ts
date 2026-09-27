export type RichTextDocument = Record<string, unknown>;

export function toRichTextDocument(value: unknown): RichTextDocument {
	if (value && typeof value === "object") return value as RichTextDocument;
	const lines = String(value ?? "").split(/\r?\n/);
	return {
		type: "doc",
		content: lines.map((line) => ({
			type: "paragraph",
			...(line ? { content: [{ type: "text", text: line }] } : {}),
		})),
	};
}
