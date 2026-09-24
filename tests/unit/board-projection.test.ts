import { expect, test } from "bun:test";
import {
	projectEdges,
	projectNodes,
} from "../../src/features/board/projection";
import type { ConnectorRow, ObjectRow } from "../../src/features/board/types";
import { objectInputSchema } from "../../src/shared/board-schema";
import { defaultObject } from "../../src/shared/object-defaults";

test("all toolbar defaults are valid and tables have actual cells", () => {
	for (const kind of [
		"shape",
		"sticky",
		"card",
		"text",
		"table",
		"frame",
		"group",
	])
		expect(
			objectInputSchema.safeParse(defaultObject(kind, { x: -10, y: 20 }))
				.success,
		).toBe(true);
});
test("projection preserves arbitrary attachment points and hides free anchors", () => {
	const object: ObjectRow = {
		id: "object",
		kind: "shape",
		x: -20,
		y: 10,
		width: 100,
		height: 60,
		data: {},
		version: 1,
	};
	const connector: ConnectorRow = {
		id: "edge",
		version: 1,
		data: {
			source: {
				kind: "attached",
				objectId: "object",
				anchor: { x: 0.2, y: 0 },
			},
			target: { kind: "free", point: { x: 300, y: 300 } },
		},
	};
	const nodes = projectNodes([object], [connector], "board");
	expect(nodes).toHaveLength(2);
	expect(nodes[0]).toMatchObject({ width: 100, height: 60 });
	expect(nodes[0]?.style?.width).toBeUndefined();
	expect(nodes[0]?.data.anchors).toEqual([{ x: 0.2, y: 0 }]);
	expect(nodes[1]).toMatchObject({
		selectable: false,
		draggable: false,
		position: { x: 300, y: 300 },
	});
	expect(projectEdges([connector])[0]).toMatchObject({
		sourceHandle: "anchor:0.2:0",
		target: "anchor:edge:target",
	});
	expect(object).not.toHaveProperty("selected");
});
