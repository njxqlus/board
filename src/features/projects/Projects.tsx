import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";
import type { Board } from "../board/types";
import { McpAccess } from "./McpAccess";
import { ThemeControl } from "./ThemeControl";
export function Projects({ open }: { open: (id: string) => void }) {
	const [boards, setBoards] = useState<Board[]>([]);
	const [title, setTitle] = useState("");
	const [state, setState] = useState<"active" | "archived">("active");
	const load = useCallback(
		() =>
			fetch(`/api/boards?state=${state}`)
				.then((r) => r.json())
				.then(setBoards),
		[state],
	);
	useEffect(() => {
		void load();
	}, [load]);
	const create = async () => {
		const r = await fetch("/api/boards", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				title: title || "Untitled board",
				operationId: crypto.randomUUID(),
			}),
		});
		if (r.ok) open((await r.json()).id);
	};
	return (
		<main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 p-6">
			<header className="flex items-center justify-between">
				<h1 className="text-3xl font-semibold">Your boards</h1>
				<select
					aria-label="Board state"
					className="rounded-md border bg-background px-2 py-1 text-sm"
					value={state}
					onChange={(event) =>
						setState(event.target.value as "active" | "archived")
					}
				>
					<option value="active">Active</option>
					<option value="archived">Archived</option>
				</select>
				<ThemeControl />
				<Button variant="outline" onClick={() => authClient.signOut()}>
					Log out
				</Button>
			</header>
			<McpAccess />
			<section className="flex gap-2">
				<Input
					value={title}
					placeholder="Untitled board"
					onChange={(e) => setTitle(e.target.value)}
				/>
				<Button onClick={create}>Create board</Button>
			</section>
			<section className="grid gap-3">
				{boards.map((board) => (
					<button
						type="button"
						onClick={() => open(board.id)}
						key={board.id}
						className="rounded-lg border bg-card p-4 text-left hover:bg-accent"
					>
						<strong>{board.title}</strong>
						<span className="ml-2 text-sm text-muted-foreground">
							{board.state}
						</span>
					</button>
				))}
				{!boards.length && (
					<p className="text-muted-foreground">
						Create your first board to get started.
					</p>
				)}
			</section>
		</main>
	);
}
