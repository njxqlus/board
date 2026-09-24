import { useEffect, useState } from "react";
import type { Theme } from "../board/types";
export function ThemeControl() {
	const [theme, setTheme] = useState<Theme>(
		() => (localStorage.getItem("board-theme") as Theme) || "system",
	);
	useEffect(() => {
		const dark =
			theme === "dark" ||
			(theme === "system" &&
				matchMedia("(prefers-color-scheme: dark)").matches);
		document.documentElement.classList.toggle("dark", dark);
		localStorage.setItem("board-theme", theme);
	}, [theme]);
	return (
		<select
			aria-label="Theme"
			className="rounded-md border bg-background px-2 py-1 text-sm"
			value={theme}
			onChange={(event) => setTheme(event.target.value as Theme)}
		>
			<option value="system">System</option>
			<option value="light">Light</option>
			<option value="dark">Dark</option>
		</select>
	);
}
