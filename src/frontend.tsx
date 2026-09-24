/**
 * This file is the entry point for the React app, it sets up the root
 * element and renders the App component to the DOM.
 *
 * It is included in `src/index.html`.
 */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { TooltipProvider } from "./components/ui/tooltip";

const elem = document.getElementById("root");
if (!elem) throw new Error("Missing root element");
const app = (
	<StrictMode>
		<TooltipProvider delayDuration={250}>
			<App />
		</TooltipProvider>
	</StrictMode>
);

let root: ReturnType<typeof createRoot>;
if (import.meta.hot) {
	// Bun recognizes this direct nullish assignment as a self-accepting HMR boundary.
	root = import.meta.hot.data.root ??= createRoot(elem);
} else {
	root = createRoot(elem);
}
root.render(app);
