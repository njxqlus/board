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
	const containers = new Map<string, ObjectRow>();
	const previous = new Map(current.map((node) => [node.id, node]));
	const objectsById = new Map(objects.map((object) => [object.id, object]));
	const groupAncestorId = (id: string) => {
		let current = objectsById.get(id);
		while (current) {
			const target = current;
			const parent = target.parentId
				? objectsById.get(target.parentId)
				: objects
						.filter(
							(frame) =>
								frame.kind === "frame" &&
								frame.id !== target.id &&
								frame.x <= target.x &&
								frame.y <= target.y &&
								frame.x + frame.width >= target.x + target.width &&
								frame.y + frame.height >= target.y + target.height,
						)
						.toSorted((a, b) => a.width * a.height - b.width * b.height)[0];
			if (parent?.kind === "group") return parent.id;
			if (!parent || parent.id === current.id) return undefined;
			current = parent;
		}
		return undefined;
	};
	for (const change of changes) {
		if (change.type !== "position" || !change.dragging || !change.position)
			continue;
		const old = previous.get(change.id);
		if (!old) continue;
		const containerId =
			groupAncestorId(change.id) ??
			(String(old.data.kind) === "frame" || String(old.data.kind) === "group"
				? change.id
				: undefined);
		if (!containerId) continue;
		deltas.set(containerId, {
			x: change.position.x - old.position.x,
			y: change.position.y - old.position.y,
		});
		const container = objectsById.get(containerId);
		if (container) containers.set(containerId, container);
	}
	const isInside = (object: ObjectRow, container: ObjectRow) =>
		object.id !== container.id &&
		object.x >= container.x &&
		object.y >= container.y &&
		object.x + object.width <= container.x + container.width &&
		object.y + object.height <= container.y + container.height;
	return applyNodeChanges(changes, current).map((node) => {
		const object = objectsById.get(node.id);
		const geometryContainerId = object
			? [...containers.entries()].find(([, container]) =>
					isInside(object, container),
				)?.[0]
			: undefined;
		const delta =
			deltas.get(node.id) ??
			deltas.get(groupAncestorId(node.id) ?? "") ??
			(geometryContainerId ? deltas.get(geometryContainerId) : undefined);
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
