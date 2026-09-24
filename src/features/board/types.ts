export type Board = {
	id: string;
	title: string;
	state: string;
	revision: string;
};
export type Member = { id: string; email: string; owner: boolean };
export type ObjectRow = {
	id: string;
	kind: string;
	x: number;
	y: number;
	width: number;
	height: number;
	zIndex?: number;
	parentId?: string | null;
	data: Record<string, unknown>;
	version: number;
};
export type ConnectorRow = {
	id: string;
	version: number;
	data: {
		source?:
			| {
					kind: "attached";
					objectId: string;
					anchor: { x: number; y: number };
			  }
			| { kind: "free"; point: { x: number; y: number } };
		target?:
			| {
					kind: "attached";
					objectId: string;
					anchor: { x: number; y: number };
			  }
			| { kind: "free"; point: { x: number; y: number } };
		label?: string;
		style?: {
			path?: "straight" | "bezier" | "orthogonal";
			stroke?: string;
			strokeWidth?: number;
			strokeDasharray?: "solid" | "dashed" | "dotted";
			opacity?: number;
			markerStart?: "none" | "arrow" | "closed-arrow";
			markerEnd?: "none" | "arrow" | "closed-arrow";
		};
	};
};
export type Cursor = {
	email: string;
	position: { x: number; y: number };
};
export type BoardComment = {
	id: string;
	body: string;
	authorId: string;
	authorEmail: string;
	createdAt: string;
};
export type CommentThread = {
	id: string;
	objectId: string | null;
	position: { x: number; y: number };
	createdBy: string;
	createdAt: string;
	comments: BoardComment[];
};
export type VersionedPatch = {
	id: string;
	expectedVersion: number;
	patch: Record<string, unknown>;
};
export type HistoryEntry = { undo: VersionedPatch[]; redo: VersionedPatch[] };
export type CommandResult = {
	upserts?: Array<{ id: string; version: number }>;
};
export type Theme = "light" | "dark" | "system";
