import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { toRichTextDocument } from "@/shared/rich-text";
import { normalizeYouTubeVideoId } from "@/shared/youtube";
import { RichTextInput, type RichTextInputHandle } from "./RichTextEditor";
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
	const richEditor = useRef<RichTextInputHandle>(null);
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
	const richField =
		object.kind === "card" ? "body" : object.kind === "sticky" ? "label" : null;
	const [initialRichContent] = useState(() =>
		toRichTextDocument(richField ? object.data[richField] : ""),
	);
	return (
		<dialog
			ref={dialog}
			onCancel={cancel}
			aria-labelledby="object-editor-title"
			className={cn(
				"board-edit-dialog rounded-xl border bg-card p-6 text-card-foreground shadow-xl",
				richField && "board-rich-dialog",
			)}
		>
			<form
				className="flex flex-col gap-4"
				onSubmit={async (event) => {
					event.preventDefault();
					const patch: Record<string, unknown> = Object.fromEntries(
						new FormData(event.currentTarget),
					);
					if (richField)
						patch[richField] =
							richEditor.current?.getJSON() ?? initialRichContent;
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
					<div key={field} className="flex flex-col gap-2 capitalize">
						<label htmlFor={`object-${field}`}>
							{field === "videoId"
								? "YouTube URL or ID"
								: field === "fontSize"
									? "Size"
									: field}
						</label>
						{field === richField ? (
							<RichTextInput
								ref={richEditor}
								id={`object-${field}`}
								content={initialRichContent}
								ariaLabel={`${field} content`}
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
					</div>
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
