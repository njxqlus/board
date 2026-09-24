import { useReactFlow, useViewport } from "@xyflow/react";
import { Info } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { Button } from "@/components/ui/button";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import type { Cursor } from "./types";

const cursorColors = [
	"#e11d48",
	"#ea580c",
	"#ca8a04",
	"#16a34a",
	"#0891b2",
	"#2563eb",
	"#7c3aed",
	"#c026d3",
] as const;

export function cursorColor(userId: string) {
	let hash = 0;
	for (let index = 0; index < userId.length; index++)
		hash = (hash * 31 + userId.charCodeAt(index)) | 0;
	return cursorColors[Math.abs(hash) % cursorColors.length] ?? cursorColors[0];
}
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
						className="board-remote-cursor absolute"
						style={{
							left: position.x,
							top: position.y,
							color: cursorColor(id),
						}}
					>
						<svg viewBox="0 0 24 32" aria-hidden="true">
							<path
								d="M3 2.5 20 18l-8.3 1.4L9 28.5z"
								fill="currentColor"
								stroke="white"
								strokeWidth="2.4"
								strokeLinejoin="round"
							/>
						</svg>
					</div>
				);
			})}
		</div>
	);
}

export function CursorLegend({
	cursors,
	currentUser,
}: {
	cursors: Record<string, Cursor>;
	currentUser: { id: string; email: string };
}) {
	const people = useMemo(
		() => [
			{ id: currentUser.id, email: `${currentUser.email} (you)` },
			...Object.entries(cursors).map(([id, cursor]) => ({
				id,
				email: cursor.email,
			})),
		],
		[cursors, currentUser],
	);
	return (
		<Popover>
			<PopoverTrigger asChild>
				<Button
					type="button"
					size="icon"
					variant="ghost"
					aria-label="Show collaborator cursor colors"
				>
					<Info aria-hidden="true" />
				</Button>
			</PopoverTrigger>
			<PopoverContent side="bottom" align="end" className="w-64 p-3">
				<p className="mb-2 text-sm font-medium">Cursor colors</p>
				<ul className="flex flex-col gap-2">
					{people.map((person) => (
						<li key={person.id} className="flex items-center gap-2 text-sm">
							<span
								className="board-cursor-color"
								style={{ backgroundColor: cursorColor(person.id) }}
								aria-hidden="true"
							/>
							<span className="truncate">{person.email}</span>
						</li>
					))}
				</ul>
			</PopoverContent>
		</Popover>
	);
}
