import { Panel, useReactFlow, useViewport } from "@xyflow/react";
import {
	AlignHorizontalDistributeCenter,
	AlignHorizontalJustifyStart,
	AlignVerticalDistributeCenter,
	AlignVerticalJustifyStart,
	ArrowLeft,
	ArrowUpRight,
	BringToFront,
	ChevronLeft,
	ChevronRight,
	Circle,
	Copy,
	CopyPlus,
	Diamond,
	Frame,
	Grid2X2,
	Group,
	Hand,
	ImagePlus,
	type LucideIcon,
	Map as MapIcon,
	MessageCircle,
	MousePointer2,
	PanelTop,
	Pencil,
	RectangleHorizontal,
	Redo2,
	Replace,
	Scan,
	SendToBack,
	Settings,
	Square,
	StickyNote,
	Table2,
	Trash2,
	Triangle,
	TvMinimal,
	Type,
	Undo2,
	Ungroup,
	ZoomIn,
	ZoomOut,
} from "lucide-react";
import {
	type ComponentProps,
	type ReactNode,
	useEffect,
	useState,
} from "react";
import { Button } from "@/components/ui/button";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import type { ObjectRow } from "./types";

export type CanvasTool = "select" | "hand" | "connect" | "pen" | "comment";
export function CanvasControls() {
	const { zoomIn, zoomOut, fitView } = useReactFlow();
	const { zoom } = useViewport();
	return (
		<Panel
			position="bottom-right"
			className="board-canvas-controls"
			aria-label="Canvas navigation"
		>
			<ToolButton
				icon={ZoomOut}
				label="Zoom out"
				onClick={() => void zoomOut()}
			/>
			<output className="text-xs tabular-nums" aria-label="Zoom level">
				{Math.round(zoom * 100)}%
			</output>
			<ToolButton icon={ZoomIn} label="Zoom in" onClick={() => void zoomIn()} />
			<ToolButton
				icon={Scan}
				label="Fit all objects in view"
				onClick={() => void fitView({ padding: 0.2, duration: 200 })}
			/>
		</Panel>
	);
}
export function ToolButton({
	icon: Icon,
	label,
	active,
	disabled,
	disabledReason,
	onClick,
	...props
}: Omit<ComponentProps<typeof Button>, "children"> & {
	icon: LucideIcon;
	label: string;
	active?: boolean;
	disabledReason?: string;
}) {
	const description =
		disabled && disabledReason ? `${label} — ${disabledReason}` : label;
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Button
					type="button"
					size="icon"
					variant={active ? "secondary" : "ghost"}
					title={description}
					aria-label={label}
					aria-pressed={active}
					aria-disabled={disabled || undefined}
					onClick={(event) => {
						if (disabled) {
							event.preventDefault();
							return;
						}
						onClick?.(event);
					}}
					{...props}
				>
					<Icon data-icon="inline-start" aria-hidden="true" />
					<span className="board-tool-label">{label}</span>
				</Button>
			</TooltipTrigger>
			<TooltipContent side="bottom" sideOffset={6}>
				{description}
			</TooltipContent>
		</Tooltip>
	);
}

export function BoardHeader({
	title,
	status,
	back,
	settings,
	undo,
	redo,
	canUndo,
	canRedo,
	cursorLegend,
}: {
	title: string;
	status: string;
	back: () => void;
	settings: () => void;
	undo: () => void;
	redo: () => void;
	canUndo: boolean;
	canRedo: boolean;
	cursorLegend: ReactNode;
}) {
	return (
		<header className="board-header">
			<ToolButton icon={ArrowLeft} label="Back to boards" onClick={back} />
			<strong className="min-w-0 flex-1 truncate">
				{title || "Untitled board"}
			</strong>
			<span role="status" className="text-xs text-muted-foreground">
				{status}
			</span>
			<ToolButton
				icon={Undo2}
				label="Undo (Cmd/Ctrl+Z)"
				onClick={undo}
				disabled={!canUndo}
				disabledReason="No movement to undo"
			/>
			<ToolButton
				icon={Redo2}
				label="Redo (Cmd/Ctrl+Shift+Z)"
				onClick={redo}
				disabled={!canRedo}
				disabledReason="No movement to redo"
			/>
			<ToolButton icon={Settings} label="Settings" onClick={settings} />
			{cursorLegend}
		</header>
	);
}

export function CreationTools({
	tool,
	setTool,
	add,
	shape,
	youtube,
	upload,
	snap,
	setSnap,
	minimap,
	setMinimap,
	disabled,
}: {
	tool: CanvasTool;
	setTool: (tool: CanvasTool) => void;
	add: (kind: string) => void;
	shape: (shape: string) => void;
	youtube: () => void;
	upload: () => void;
	snap: boolean;
	setSnap: (value: boolean) => void;
	minimap: boolean;
	setMinimap: (value: boolean) => void;
	disabled: boolean;
}) {
	const [expanded, setExpanded] = useState(false);
	const [shapesOpen, setShapesOpen] = useState(false);
	const [narrow, setNarrow] = useState(
		() => window.matchMedia("(max-width: 640px)").matches,
	);
	useEffect(() => {
		const media = window.matchMedia("(max-width: 640px)");
		const update = () => setNarrow(media.matches);
		media.addEventListener("change", update);
		return () => media.removeEventListener("change", update);
	}, []);
	return (
		<aside
			className="board-creation-tools"
			data-expanded={expanded}
			aria-label="Creation tools"
		>
			<ToolButton
				icon={expanded ? ChevronLeft : ChevronRight}
				label={expanded ? "Hide tool labels" : "Show tool labels"}
				aria-expanded={expanded}
				onClick={() => setExpanded(!expanded)}
			/>
			<ToolButton
				icon={MousePointer2}
				label="Select"
				active={tool === "select"}
				onClick={() => setTool("select")}
			/>
			<ToolButton
				icon={Hand}
				label="Hand (Space + drag)"
				active={tool === "hand"}
				onClick={() => setTool("hand")}
			/>
			<ToolButton
				icon={ArrowUpRight}
				label="Connector"
				active={tool === "connect"}
				disabled={disabled}
				onClick={() => setTool("connect")}
			/>
			<ToolButton
				icon={MessageCircle}
				label="Comment"
				active={tool === "comment"}
				disabled={disabled}
				onClick={() => setTool("comment")}
			/>
			<Popover open={shapesOpen} onOpenChange={setShapesOpen}>
				<PopoverTrigger asChild>
					<Button
						variant="ghost"
						size="icon"
						title="Shapes"
						aria-label="Shapes"
					>
						<Square data-icon="inline-start" aria-hidden="true" />
						<span className="board-tool-label">Shapes</span>
					</Button>
				</PopoverTrigger>
				<PopoverContent
					side={narrow ? "bottom" : "right"}
					align="start"
					collisionPadding={12}
					sideOffset={12}
					className="board-shape-options"
					aria-label="Choose a shape"
				>
					<p className="col-span-2 text-sm font-medium">Shapes</p>
					{[
						{ name: "rectangle", icon: RectangleHorizontal },
						{ name: "rounded", icon: PanelTop },
						{ name: "square", icon: Square },
						{ name: "ellipse", icon: Circle },
						{ name: "circle", icon: Circle },
						{ name: "triangle", icon: Triangle },
						{ name: "diamond", icon: Diamond },
					].map(({ name, icon: Icon }) => (
						<Button
							key={name}
							variant="ghost"
							aria-label={`Add ${name}`}
							title={`Add ${name}`}
							disabled={disabled}
							onClick={() => {
								shape(name);
								setShapesOpen(false);
							}}
						>
							<Icon data-icon="inline-start" aria-hidden="true" />
							{name.charAt(0).toUpperCase() + name.slice(1)}
						</Button>
					))}
				</PopoverContent>
			</Popover>
			<ToolButton
				icon={StickyNote}
				label="Sticky note"
				disabled={disabled}
				onClick={() => add("sticky")}
			/>
			<ToolButton
				icon={PanelTop}
				label="Card"
				disabled={disabled}
				onClick={() => add("card")}
			/>
			<ToolButton
				icon={Type}
				label="Text"
				disabled={disabled}
				onClick={() => add("text")}
			/>
			<ToolButton
				icon={Table2}
				label="Table"
				disabled={disabled}
				onClick={() => add("table")}
			/>
			<ToolButton
				icon={Frame}
				label="Frame"
				disabled={disabled}
				onClick={() => add("frame")}
			/>
			<ToolButton
				icon={Pencil}
				label="Pen"
				disabled={disabled}
				active={tool === "pen"}
				onClick={() => setTool("pen")}
			/>
			<ToolButton
				icon={ImagePlus}
				label="Upload media"
				disabled={disabled}
				onClick={upload}
			/>
			<ToolButton
				icon={TvMinimal}
				label="YouTube"
				disabled={disabled}
				onClick={youtube}
			/>
			<ToolButton
				icon={Grid2X2}
				label="Snap to grid"
				active={snap}
				onClick={() => setSnap(!snap)}
			/>
			<ToolButton
				icon={MapIcon}
				label="Toggle minimap"
				active={minimap}
				onClick={() => setMinimap(!minimap)}
			/>
		</aside>
	);
}

export function SelectionTools({
	selected,
	style,
	copy,
	duplicate,
	group,
	ungroup,
	stack,
	align,
	distribute,
	remove,
	edit,
	replace,
}: {
	selected: ObjectRow[];
	style: (patch: Record<string, unknown>) => void;
	copy: () => void;
	duplicate: () => void;
	group: () => void;
	ungroup: () => void;
	stack: (direction: -1 | 1) => void;
	align: (axis: "x" | "y", mode: "start") => void;
	distribute: (axis: "x" | "y") => void;
	remove: () => void;
	edit: () => void;
	replace: () => void;
}) {
	if (!selected.length) return null;
	const current = (selected[0]?.data.style ?? {}) as Record<string, unknown>;
	return (
		<section
			className="board-selection-tools"
			aria-label="Selected object tools"
		>
			<ToolButton
				icon={Pencil}
				label="Edit object"
				onClick={edit}
				disabled={selected.length !== 1}
				disabledReason="Select one object"
			/>
			<ToolButton icon={Copy} label="Copy (Cmd/Ctrl+C)" onClick={copy} />
			<ToolButton
				icon={CopyPlus}
				label="Duplicate (Cmd/Ctrl+D)"
				onClick={duplicate}
			/>
			<ToolButton
				icon={Group}
				label="Group selection"
				onClick={group}
				disabled={selected.length < 2}
				disabledReason="Select at least two objects"
			/>
			<ToolButton
				icon={Ungroup}
				label="Ungroup"
				onClick={ungroup}
				disabled={!selected.some((object) => object.kind === "group")}
				disabledReason="Select a group"
			/>
			<ToolButton
				icon={BringToFront}
				label="Bring forward"
				onClick={() => stack(1)}
			/>
			<ToolButton
				icon={SendToBack}
				label="Send backward"
				onClick={() => stack(-1)}
			/>
			<ToolButton
				icon={AlignHorizontalJustifyStart}
				label="Align left"
				onClick={() => align("x", "start")}
				disabled={selected.length < 2}
				disabledReason="Select at least two objects"
			/>
			<ToolButton
				icon={AlignVerticalJustifyStart}
				label="Align top"
				onClick={() => align("y", "start")}
				disabled={selected.length < 2}
				disabledReason="Select at least two objects"
			/>
			<ToolButton
				icon={AlignHorizontalDistributeCenter}
				label="Distribute horizontally"
				onClick={() => distribute("x")}
				disabled={selected.length < 3}
				disabledReason="Select at least three objects"
			/>
			<ToolButton
				icon={AlignVerticalDistributeCenter}
				label="Distribute vertically"
				onClick={() => distribute("y")}
				disabled={selected.length < 3}
				disabledReason="Select at least three objects"
			/>
			<label title="Fill color" className="board-color-input">
				<span>Fill</span>
				<input
					aria-label="Object fill"
					type="color"
					value={String(current.fill ?? "#ffffff")}
					onChange={(event) => style({ fill: event.currentTarget.value })}
				/>
			</label>
			<label title="Line color" className="board-color-input">
				<span>Line</span>
				<input
					aria-label="Object stroke"
					type="color"
					value={String(current.stroke ?? "#94a3b8")}
					onChange={(event) => style({ stroke: event.currentTarget.value })}
				/>
			</label>
			<label
				className="flex items-center gap-2 text-xs"
				title="Line width in board pixels"
			>
				Width
				<select
					aria-label="Line width"
					value={Number(
						current.strokeWidth ??
							(selected[0]?.kind === "freehand"
								? (selected[0]?.data.width ?? 3)
								: 1.5),
					)}
					onChange={(event) =>
						style({ strokeWidth: Number(event.currentTarget.value) })
					}
					className="h-8 rounded-md border bg-background px-2"
				>
					{[1, 1.5, 2, 3, 4, 6, 8, 12].map((width) => (
						<option key={width} value={width}>
							{width} px
						</option>
					))}
				</select>
			</label>
			<label className="flex items-center gap-2 text-xs">
				Opacity
				<input
					key={`${selected.map((object) => object.id).join(":")}:${current.opacity}`}
					aria-label="Object opacity"
					type="range"
					min="0"
					max="1"
					step="0.1"
					defaultValue={Number(current.opacity ?? 1)}
					onPointerUp={(event) =>
						style({ opacity: Number(event.currentTarget.value) })
					}
					onKeyUp={(event) => {
						if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
							style({ opacity: Number(event.currentTarget.value) });
					}}
				/>
			</label>
			{selected.some((object) =>
				["image", "video", "audio"].includes(object.kind),
			) ? (
				<ToolButton icon={Replace} label="Replace media" onClick={replace} />
			) : null}
			<ToolButton icon={Trash2} label="Delete selection" onClick={remove} />
		</section>
	);
}
