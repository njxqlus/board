// Public board service boundary shared by HTTP, media and MCP.

export { getProject } from "./authorization";
export { command } from "./board-commands";
export { type Actor, BoardError } from "./board-context";
export {
	addComment,
	type BoardComment,
	type CommentThread,
	createCommentThread,
	deleteComment,
	listCommentThreads,
} from "./comments";
export * from "./projects";
