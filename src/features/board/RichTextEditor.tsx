import { TableKit } from "@tiptap/extension-table";
import TextAlign from "@tiptap/extension-text-align";
import { Color, FontSize, TextStyle } from "@tiptap/extension-text-style";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
	AlignCenter,
	AlignLeft,
	AlignRight,
	Bold,
	Columns3,
	Italic,
	Link,
	List,
	ListOrdered,
	Minus,
	Plus,
	Rows3,
	Underline,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ToolButton } from "./BoardTools";

type Props = {
	content: Record<string, unknown>;
	table?: boolean;
	onSave: (content: Record<string, unknown>) => void | Promise<void>;
	onCancel: () => void;
};
export function RichTextEditor({ content, table, onSave, onCancel }: Props) {
	const dialog = useRef<HTMLDialogElement>(null);
	const [pending, setPending] = useState(false);
	const editor = useEditor({
		extensions: [
			StarterKit.configure({
				heading: false,
				blockquote: false,
				codeBlock: false,
				code: false,
				horizontalRule: false,
				strike: false,
			}),
			TextAlign.configure({ types: ["paragraph"] }),
			TextStyle,
			Color,
			FontSize,
			TableKit.configure({
				table: { resizable: true, handleWidth: 6, cellMinWidth: 48 },
			}),
		],
		content,
		editorProps: {
			attributes: {
				class:
					"board-editor-content min-h-40 rounded-md border bg-background p-3 outline-none",
				"aria-label": table ? "Table content" : "Text content",
			},
		},
	});
	useEffect(() => {
		if (!editor) return;
		dialog.current?.showModal();
		if (
			table &&
			!editor.getJSON().content?.some((node) => node.type === "table")
		)
			editor
				.chain()
				.focus()
				.insertTable({ rows: 3, cols: 3, withHeaderRow: true })
				.run();
	}, [editor, table]);
	if (!editor) return null;
	const formatting = [
		{
			label: "Bold",
			icon: Bold,
			action: () => editor.chain().focus().toggleBold().run(),
		},
		{
			label: "Italic",
			icon: Italic,
			action: () => editor.chain().focus().toggleItalic().run(),
		},
		{
			label: "Underline",
			icon: Underline,
			action: () => editor.chain().focus().toggleUnderline().run(),
		},
		{
			label: "Bullets",
			icon: List,
			action: () => editor.chain().focus().toggleBulletList().run(),
		},
		{
			label: "Numbered list",
			icon: ListOrdered,
			action: () => editor.chain().focus().toggleOrderedList().run(),
		},
		{
			label: "Align left",
			icon: AlignLeft,
			action: () => editor.chain().focus().setTextAlign("left").run(),
		},
		{
			label: "Align center",
			icon: AlignCenter,
			action: () => editor.chain().focus().setTextAlign("center").run(),
		},
		{
			label: "Align right",
			icon: AlignRight,
			action: () => editor.chain().focus().setTextAlign("right").run(),
		},
	];
	const tableActions = [
		{
			label: "Add row",
			icon: Plus,
			action: () => editor.chain().focus().addRowAfter().run(),
		},
		{
			label: "Remove row",
			icon: Minus,
			action: () => editor.chain().focus().deleteRow().run(),
		},
		{
			label: "Add column",
			icon: Columns3,
			action: () => editor.chain().focus().addColumnAfter().run(),
		},
		{
			label: "Remove column",
			icon: Minus,
			action: () => editor.chain().focus().deleteColumn().run(),
		},
		{
			label: "Toggle header",
			icon: Rows3,
			action: () => editor.chain().focus().toggleHeaderRow().run(),
		},
	];
	return (
		<dialog
			ref={dialog}
			onCancel={onCancel}
			aria-labelledby="rich-editor-title"
			className="board-edit-dialog board-rich-dialog rounded-xl border bg-card p-4 text-card-foreground shadow-xl"
		>
			<div className="flex flex-col gap-3">
				<h2 id="rich-editor-title" className="text-lg font-semibold">
					{table ? "Edit table" : "Edit text"}
				</h2>
				<div
					role="toolbar"
					className="flex flex-wrap items-center gap-1"
					aria-label="Text formatting"
				>
					{[...formatting, ...(table ? tableActions : [])].map(
						({ label, icon, action }) => (
							<ToolButton
								key={label}
								label={label}
								icon={icon}
								onMouseDown={(event) => event.preventDefault()}
								onClick={action}
							/>
						),
					)}
					<input
						type="color"
						aria-label="Text color"
						onInput={(event) =>
							editor.chain().focus().setColor(event.currentTarget.value).run()
						}
					/>
					<select
						aria-label="Text size"
						defaultValue=""
						onChange={(event) => {
							if (event.target.value)
								editor.chain().focus().setFontSize(event.target.value).run();
						}}
					>
						<option value="">Text size</option>
						<option value="12px">Small</option>
						<option value="16px">Medium</option>
						<option value="24px">Large</option>
					</select>
					<ToolButton
						label="Link"
						icon={Link}
						onMouseDown={(event) => event.preventDefault()}
						onClick={() => {
							const href = window
								.prompt("Paste an http(s) or mailto link")
								?.trim();
							if (!href) return;
							try {
								if (
									["https:", "http:", "mailto:"].includes(
										new URL(href).protocol,
									)
								)
									editor.chain().focus().setLink({ href }).run();
							} catch {}
						}}
					/>
				</div>
				<EditorContent editor={editor} />
				<div className="flex justify-end gap-2">
					<Button type="button" variant="outline" onClick={onCancel}>
						Cancel
					</Button>
					<Button
						type="button"
						disabled={pending}
						onClick={async () => {
							setPending(true);
							try {
								await onSave(editor.getJSON() as Record<string, unknown>);
							} finally {
								setPending(false);
							}
						}}
					>
						Save
					</Button>
				</div>
			</div>
		</dialog>
	);
}
