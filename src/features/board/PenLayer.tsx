import { useRef, useState } from "react";

type Point = { x: number; y: number };
export function PenLayer({
	toWorld,
	save,
}: {
	toWorld: (point: Point) => Point;
	save: (stroke: {
		x: number;
		y: number;
		width: number;
		height: number;
		data: { points: Point[]; color: string; width: number };
	}) => void;
}) {
	const points = useRef<Point[]>([]);
	const [preview, setPreview] = useState<Point[]>([]);
	return (
		<svg
			className="board-pen-layer"
			aria-label="Draw on board"
			onPointerDown={(event) => {
				if (event.button !== 0) return;
				event.currentTarget.setPointerCapture(event.pointerId);
				points.current = [{ x: event.clientX, y: event.clientY }];
				setPreview(points.current);
			}}
			onPointerMove={(event) => {
				if (
					!event.currentTarget.hasPointerCapture(event.pointerId) ||
					points.current.length >= 10000
				)
					return;
				points.current = [
					...points.current,
					{ x: event.clientX, y: event.clientY },
				];
				setPreview(points.current);
			}}
			onPointerCancel={() => {
				points.current = [];
				setPreview([]);
			}}
			onPointerUp={(event) => {
				if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
				event.currentTarget.releasePointerCapture(event.pointerId);
				const world = points.current.map(toWorld);
				points.current = [];
				setPreview([]);
				if (world.length < 2) return;
				const x = Math.min(...world.map((point) => point.x)),
					y = Math.min(...world.map((point) => point.y));
				save({
					x,
					y,
					width: Math.max(2, ...world.map((point) => point.x - x)),
					height: Math.max(2, ...world.map((point) => point.y - y)),
					data: {
						points: world.map((point) => ({ x: point.x - x, y: point.y - y })),
						color: "#64748b",
						width: 3,
					},
				});
			}}
		>
			<polyline
				points={preview.map((point) => `${point.x},${point.y}`).join(" ")}
				fill="none"
				stroke="#64748b"
				strokeWidth="3"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}
