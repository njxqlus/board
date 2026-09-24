import { useEffect, useState } from "react";
import { Login } from "./features/auth/Login";
import { BoardView } from "./features/board/BoardView";
import { Projects } from "./features/projects/Projects";
import { authClient } from "./lib/auth-client";
import "./index.css";
export function App() {
	const { data: session, isPending } = authClient.useSession();
	const boardFromPath = () => {
		const match = location.pathname.match(/^\/board\/([0-9a-f-]{36})$/i);
		return match?.[1];
	};
	const [board, setBoard] = useState<string | undefined>(boardFromPath);
	useEffect(() => {
		const onPopState = () => setBoard(boardFromPath());
		addEventListener("popstate", onPopState);
		return () => removeEventListener("popstate", onPopState);
	}, []);
	const openBoard = (id: string) => {
		if (location.pathname !== `/board/${id}`)
			history.pushState({}, "", `/board/${id}`);
		setBoard(id);
	};
	const closeBoard = () => {
		if (location.pathname !== "/") history.pushState({}, "", "/");
		setBoard(undefined);
	};
	if (isPending) return null;
	if (!session) return <Login />;
	return board ? (
		<BoardView id={board} back={closeBoard} currentUserId={session.user.id} />
	) : (
		<Projects open={openBoard} />
	);
}
