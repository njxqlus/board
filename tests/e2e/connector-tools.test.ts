import { expect, test } from "bun:test";
import { chromium } from "playwright";
import type { ConnectorRow, ObjectRow } from "../../src/features/board/types";

test("connector labels can be edited and connectors can be deleted", async () => {
	const boardId = "00000000-0000-4000-8000-000000000101";
	const objects: ObjectRow[] = [
		{
			id: "00000000-0000-4000-8000-000000000102",
			kind: "shape",
			x: 180,
			y: 180,
			width: 160,
			height: 100,
			data: { label: "Source" },
			version: 1,
		},
		{
			id: "00000000-0000-4000-8000-000000000103",
			kind: "shape",
			x: 520,
			y: 180,
			width: 160,
			height: 100,
			data: { label: "Target" },
			version: 1,
		},
	];
	const connectors: ConnectorRow[] = [];
	let revision = 1;
	const server = Bun.serve({
		port: 0,
		async fetch(req) {
			const path = new URL(req.url).pathname;
			if (path === "/api/auth/get-session")
				return Response.json({
					user: { id: "test", email: "test@example.test", name: "Test" },
					session: {
						id: "test",
						userId: "test",
						expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
					},
				});
			if (path.endsWith("/snapshot"))
				return Response.json({
					project: { id: boardId, title: "Connectors", state: "active" },
					revision: String(revision),
					objects,
					connectors,
				});
			if (path.endsWith("/commands")) {
				const command = await req.json();
				for (const change of command.changes) {
					if (command.type === "connectors.create")
						connectors.push({ id: change.id, version: 1, data: change });
					if (command.type === "connectors.update") {
						const connector = connectors.find(
							(value) => value.id === change.id,
						);
						if (connector) {
							connector.data = { ...connector.data, ...change.patch };
							connector.version++;
						}
					}
					if (command.type === "connectors.delete") {
						const index = connectors.findIndex(
							(value) => value.id === change.id,
						);
						if (index >= 0) connectors.splice(index, 1);
					}
				}
				revision++;
				return Response.json({ revision: String(revision), upserts: [] });
			}
			if (path.startsWith("/api/"))
				return new Response("Not found", { status: 404 });
			return new Response(
				Bun.file(
					path.startsWith("/board/") || path === "/"
						? "dist/index.html"
						: `dist${path}`,
				),
			);
		},
	});
	const browser = await chromium.launch({ headless: true });
	try {
		const page = await browser.newPage();
		page.setDefaultTimeout(5_000);
		await page.goto(`${server.url}board/${boardId}`);
		await page.locator(".react-flow__node").first().waitFor();
		await page.getByRole("button", { name: "Connector", exact: true }).click();
		const source = await page
			.locator(
				'[data-testid="rf__node-00000000-0000-4000-8000-000000000102"] [data-handleid="right"]',
			)
			.boundingBox();
		const target = await page
			.locator(
				'[data-testid="rf__node-00000000-0000-4000-8000-000000000103"] [data-handleid="left"]',
			)
			.boundingBox();
		if (!source || !target) throw new Error("Missing connector handles");
		await page.mouse.move(
			source.x + source.width / 2,
			source.y + source.height / 2,
		);
		await page.mouse.down();
		await page.mouse.move(
			target.x + target.width / 2,
			target.y + target.height / 2,
			{
				steps: 10,
			},
		);
		const created = page.waitForResponse((response) =>
			response.url().endsWith("/snapshot"),
		);
		await page.mouse.up();
		await created;
		expect(connectors).toHaveLength(1);

		await page.getByRole("button", { name: "Select", exact: true }).click();
		await page.mouse.click(
			(source.x + source.width / 2 + target.x + target.width / 2) / 2,
			(source.y + source.height / 2 + target.y + target.height / 2) / 2,
		);
		expect(
			await page.locator(".react-flow__edge").getAttribute("class"),
		).toContain("selected");
		await page.getByLabel("Connector label").fill("Manual label");
		const labeled = page.waitForResponse((response) =>
			response.url().endsWith("/snapshot"),
		);
		await page.getByRole("button", { name: "Save", exact: true }).click();
		await labeled;
		expect(connectors[0]?.data.label).toBe("Manual label");
		await page.getByText("Manual label", { exact: true }).waitFor();

		const deleted = page.waitForResponse((response) =>
			response.url().endsWith("/snapshot"),
		);
		await page.getByRole("button", { name: "Delete", exact: true }).click();
		await deleted;
		expect(connectors).toHaveLength(0);
		await page.locator(".react-flow__edge").waitFor({ state: "detached" });
		expect(await page.locator(".react-flow__edge").count()).toBe(0);
	} finally {
		await browser.close();
		server.stop(true);
	}
}, 30_000);
