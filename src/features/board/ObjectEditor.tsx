import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { normalizeYouTubeVideoId } from "@/shared/youtube";
import type { ObjectRow } from "./types";

export function ObjectEditor({
	object,
	save,
	cancel,
}: {
	object: ObjectRow;
	save: (patch: Record<string, unknown>) => Promise<void>;
	cancel: () => void;
}) {
	const dialog = useRef<HTMLDialogElement>(null);
	const [pending, setPending] = useState(false);
	const [error, setError] = useState("");
	useEffect(() => {
		dialog.current?.showModal();
	}, []);
	const fields =
		object.kind === "header"
			? ["text", "fontSize"]
			: object.kind === "card"
				? ["title", "body"]
				: object.kind === "youtube"
					? ["title", "videoId"]
					: ["image", "video", "audio"].includes(object.kind)
						? ["caption", "alt"]
						: ["label"];
	return (
		<dialog
			ref={dialog}
			onCancel={cancel}
			aria-labelledby="object-editor-title"
			className="board-edit-dialog rounded-xl border bg-card p-6 text-card-foreground shadow-xl"
		>
			<form
				className="flex flex-col gap-4"
				onSubmit={async (event) => {
					event.preventDefault();
					const patch: Record<string, unknown> = Object.fromEntries(
						new FormData(event.currentTarget),
					);
					if (object.kind === "youtube") {
						const videoId = normalizeYouTubeVideoId(String(patch.videoId));
						if (!videoId) {
							setError("Enter a valid YouTube URL or video ID.");
							return;
						}
						patch.videoId = videoId;
					}
					if (object.kind === "header") {
						patch.fontSize = Number(patch.fontSize);
					}
					setPending(true);
					try {
						await save(patch);
					} finally {
						setPending(false);
					}
				}}
			>
				<h2 id="object-editor-title" className="text-lg font-semibold">
					Edit {object.kind}
				</h2>
				{fields.map((field) => (
					<label
						key={field}
						htmlFor={`object-${field}`}
						className="flex flex-col gap-2 capitalize"
					>
						{field === "videoId"
							? "YouTube URL or ID"
							: field === "fontSize"
								? "Size"
								: field}
						{field === "body" || field === "label" ? (
							<Textarea
								id={`object-${field}`}
								aria-label={field}
								name={field}
								defaultValue={String(object.data[field] ?? "")}
								rows={5}
							/>
						) : (
							<Input
								id={`object-${field}`}
								aria-label={field === "videoId" ? "YouTube URL or ID" : field}
								name={field}
								type={field === "fontSize" ? "number" : "text"}
								min={field === "fontSize" ? 24 : undefined}
								max={field === "fontSize" ? 10_000 : undefined}
								defaultValue={String(object.data[field] ?? "")}
							/>
						)}
					</label>
				))}
				{error ? <p role="alert">{error}</p> : null}
				<div className="flex justify-end gap-2">
					<Button variant="outline" type="button" onClick={cancel}>
						Cancel
					</Button>
					<Button type="submit" disabled={pending}>
						Save
					</Button>
				</div>
			</form>
		</dialog>
	);
}
