import { z } from "zod";

export const LIMITS = {
	coordinate: 1_000_000,
	size: 100_000,
	text: 50_000,
	batch: 100,
} as const;
export const pointSchema = z.object({
	x: z.number().finite().min(-LIMITS.coordinate).max(LIMITS.coordinate),
	y: z.number().finite().min(-LIMITS.coordinate).max(LIMITS.coordinate),
});
const geometry = z.object({
	x: pointSchema.shape.x,
	y: pointSchema.shape.y,
	width: z.number().finite().positive().max(LIMITS.size),
	height: z.number().finite().positive().max(LIMITS.size),
});
const richNodeTypes = new Set([
	"doc",
	"paragraph",
	"text",
	"bulletList",
	"orderedList",
	"listItem",
	"hardBreak",
	"table",
	"tableRow",
	"tableCell",
	"tableHeader",
]);
const richMarkTypes = new Set([
	"bold",
	"italic",
	"underline",
	"link",
	"textStyle",
]);
function safeLink(value: unknown) {
	if (typeof value !== "string" || value.length > 2_000) return false;
	try {
		return ["https:", "http:", "mailto:"].includes(new URL(value).protocol);
	} catch {
		return false;
	}
}
export function isSafeRichText(value: unknown) {
	if (!value || typeof value !== "object") return false;
	if (JSON.stringify(value).length > LIMITS.text) return false;
	let tableRows = 0;
	let tableColumns = 0;
	const visit = (node: unknown, depth: number): boolean => {
		if (!node || typeof node !== "object" || depth > 20) return false;
		const value = node as Record<string, unknown>;
		if (typeof value.type !== "string" || !richNodeTypes.has(value.type))
			return false;
		if (
			value.text !== undefined &&
			(typeof value.text !== "string" || value.text.length > LIMITS.text)
		)
			return false;
		if (value.marks !== undefined) {
			if (!Array.isArray(value.marks)) return false;
			for (const mark of value.marks) {
				if (!mark || typeof mark !== "object") return false;
				const typedMark = mark as { type?: unknown; attrs?: unknown };
				if (
					typeof typedMark.type !== "string" ||
					!richMarkTypes.has(typedMark.type)
				)
					return false;
				if (typedMark.type === "link") {
					const href = (typedMark.attrs as { href?: unknown } | undefined)
						?.href;
					if (!safeLink(href)) return false;
				}
				if (typedMark.type === "textStyle") {
					const attrs = typedMark.attrs as Record<string, unknown> | undefined;
					if (
						!attrs ||
						Object.keys(attrs).some(
							(key) => !["color", "fontSize"].includes(key),
						)
					)
						return false;
					if (
						attrs.color !== undefined &&
						attrs.color !== null &&
						(typeof attrs.color !== "string" ||
							!/^#[0-9a-f]{6}$/i.test(attrs.color))
					)
						return false;
					if (
						attrs.fontSize !== undefined &&
						attrs.fontSize !== null &&
						!["12px", "16px", "24px"].includes(String(attrs.fontSize))
					)
						return false;
				}
			}
		}
		if (
			value.attrs !== undefined &&
			(!value.attrs || typeof value.attrs !== "object")
		)
			return false;
		if (value.attrs) {
			const attrs = value.attrs as Record<string, unknown>;
			const allowed =
				value.type === "paragraph"
					? new Set(["textAlign"])
					: value.type === "orderedList"
						? new Set(["start", "type"])
						: value.type === "tableCell" || value.type === "tableHeader"
							? new Set(["colspan", "rowspan", "colwidth", "align"])
							: new Set<string>();
			if (Object.keys(attrs).some((key) => !allowed.has(key))) return false;
			if (
				attrs.align !== undefined &&
				attrs.align !== null &&
				!["left", "center", "right"].includes(String(attrs.align))
			)
				return false;
			for (const span of [attrs.colspan, attrs.rowspan])
				if (span !== undefined && span !== 1) return false;
			if (
				attrs.colwidth !== undefined &&
				attrs.colwidth !== null &&
				(!Array.isArray(attrs.colwidth) ||
					attrs.colwidth.length > 20 ||
					attrs.colwidth.some(
						(width) =>
							!Number.isSafeInteger(width) || width < 1 || width > LIMITS.size,
					))
			)
				return false;
			if (
				attrs.start !== undefined &&
				(!Number.isSafeInteger(attrs.start) ||
					Number(attrs.start) < 1 ||
					Number(attrs.start) > 100000)
			)
				return false;
			if (
				attrs.type !== undefined &&
				attrs.type !== null &&
				!["1", "a", "A", "i", "I"].includes(String(attrs.type))
			)
				return false;
			if (
				attrs.textAlign !== undefined &&
				attrs.textAlign !== null &&
				!["left", "center", "right"].includes(String(attrs.textAlign))
			)
				return false;
		}
		if (value.type === "tableRow") {
			tableRows++;
			if (tableRows > 100) return false;
			if (
				!Array.isArray(value.content) ||
				value.content.filter(
					(child) =>
						child &&
						typeof child === "object" &&
						["tableCell", "tableHeader"].includes(
							(child as { type?: unknown }).type as string,
						),
				).length > 20
			)
				return false;
		}
		if (value.type === "tableCell" || value.type === "tableHeader")
			tableColumns++;
		if (tableColumns > 2_000) return false;
		if (value.content !== undefined) {
			if (!Array.isArray(value.content)) return false;
			return value.content.every((child) => visit(child, depth + 1));
		}
		return true;
	};
	return (value as { type?: unknown }).type === "doc" && visit(value, 0);
}
const richText = z
	.unknown()
	.refine(isSafeRichText, "Invalid rich text document");
const color = z.string().regex(/^#[0-9a-f]{6}$/i);
const boardStyle = z
	.object({
		fill: color.optional(),
		stroke: color.optional(),
		textColor: color.optional(),
		opacity: z.number().min(0).max(1).optional(),
		strokeWidth: z.number().min(1).max(12).optional(),
	})
	.strict();
const connectorStyle = z
	.object({
		path: z.enum(["straight", "bezier", "orthogonal"]).optional(),
		stroke: color.optional(),
		strokeWidth: z.number().min(1).max(12).optional(),
		strokeDasharray: z.enum(["solid", "dashed", "dotted"]).optional(),
		opacity: z.number().min(0).max(1).optional(),
		markerStart: z.enum(["none", "arrow", "closed-arrow"]).optional(),
		markerEnd: z.enum(["none", "arrow", "closed-arrow"]).optional(),
	})
	.strict();
const base = geometry.extend({
	id: z.uuid().optional(),
	parentId: z.uuid().nullable().optional(),
	zIndex: z.number().int().min(-100_000).max(100_000).optional(),
	style: boardStyle.optional(),
});
export const objectInputSchema = z.discriminatedUnion("kind", [
	base.extend({
		kind: z.enum(["shape", "sticky", "card", "frame", "group"]),
		data: z
			.object({
				label: z.string().max(LIMITS.text).optional(),
				shape: z
					.enum([
						"rectangle",
						"rounded",
						"square",
						"ellipse",
						"circle",
						"triangle",
						"diamond",
					])
					.optional(),
				title: z.string().max(500).optional(),
				body: z.string().max(LIMITS.text).optional(),
			})
			.default({}),
	}),
	base.extend({
		kind: z.enum(["text", "table"]),
		data: z.object({ content: richText, headerRow: z.boolean().optional() }),
	}),
	base.extend({
		kind: z.literal("header"),
		data: z.object({
			text: z
				.string()
				.max(2_000)
				.refine((text) => !/[\r\n]/.test(text), "Header must be a single line"),
			fontSize: z.number().min(24).max(10_000).optional(),
		}),
	}),
	base.extend({
		kind: z.literal("freehand"),
		data: z.object({
			points: z.array(pointSchema).min(2).max(10_000),
			color: z.string().max(32).optional(),
			width: z.number().positive().max(100).optional(),
		}),
	}),
	base.extend({
		kind: z.enum(["image", "video", "audio"]),
		data: z.object({
			assetId: z.uuid(),
			caption: z.string().max(2000).optional(),
			alt: z.string().max(2000).optional(),
		}),
	}),
	base.extend({
		kind: z.literal("youtube"),
		data: z.object({
			videoId: z.string().regex(/^[A-Za-z0-9_-]{11}$/),
			title: z.string().max(500).optional(),
		}),
	}),
]);
export type BoardObjectInput = z.infer<typeof objectInputSchema>;
export const endpointSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("free"), point: pointSchema }),
	z.object({
		kind: z.literal("attached"),
		objectId: z.uuid(),
		anchor: z.object({
			x: z.number().min(0).max(1),
			y: z.number().min(0).max(1),
		}),
	}),
]);
export const connectorInputSchema = z.object({
	id: z.uuid().optional(),
	source: endpointSchema,
	target: endpointSchema,
	style: connectorStyle.optional(),
	label: z.string().max(2000).optional(),
});
export const commandSchema = z
	.object({
		operationId: z.uuid(),
		type: z.enum([
			"objects.create",
			"objects.update",
			"objects.delete",
			"objects.duplicate",
			"objects.group",
			"connectors.create",
			"connectors.update",
			"connectors.delete",
		]),
		changes: z.array(z.unknown()).min(1).max(LIMITS.batch),
		confirmIrreversible: z.boolean().optional(),
	})
	.superRefine((command, ctx) => {
		const target = z.object({
			id: z.uuid(),
			expectedVersion: z.number().int().positive(),
		});
		const schema =
			command.type === "objects.create"
				? objectInputSchema
				: command.type === "connectors.create"
					? connectorInputSchema
					: command.type.endsWith(".update")
						? target.extend({ patch: z.record(z.string(), z.unknown()) })
						: command.type.endsWith(".delete") ||
								command.type === "objects.duplicate"
							? target
							: null;
		if (command.type === "objects.group" && command.changes.length !== 1)
			ctx.addIssue({
				code: "custom",
				message: "Group requires one atomic request",
				path: ["changes"],
			});
		if (!schema) return;
		for (const [index, change] of command.changes.entries()) {
			const result = schema.safeParse(change);
			if (!result.success)
				for (const issue of result.error.issues)
					ctx.addIssue({ ...issue, path: ["changes", index, ...issue.path] });
		}
	});
export function plainText(data: unknown): string {
	return typeof data === "object" && data !== null
		? JSON.stringify(data).replaceAll(
				/\{[^}]*text[^}]*"([^"\n]+)"[^}]*\}/g,
				"$1",
			)
		: "";
}
