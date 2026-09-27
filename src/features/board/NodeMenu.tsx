import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type NodeMenuTarget = { id: string; x: number; y: number };

export function NodeMenu({
	target,
	close,
	readonly,
	grouped,
	highlighted,
	edit,
	duplicate,
	detach,
	remove,
	highlight,
}: {
	target: NodeMenuTarget;
	close: () => void;
	readonly: boolean;
	grouped: boolean;
	highlighted: boolean;
	edit: () => void;
	duplicate: () => void;
	detach: () => void;
	remove: () => void;
	highlight: () => void;
}) {
	return (
		<DropdownMenu
			open
			modal={false}
			onOpenChange={(open) => {
				if (!open) close();
			}}
		>
			<DropdownMenuTrigger asChild>
				<button
					type="button"
					tabIndex={-1}
					aria-label="Node actions"
					className="pointer-events-none fixed size-px opacity-0"
					style={{ left: target.x, top: target.y }}
				/>
			</DropdownMenuTrigger>
			<DropdownMenuContent
				align="start"
				collisionPadding={8}
				aria-label="Node actions"
				onCloseAutoFocus={(event) => event.preventDefault()}
			>
				<DropdownMenuGroup>
					<DropdownMenuItem disabled={readonly} onSelect={edit}>
						Edit
					</DropdownMenuItem>
					<DropdownMenuItem disabled={readonly} onSelect={duplicate}>
						Duplicate
					</DropdownMenuItem>
					<DropdownMenuItem onSelect={highlight}>
						{highlighted
							? "Clear connection highlight"
							: "Highlight connections"}
					</DropdownMenuItem>
					{grouped ? (
						<DropdownMenuItem disabled={readonly} onSelect={detach}>
							Remove from group
						</DropdownMenuItem>
					) : null}
				</DropdownMenuGroup>
				<DropdownMenuSeparator />
				<DropdownMenuGroup>
					<DropdownMenuItem
						disabled={readonly}
						variant="destructive"
						onSelect={remove}
					>
						Delete
					</DropdownMenuItem>
				</DropdownMenuGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
