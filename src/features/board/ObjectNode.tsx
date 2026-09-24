import {
	Handle,
	type Node,
	type NodeProps,
	NodeResizer,
	type NodeTypes,
	Position,
	useUpdateNodeInternals,
} from "@xyflow/react";
import { Play } from "lucide-react";
import {
	type CSSProperties,
	createContext,
	memo,
	useCallback,
	useContext,
	useEffect,
	useRef,
	useState,
} from "react";
import { cn } from "@/lib/utils";
import { RichTextView } from "./RichTextView";

type Resize = { x: number; y: number; width: number; height: number };
export const ObjectActions = createContext<{
	resize: (id: string, geometry: Resize) => void;
	readonly: boolean;
}>({ resize: () => {}, readonly: false });
export const ports = [
	{ id: "top", position: Position.Top, x: 0.5, y: 0 },
	{ id: "right", position: Position.Right, x: 1, y: 0.5 },
	{ id: "bottom", position: Position.Bottom, x: 0.5, y: 1 },
	{ id: "left", position: Position.Left, x: 0, y: 0.5 },
] as const;
export function portAnchor(id?: string | null) {
	const port = ports.find((port) => port.id === id) ?? ports[1];
	return { x: port.x, y: port.y };
}
export function anchorPort(anchor: { x: number; y: number }) {
	return (
		ports.find((port) => port.x === anchor.x && port.y === anchor.y)?.id ??
		`anchor:${anchor.x}:${anchor.y}`
	);
}

function Youtube({ videoId, title }: { videoId: string; title: string }) {
	const [active, setActive] = useState(false);
	return active ? (
		<iframe
			className="nodrag nopan nowheel size-full"
			src={`https://www.youtube-nocookie.com/embed/${videoId}`}
			title={title}
			allow="encrypted-media; picture-in-picture"
			allowFullScreen
		/>
	) : (
		<button
			type="button"
			className="nodrag board-youtube-preview"
			onClick={() => setActive(true)}
			aria-label={`Play ${title}`}
		>
			<Play />
			<span>{title}</span>
			<small>Click to activate player</small>
		</button>
	);
}

const ObjectNode = memo(function ObjectNode({
	id,
	data,
	selected,
	width = 180,
	height = 100,
}: NodeProps<Node>) {
	const actions = useContext(ObjectActions);
	const resizeAction = useRef(actions.resize);
	resizeAction.current = actions.resize;
	const finishResize = useCallback(
		(_: unknown, geometry: Resize) => {
			const { x, y, width, height } = geometry;
			resizeAction.current(id, { x, y, width, height });
		},
		[id],
	);
	const updateInternals = useUpdateNodeInternals();
	const anchors = (data.anchors ?? []) as { x: number; y: number }[];
	const anchorKey = anchors.map(anchorPort).join("|");
	useEffect(() => {
		updateInternals(id);
	}, [id, anchorKey, updateInternals]);
	const value = data.data as Record<string, unknown>;
	const style = (value.style ?? {}) as Record<string, unknown>;
	const kind = String(data.kind);
	const shape = String(value.shape ?? "rectangle");
	const src = typeof data.mediaUrl === "string" ? data.mediaUrl : undefined;
	const fill =
		typeof style.fill === "string"
			? style.fill
			: kind === "sticky"
				? "#fff1a8"
				: "#ffffff";
	const stroke = typeof style.stroke === "string" ? style.stroke : "#94a3b8";
	const strokeWidth =
		typeof style.strokeWidth === "number" ? style.strokeWidth : 1.5;
	const visual: CSSProperties = {
		color: typeof style.textColor === "string" ? style.textColor : "#1e293b",
		opacity: typeof style.opacity === "number" ? style.opacity : 1,
	};
	const points = Array.isArray(value.points)
		? (value.points as { x: number; y: number }[])
		: [];
	const maxX = Math.max(1, ...points.map((point) => point.x));
	const maxY = Math.max(1, ...points.map((point) => point.y));
	return (
		<div
			className={cn("board-object", `board-object-${kind}`, {
				"board-object-container": kind === "frame" || kind === "group",
			})}
			data-kind={kind}
		>
			<NodeResizer
				isVisible={selected && !actions.readonly}
				minWidth={40}
				minHeight={24}
				keepAspectRatio={
					kind === "image" || shape === "circle" || shape === "square"
				}
				onResizeEnd={finishResize}
			/>
			<div className="board-object-visual" style={visual}>
				{kind === "shape" ? (
					<>
						<svg
							className="board-shape"
							width="100%"
							height="100%"
							viewBox={`0 0 ${width} ${height}`}
							preserveAspectRatio="none"
							aria-hidden="true"
						>
							{shape === "triangle" || shape === "diamond" ? (
								<polygon
									points={
										shape === "triangle"
											? `${width / 2},2 ${width - 2},${height - 2} 2,${height - 2}`
											: `${width / 2},2 ${width - 2},${height / 2} ${width / 2},${height - 2} 2,${height / 2}`
									}
									fill={fill}
									stroke={stroke}
									strokeWidth={strokeWidth}
								/>
							) : shape === "circle" || shape === "ellipse" ? (
								<ellipse
									cx={width / 2}
									cy={height / 2}
									rx={Math.max(1, width / 2 - 2)}
									ry={Math.max(1, height / 2 - 2)}
									fill={fill}
									stroke={stroke}
									strokeWidth={strokeWidth}
								/>
							) : (
								<rect
									x="2"
									y="2"
									width={Math.max(1, width - 4)}
									height={Math.max(1, height - 4)}
									rx={shape === "rounded" ? 16 : 0}
									fill={fill}
									stroke={stroke}
									strokeWidth={strokeWidth}
								/>
							)}
						</svg>
						<div className="board-shape-label">{String(value.label ?? "")}</div>
					</>
				) : null}
				{kind === "sticky" ? (
					<div className="board-sticky" style={{ background: fill }}>
						{String(value.label ?? "")}
					</div>
				) : null}
				{kind === "card" ? (
					<div
						className="board-card"
						style={{
							background: fill,
							borderColor: stroke,
							borderWidth: strokeWidth,
						}}
					>
						<strong>{String(value.title ?? value.label ?? "Card")}</strong>
						<p>{String(value.body ?? "")}</p>
					</div>
				) : null}
				{kind === "text" || kind === "table" ? (
					<RichTextView content={value.content} />
				) : null}
				{kind === "frame" ? (
					<div
						className="board-frame"
						style={{ borderColor: stroke, borderWidth: strokeWidth }}
					>
						<span className="board-container-drag-handle">
							{String(value.label ?? "Frame")}
						</span>
					</div>
				) : null}
				{kind === "group" ? (
					<div className="board-object-group">
						<span className="board-container-drag-handle">Group</span>
					</div>
				) : null}
				{kind === "freehand" ? (
					<svg
						className="size-full overflow-visible"
						viewBox={`0 0 ${maxX} ${maxY}`}
						preserveAspectRatio="none"
						aria-label="Freehand stroke"
					>
						<polyline
							points={points.map((point) => `${point.x},${point.y}`).join(" ")}
							fill="none"
							stroke={
								typeof style.stroke === "string"
									? style.stroke
									: String(value.color ?? "#64748b")
							}
							strokeWidth={Number(style.strokeWidth ?? value.width ?? 3)}
							strokeLinecap="round"
							strokeLinejoin="round"
							vectorEffect="non-scaling-stroke"
						/>
					</svg>
				) : null}
				{kind === "image" && src ? (
					<img
						className="size-full object-contain"
						draggable={false}
						src={src}
						alt={String(value.alt ?? value.caption ?? "Board image")}
					/>
				) : null}
				{kind === "video" && src ? (
					<video className="nodrag nopan nowheel size-full" controls src={src}>
						<track kind="captions" label="Captions unavailable" srcLang="en" />
					</video>
				) : null}
				{kind === "audio" && src ? (
					<div className="board-audio">
						<span>{String(value.caption ?? "Audio")}</span>
						<audio className="nodrag nopan nowheel w-full" controls src={src}>
							<track
								kind="captions"
								label="Captions unavailable"
								srcLang="en"
							/>
						</audio>
					</div>
				) : null}
				{kind === "youtube" ? (
					<Youtube
						videoId={String(value.videoId)}
						title={String(value.title ?? "YouTube video")}
					/>
				) : null}
			</div>
			{ports.map((port) => (
				<Handle
					key={port.id}
					id={port.id}
					type="source"
					position={port.position}
					aria-label={`Connect ${port.id}`}
					isConnectable={!actions.readonly}
				/>
			))}
			{anchors
				.filter((anchor) => anchorPort(anchor).startsWith("anchor:"))
				.map((anchor) => (
					<Handle
						key={anchorPort(anchor)}
						id={anchorPort(anchor)}
						type="source"
						position={
							anchor.y === 0
								? Position.Top
								: anchor.y === 1
									? Position.Bottom
									: anchor.x === 0
										? Position.Left
										: Position.Right
						}
						isConnectable={false}
						style={{
							left: `${anchor.x * 100}%`,
							top: `${anchor.y * 100}%`,
							opacity: 0,
							pointerEvents: "none",
						}}
					/>
				))}
		</div>
	);
});
export const nodeTypes: NodeTypes = { boardObject: ObjectNode };
