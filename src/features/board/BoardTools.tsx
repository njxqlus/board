import {
	NodeToolbar,
	Panel,
	Position,
	useReactFlow,
	useViewport,
} from "@xyflow/react";
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
	Ellipsis,
	Frame,
	GitBranch,
	Grid2X2,
	Group,
	Hand,
	Heading1,
	ImagePlus,
	type LucideIcon,
	Map as MapIcon,
	MessageCircle,
	MousePointer2,
	Palette,
	PanelTop,
	Pencil,
	RectangleHorizontal,
	Redo2,
	Replace,
	Scan,
	SendToBack,
	Settings,
	SlidersHorizontal,
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
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuShortcut,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
	Popover,
	PopoverContent,
	PopoverHeader,
	PopoverTitle,
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
				icon={Heading1}
				label="Header"
				disabled={disabled}
				onClick={() => add("header")}
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
	canGroup,
	ungroup,
	canUngroup,
	stack,
	align,
	distribute,
	remove,
	edit,
	replace,
	highlight,
	highlighted,
}: {
	selected: ObjectRow[];
	style: (patch: Record<string, unknown>) => void;
	copy: () => void;
	duplicate: () => void;
	group: () => void;
	canGroup: boolean;
	ungroup: () => void;
	canUngroup: boolean;
	stack: (direction: -1 | 1) => void;
	align: (axis: "x" | "y", mode: "start") => void;
	distribute: (axis: "x" | "y") => void;
	remove: () => void;
	edit: () => void;
	replace: () => void;
	highlight: () => void;
	highlighted: boolean;
}) {
	const { y: viewportY, zoom } = useViewport();
	if (!selected.length) return null;
	const current = (selected[0]?.data.style ?? {}) as Record<string, unknown>;
	const selectionTop = Math.min(...selected.map((object) => object.y));
	return (
		<NodeToolbar
			nodeId={selected.map((object) => object.id)}
			isVisible
			position={
				selectionTop * zoom + viewportY < 64 ? Position.Bottom : Position.Top
			}
			offset={12}
			className="board-selection-tools nodrag nopan"
			aria-label="Selected object tools"
		>
			{selected.length === 1 ? (
				<ToolButton icon={Pencil} label="Edit object" onClick={edit} />
			) : null}
			<ToolButton
				icon={CopyPlus}
				label="Duplicate (Cmd/Ctrl+D)"
				onClick={duplicate}
			/>
			{selected.length === 1 ? (
				<ToolButton
					icon={GitBranch}
					label={
						highlighted ? "Clear connection highlight" : "Highlight connections"
					}
					active={highlighted}
					onClick={highlight}
				/>
			) : null}
			<Popover>
				<Tooltip>
					<TooltipTrigger asChild>
						<PopoverTrigger asChild>
							<Button
								type="button"
								size="icon"
								variant="ghost"
								aria-label="Style"
							>
								<Palette data-icon="inline-start" aria-hidden="true" />
							</Button>
						</PopoverTrigger>
					</TooltipTrigger>
					<TooltipContent side="bottom" sideOffset={6}>
						Style
					</TooltipContent>
				</Tooltip>
				<PopoverContent side="top" className="w-64" collisionPadding={12}>
					<PopoverHeader>
						<PopoverTitle>Style</PopoverTitle>
					</PopoverHeader>
					<div className="mt-3 flex flex-col gap-3">
						<div className="flex gap-4">
							<label title="Fill color" className="board-color-input">
								<span>Fill</span>
								<input
									aria-label="Object fill"
									type="color"
									value={String(current.fill ?? "#ffffff")}
									onChange={(event) =>
										style({ fill: event.currentTarget.value })
									}
								/>
							</label>
							<label title="Line color" className="board-color-input">
								<span>Line</span>
								<input
									aria-label="Object stroke"
									type="color"
									value={String(current.stroke ?? "#94a3b8")}
									onChange={(event) =>
										style({ stroke: event.currentTarget.value })
									}
								/>
							</label>
						</div>
						<label
							className="flex items-center justify-between gap-2 text-xs"
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
						<label className="flex items-center justify-between gap-2 text-xs">
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
									if (
										["ArrowLeft", "ArrowRight", "Home", "End"].includes(
											event.key,
										)
									)
										style({ opacity: Number(event.currentTarget.value) });
								}}
							/>
						</label>
					</div>
				</PopoverContent>
			</Popover>
			<DropdownMenu>
				<Tooltip>
					<TooltipTrigger asChild>
						<DropdownMenuTrigger asChild>
							<Button
								type="button"
								size="icon"
								variant="ghost"
								aria-label="Arrange"
							>
								<SlidersHorizontal
									data-icon="inline-start"
									aria-hidden="true"
								/>
							</Button>
						</DropdownMenuTrigger>
					</TooltipTrigger>
					<TooltipContent side="bottom" sideOffset={6}>
						Arrange
					</TooltipContent>
				</Tooltip>
				<DropdownMenuContent align="center">
					<DropdownMenuGroup>
						<DropdownMenuItem disabled={!canGroup} onSelect={group}>
							<Group aria-hidden="true" />
							Group
						</DropdownMenuItem>
						<DropdownMenuItem disabled={!canUngroup} onSelect={ungroup}>
							<Ungroup aria-hidden="true" />
							Ungroup
						</DropdownMenuItem>
					</DropdownMenuGroup>
					<DropdownMenuSeparator />
					<DropdownMenuGroup>
						<DropdownMenuItem onSelect={() => stack(1)}>
							<BringToFront aria-hidden="true" />
							Bring Forward
						</DropdownMenuItem>
						<DropdownMenuItem onSelect={() => stack(-1)}>
							<SendToBack aria-hidden="true" />
							Send Backward
						</DropdownMenuItem>
					</DropdownMenuGroup>
				</DropdownMenuContent>
			</DropdownMenu>
			<DropdownMenu>
				<Tooltip>
					<TooltipTrigger asChild>
						<DropdownMenuTrigger asChild>
							<Button
								type="button"
								size="icon"
								variant="ghost"
								aria-label="Align and distribute"
							>
								<AlignHorizontalJustifyStart
									data-icon="inline-start"
									aria-hidden="true"
								/>
							</Button>
						</DropdownMenuTrigger>
					</TooltipTrigger>
					<TooltipContent side="bottom" sideOffset={6}>
						Align &amp; Distribute
					</TooltipContent>
				</Tooltip>
				<DropdownMenuContent align="center">
					<DropdownMenuGroup>
						<DropdownMenuItem
							disabled={selected.length < 2}
							onSelect={() => align("x", "start")}
						>
							<AlignHorizontalJustifyStart aria-hidden="true" />
							Align Left
						</DropdownMenuItem>
						<DropdownMenuItem
							disabled={selected.length < 2}
							onSelect={() => align("y", "start")}
						>
							<AlignVerticalJustifyStart aria-hidden="true" />
							Align Top
						</DropdownMenuItem>
					</DropdownMenuGroup>
					<DropdownMenuSeparator />
					<DropdownMenuGroup>
						<DropdownMenuItem
							disabled={selected.length < 3}
							onSelect={() => distribute("x")}
						>
							<AlignHorizontalDistributeCenter aria-hidden="true" />
							Distribute Horizontally
						</DropdownMenuItem>
						<DropdownMenuItem
							disabled={selected.length < 3}
							onSelect={() => distribute("y")}
						>
							<AlignVerticalDistributeCenter aria-hidden="true" />
							Distribute Vertically
						</DropdownMenuItem>
					</DropdownMenuGroup>
				</DropdownMenuContent>
			</DropdownMenu>
			<DropdownMenu>
				<Tooltip>
					<TooltipTrigger asChild>
						<DropdownMenuTrigger asChild>
							<Button
								type="button"
								size="icon"
								variant="ghost"
								aria-label="More actions"
							>
								<Ellipsis data-icon="inline-start" aria-hidden="true" />
							</Button>
						</DropdownMenuTrigger>
					</TooltipTrigger>
					<TooltipContent side="bottom" sideOffset={6}>
						More
					</TooltipContent>
				</Tooltip>
				<DropdownMenuContent align="end">
					<DropdownMenuGroup>
						<DropdownMenuItem onSelect={copy}>
							<Copy aria-hidden="true" />
							Copy<DropdownMenuShortcut>⌘C</DropdownMenuShortcut>
						</DropdownMenuItem>
						{selected.some((object) =>
							["image", "video", "audio"].includes(object.kind),
						) ? (
							<DropdownMenuItem onSelect={replace}>
								<Replace aria-hidden="true" />
								Replace Media
							</DropdownMenuItem>
						) : null}
					</DropdownMenuGroup>
					<DropdownMenuSeparator />
					<DropdownMenuGroup>
						<DropdownMenuItem variant="destructive" onSelect={remove}>
							<Trash2 aria-hidden="true" />
							Delete
						</DropdownMenuItem>
					</DropdownMenuGroup>
				</DropdownMenuContent>
			</DropdownMenu>
		</NodeToolbar>
	);
}
