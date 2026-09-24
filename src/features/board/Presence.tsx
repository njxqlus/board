import { useReactFlow, useViewport } from "@xyflow/react";
import { useEffect, useRef } from "react";
import type { Cursor } from "./types";
export function CursorReporter({
	socketRef,
}: {
	socketRef: { current: WebSocket | undefined };
}) {
	const { screenToFlowPosition } = useReactFlow();
	const lastSent = useRef(0);
	useEffect(() => {
		const onPointerMove = (event: PointerEvent) => {
			if (
				socketRef.current?.readyState !== WebSocket.OPEN ||
				Date.now() - lastSent.current < 50
			)
				return;
			lastSent.current = Date.now();
			socketRef.current.send(
				JSON.stringify({
					type: "presence.cursor",
					position: screenToFlowPosition({
						x: event.clientX,
						y: event.clientY,
					}),
				}),
			);
		};
		window.addEventListener("pointermove", onPointerMove);
		return () => window.removeEventListener("pointermove", onPointerMove);
	}, [screenToFlowPosition, socketRef]);
	return null;
}
export function RemoteCursors({
	cursors,
}: {
	cursors: Record<string, Cursor>;
}) {
	const { flowToScreenPosition } = useReactFlow();
	useViewport();
	return (
		<div className="pointer-events-none fixed inset-0 z-20 overflow-hidden">
			{Object.entries(cursors).map(([id, cursor]) => {
				const position = flowToScreenPosition(cursor.position);
				return (
					<div
						key={id}
						className="absolute rounded bg-primary px-1.5 py-0.5 text-xs text-primary-foreground shadow"
						style={{ left: position.x + 8, top: position.y + 8 }}
					>
						{cursor.email}
					</div>
				);
			})}
		</div>
	);
}
