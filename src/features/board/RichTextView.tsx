import type { JSONContent } from "@tiptap/react";
import { type CSSProperties, createElement, type ReactNode } from "react";

// Render a small allowlist as React elements, never trusted HTML or DOM attributes.
function render(node: JSONContent, key: string): ReactNode {
	if (node.type === "text") {
		let text: ReactNode = node.text ?? "";
		for (const [index, mark] of (node.marks ?? []).entries()) {
			const markKey = `${key}-mark-${index}`;
			if (mark.type === "bold") text = <strong key={markKey}>{text}</strong>;
			if (mark.type === "italic") text = <em key={markKey}>{text}</em>;
			if (mark.type === "underline") text = <u key={markKey}>{text}</u>;
			if (mark.type === "textStyle") {
				const color = /^#[\da-f]{6}$/i.test(mark.attrs?.color ?? "")
					? mark.attrs?.color
					: undefined;
				const fontSize = ["12px", "16px", "24px"].includes(mark.attrs?.fontSize)
					? mark.attrs?.fontSize
					: undefined;
				text = (
					<span key={markKey} style={{ color, fontSize }}>
						{text}
					</span>
				);
			}
			if (
				mark.type === "link" &&
				/^(https?:\/\/|mailto:)/i.test(mark.attrs?.href ?? "")
			)
				text = (
					<a
						key={markKey}
						className="nodrag"
						href={mark.attrs?.href}
						target="_blank"
						rel="noopener noreferrer"
					>
						{text}
					</a>
				);
		}
		return <span key={key}>{text}</span>;
	}
	const children = node.content?.map((child, index) =>
		render(child, `${key}-${index}`),
	);
	if (node.type === "doc") return children;
	if (node.type === "hardBreak") return <br key={key} />;
	if (node.type === "table")
		return (
			<table key={key}>
				<tbody>{children}</tbody>
			</table>
		);
	const tags: Record<string, string> = {
		paragraph: "p",
		bulletList: "ul",
		orderedList: "ol",
		listItem: "li",
		tableRow: "tr",
		tableCell: "td",
		tableHeader: "th",
	};
	const tag = tags[node.type ?? ""];
	if (!tag) return null;
	const style: CSSProperties = {};
	if (["left", "center", "right"].includes(node.attrs?.textAlign))
		style.textAlign = node.attrs?.textAlign;
	if (
		Array.isArray(node.attrs?.colwidth) &&
		Number.isFinite(node.attrs?.colwidth[0])
	)
		style.width = node.attrs?.colwidth[0];
	return createElement(
		tag,
		{ key, style },
		children?.length ? children : <br />,
	);
}

export function RichTextView({ content }: { content: unknown }) {
	return (
		<div className="board-rich-text">
			{content && typeof content === "object"
				? render(content as JSONContent, "doc")
				: null}
		</div>
	);
}
