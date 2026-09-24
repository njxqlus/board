import { type Edge, MarkerType, type Node } from "@xyflow/react";
import { anchorPort } from "./ObjectNode";
import type { ConnectorRow, ObjectRow } from "./types";
export function projectNodes(
	objects: ObjectRow[],
	connectors: ConnectorRow[],
	id: string,
): Node[] {
	const attached = new Map<string, Map<string, { x: number; y: number }>>();
	for (const connector of connectors)
		for (const endpoint of [connector.data.source, connector.data.target]) {
			if (endpoint?.kind !== "attached") continue;
			const points = attached.get(endpoint.objectId) ?? new Map();
			points.set(anchorPort(endpoint.anchor), endpoint.anchor);
			attached.set(endpoint.objectId, points);
		}
	const objectNodes = objects.map((o) => ({
		id: o.id,
		type: "boardObject",
		position: { x: o.x, y: o.y },
		data: {
			anchors: [...(attached.get(o.id)?.values() ?? [])],
			kind: o.kind,
			data: o.data,
			mediaUrl:
				typeof o.data.assetId === "string"
					? `/api/boards/${id}/media/${o.data.assetId}`
					: undefined,
		},
		width: o.width,
		height: o.height,
		zIndex: o.zIndex,
	}));
	const anchors = connectors.flatMap((connector) =>
		(["source", "target"] as const).flatMap((role) => {
			const endpoint = connector.data[role];
			return endpoint?.kind === "free"
				? [
						{
							id: `anchor:${connector.id}:${role}`,
							position: endpoint.point,
							data: {},
							selectable: false,
							draggable: false,
							connectable: false,
							focusable: false,
							style: { width: 1, height: 1, opacity: 0 },
						},
					]
				: [];
		}),
	);
	return [...objectNodes, ...anchors];
}
export function projectEdges(connectors: ConnectorRow[]): Edge[] {
	return connectors.flatMap((connector) => {
		const source = connector.data.source;
		const target = connector.data.target;
		const sourceId =
			source?.kind === "attached"
				? source.objectId
				: source?.kind === "free"
					? `anchor:${connector.id}:source`
					: undefined;
		const targetId =
			target?.kind === "attached"
				? target.objectId
				: target?.kind === "free"
					? `anchor:${connector.id}:target`
					: undefined;
		const connectorStyle = connector.data.style;
		const marker = (value: "none" | "arrow" | "closed-arrow" | undefined) =>
			value === "arrow"
				? { type: MarkerType.Arrow }
				: value === "closed-arrow"
					? { type: MarkerType.ArrowClosed }
					: undefined;
		return sourceId && targetId
			? [
					{
						id: connector.id,
						source: sourceId,
						sourceHandle:
							source?.kind === "attached"
								? anchorPort(source.anchor)
								: undefined,
						targetHandle:
							target?.kind === "attached"
								? anchorPort(target.anchor)
								: undefined,
						target: targetId,
						label: connector.data.label,
						type:
							connectorStyle?.path === "straight"
								? "straight"
								: connectorStyle?.path === "bezier"
									? "default"
									: "smoothstep",
						style: {
							stroke: connectorStyle?.stroke ?? "#64748b",
							strokeWidth: connectorStyle?.strokeWidth ?? 2,
							strokeDasharray:
								connectorStyle?.strokeDasharray === "dashed"
									? "6 4"
									: connectorStyle?.strokeDasharray === "dotted"
										? "2 4"
										: undefined,
							opacity: connectorStyle?.opacity ?? 1,
						},
						markerStart: marker(connectorStyle?.markerStart),
						markerEnd: marker(connectorStyle?.markerEnd ?? "closed-arrow"),
					},
				]
			: [];
	});
}
