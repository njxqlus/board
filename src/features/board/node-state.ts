import { applyNodeChanges, type Node, type NodeChange } from "@xyflow/react";
import type { ObjectRow } from "./types";

/** Keep React Flow's transient geometry local; move container children in world space. */
export function changeBoardNodes(
	changes: NodeChange[],
	current: Node[],
	objects: ObjectRow[],
) {
	const changed = new Set(
		changes.map((change) => ("id" in change ? change.id : "")),
	);
	const deltas = new Map<string, { x: number; y: number }>();
	const previous = new Map(current.map((node) => [node.id, node]));
	for (const change of changes) {
		if (change.type !== "position" || !change.dragging || !change.position)
			continue;
		const old = previous.get(change.id);
		if (!old || !["frame", "group"].includes(String(old.data.kind))) continue;
		deltas.set(change.id, {
			x: change.position.x - old.position.x,
			y: change.position.y - old.position.y,
		});
	}
	const parents = new Map(
		objects.map((object) => [object.id, object.parentId]),
	);
	return applyNodeChanges(changes, current).map((node) => {
		const parentId = parents.get(node.id);
		const delta = parentId ? deltas.get(parentId) : undefined;
		return delta && !changed.has(node.id)
			? {
					...node,
					position: {
						x: node.position.x + delta.x,
						y: node.position.y + delta.y,
					},
				}
			: node;
	});
}
