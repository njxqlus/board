import type { BoardObjectInput } from "./board-schema";

export function defaultObject(
	kind: string,
	position: { x: number; y: number },
): BoardObjectInput {
	const base = { ...position, width: 200, height: 140 };
	switch (kind) {
		case "header":
			return {
				...base,
				width: 1_600,
				height: 220,
				kind,
				data: { text: "Header", fontSize: 160 },
			};
		case "text":
			return {
				...base,
				width: 260,
				height: 80,
				kind,
				data: {
					content: {
						type: "doc",
						content: [
							{
								type: "paragraph",
								content: [{ type: "text", text: "Double-click to edit" }],
							},
						],
					},
				},
			};
		case "table":
			return {
				...base,
				width: 360,
				height: 180,
				kind,
				data: {
					content: {
						type: "doc",
						content: [
							{
								type: "table",
								content: Array.from({ length: 3 }, (_, row) => ({
									type: "tableRow",
									content: Array.from({ length: 3 }, (_, column) => ({
										type: row === 0 ? "tableHeader" : "tableCell",
										content: [
											{
												type: "paragraph",
												content: [
													{
														type: "text",
														text: row === 0 ? `Column ${column + 1}` : " ",
													},
												],
											},
										],
									})),
								})),
							},
						],
					},
				},
			};
		case "sticky":
			return {
				...base,
				height: 200,
				kind,
				data: { label: "Double-click to write" },
				style: { fill: "#fff1a8", textColor: "#1e293b" },
			};
		case "card":
			return {
				...base,
				width: 260,
				height: 180,
				kind,
				data: { title: "Card title", body: "Double-click to edit" },
			};
		case "frame":
			return {
				...base,
				width: 640,
				height: 420,
				kind,
				zIndex: -1,
				data: { label: "Frame" },
			};
		case "group":
			return { ...base, kind, zIndex: -1, data: {} };
		default:
			return {
				...base,
				kind: "shape",
				data: { shape: "rectangle", label: "" },
			};
	}
}
