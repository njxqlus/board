import { expect, test } from "bun:test";
import {
	connectorInputSchema,
	isSafeRichText,
	objectInputSchema,
} from "../../src/shared/board-schema";

test("rejects invalid board geometry", () => {
	expect(() =>
		objectInputSchema.parse({
			kind: "shape",
			x: Number.NaN,
			y: 0,
			width: 10,
			height: 10,
			data: {},
		}),
	).toThrow();
});
test("accepts a bounded free connector", () => {
	const connector = connectorInputSchema.parse({
		source: { kind: "free", point: { x: 0, y: 0 } },
		target: { kind: "free", point: { x: 1, y: 1 } },
		style: {
			path: "bezier",
			stroke: "#112233",
			strokeDasharray: "dashed",
			markerEnd: "closed-arrow",
		},
	});
	expect(connector.source.kind).toBe("free");
	expect(connector.style?.path).toBe("bezier");
	expect(() =>
		connectorInputSchema.parse({
			source: { kind: "free", point: { x: 0, y: 0 } },
			target: { kind: "free", point: { x: 1, y: 1 } },
			style: { path: "teleport" },
		}),
	).toThrow();
});
test("accepts allowed structured text and rejects unsafe links", () => {
	const table = {
		type: "doc",
		content: [
			{
				type: "table",
				content: [
					{
						type: "tableRow",
						content: [
							{
								type: "tableHeader",
								attrs: { colspan: 1, rowspan: 1, colwidth: null, align: null },
								content: [{ type: "paragraph", attrs: { textAlign: null } }],
							},
						],
					},
				],
			},
		],
	};
	expect(isSafeRichText(table)).toBe(true);
	expect(
		isSafeRichText({
			type: "doc",
			content: [
				{
					type: "orderedList",
					attrs: { start: 1, type: null },
					content: [{ type: "listItem", content: [{ type: "paragraph" }] }],
				},
			],
		}),
	).toBe(true);
	expect(
		isSafeRichText({
			type: "doc",
			content: [
				{
					type: "paragraph",
					content: [
						{
							type: "text",
							text: "Safe link",
							marks: [{ type: "link", attrs: { href: "https://example.com" } }],
						},
					],
				},
			],
		}),
	).toBe(true);
	expect(
		isSafeRichText({
			type: "doc",
			content: [
				{
					type: "paragraph",
					attrs: { textAlign: null },
					content: [{ type: "text", text: "Tiptap default alignment" }],
				},
			],
		}),
	).toBe(true);
	expect(
		isSafeRichText({
			type: "doc",
			content: [
				{
					type: "paragraph",
					content: [
						{
							type: "text",
							text: "Unsafe link",
							marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }],
						},
					],
				},
			],
		}),
	).toBe(false);
});
