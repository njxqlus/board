import type { sql } from "../lib/db";
export class BoardError extends Error {
	constructor(
		public status: number,
		message: string,
		public code = "BOARD_ERROR",
	) {
		super(message);
	}
}
export type Actor = {
	id: string;
	email: string;
	channel?: "browser" | "mcp";
	clientId?: string;
};
export type Database = typeof sql;
export type Project = {
	id: string;
	title: string;
	owner_id: string;
	state: "active" | "archived" | "deleting";
	revision: string;
};
export type StoredObject = {
	id: string;
	kind: string;
	parent_id: string | null;
	x: number;
	y: number;
	width: number;
	height: number;
	z_index: number;
	data: Record<string, unknown>;
	version: number;
};
