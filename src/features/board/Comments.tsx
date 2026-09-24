import { useReactFlow, useViewport } from "@xyflow/react";
import { MessageCircle, Send, X } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { CommentThread, ObjectRow } from "./types";

export type CommentDraft = {
	objectId: string | null;
	position: { x: number; y: number };
};

function commentPosition(
	thread: CommentThread,
	objects: Map<string, ObjectRow>,
) {
	const object = thread.objectId ? objects.get(thread.objectId) : undefined;
	return object ? { x: object.x + object.width, y: object.y } : thread.position;
}

export function CommentPins({
	threads,
	objects,
	open,
}: {
	threads: CommentThread[];
	objects: ObjectRow[];
	open: (threadId: string) => void;
}) {
	const { flowToScreenPosition } = useReactFlow();
	useViewport();
	const objectById = useMemo(
		() => new Map(objects.map((object) => [object.id, object])),
		[objects],
	);
	return (
		<div className="pointer-events-none fixed inset-0 z-[6] overflow-hidden">
			{threads.map((thread) => {
				const position = flowToScreenPosition(
					commentPosition(thread, objectById),
				);
				return (
					<button
						key={thread.id}
						type="button"
						className="board-comment-pin pointer-events-auto"
						style={{ left: position.x, top: position.y }}
						onClick={() => open(thread.id)}
						aria-label={`Open comment thread with ${thread.comments.length} comments`}
						title={`${thread.comments.length} comment${thread.comments.length === 1 ? "" : "s"}`}
					>
						<MessageCircle aria-hidden="true" />
						<span>{thread.comments.length}</span>
					</button>
				);
			})}
		</div>
	);
}

export function CommentDialog({
	thread,
	draft,
	readonly,
	close,
	create,
	reply,
}: {
	thread: CommentThread | null;
	draft: CommentDraft | null;
	readonly: boolean;
	close: () => void;
	create: (draft: CommentDraft, body: string) => Promise<boolean>;
	reply: (threadId: string, body: string) => Promise<boolean>;
}) {
	const dialog = useRef<HTMLDialogElement>(null);
	const creating = Boolean(draft);
	useEffect(() => {
		dialog.current?.showModal();
		return () => dialog.current?.close();
	}, []);
	const title = creating ? "New comment" : "Comments";
	return (
		<dialog
			ref={dialog}
			onCancel={close}
			aria-labelledby="comment-dialog-title"
			className="board-comment-dialog rounded-xl border bg-card p-0 text-card-foreground shadow-xl"
		>
			<form
				className="flex min-h-0 flex-col"
				onSubmit={async (event) => {
					event.preventDefault();
					const form = event.currentTarget;
					const body = String(new FormData(form).get("body") ?? "").trim();
					if (!body) return;
					const submit = form.querySelector<HTMLButtonElement>(
						'button[type="submit"]',
					);
					if (submit) submit.disabled = true;
					try {
						const saved = draft
							? await create(draft, body)
							: thread
								? await reply(thread.id, body)
								: false;
						if (saved) form.reset();
					} finally {
						if (submit) submit.disabled = false;
					}
				}}
			>
				<header className="flex items-center justify-between border-b px-5 py-4">
					<div>
						<h2 id="comment-dialog-title" className="font-semibold">
							{title}
						</h2>
						<p className="text-xs text-muted-foreground">
							{creating
								? draft?.objectId
									? "Pinned to an object"
									: "Pinned to this board point"
								: thread?.objectId
									? "Pinned to an object"
									: "Pinned to the board"}
						</p>
					</div>
					<Button
						type="button"
						size="icon-sm"
						variant="ghost"
						onClick={close}
						aria-label="Close comments"
					>
						<X aria-hidden="true" />
					</Button>
				</header>
				{thread ? (
					<div className="board-comment-list" aria-live="polite">
						{thread.comments.map((comment) => (
							<article key={comment.id} className="board-comment-message">
								<div className="flex items-baseline justify-between gap-3">
									<strong>{comment.authorEmail}</strong>
									<time dateTime={comment.createdAt}>
										{new Date(comment.createdAt).toLocaleString()}
									</time>
								</div>
								<p>{comment.body}</p>
							</article>
						))}
					</div>
				) : null}
				{!readonly ? (
					<div className="border-t p-4">
						<label className="sr-only" htmlFor="comment-body">
							{creating ? "Comment" : "Reply"}
						</label>
						<Textarea
							id="comment-body"
							name="body"
							rows={3}
							autoFocus
							placeholder={creating ? "Write a comment…" : "Write a reply…"}
						/>
						<div className="mt-3 flex justify-end gap-2">
							<Button type="button" variant="outline" onClick={close}>
								Cancel
							</Button>
							<Button type="submit">
								<Send data-icon="inline-start" aria-hidden="true" />
								{creating ? "Add comment" : "Reply"}
							</Button>
						</div>
					</div>
				) : null}
			</form>
		</dialog>
	);
}
