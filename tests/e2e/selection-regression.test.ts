import { expect, test } from "bun:test";
import { chromium } from "playwright";
import type { ConnectorRow, ObjectRow } from "../../src/features/board/types";

test("controlled board selection and dragging do not loop", async () => {
	const boardId = "00000000-0000-4000-8000-000000000001";
	const connectors: ConnectorRow[] = [];
	const uploads = new Map<string, File>();
	const objects: ObjectRow[] = [
		{
			id: "00000000-0000-4000-8000-000000000002",
			kind: "shape",
			x: 200,
			y: 160,
			width: 180,
			height: 180,
			data: {
				shape: "square",
				label: "Regression shape",
				style: { opacity: 1 },
			},
			version: 1,
		},
	];
	const firstObject = objects[0];
	if (!firstObject) throw new Error("Missing test object");
	objects.push({
		...firstObject,
		data: structuredClone(firstObject.data),
		id: "00000000-0000-4000-8000-000000000003",
		x: 500,
	});
	const server = Bun.serve({
		port: 0,
		async fetch(req) {
			const path = new URL(req.url).pathname;
			if (path.endsWith("/media") && req.method === "POST") {
				const file = (await req.formData()).get("file") as File;
				const assetId = crypto.randomUUID();
				uploads.set(assetId, file);
				return Response.json({ assetId, mimeType: file.type });
			}
			if (path.includes("/media/")) {
				const file = uploads.get(path.split("/").at(-1) ?? "");
				return file
					? new Response(file, { headers: { "content-type": file.type } })
					: new Response(null, { status: 404 });
			}
			if (path === "/api/auth/get-session")
				return Response.json({
					user: { id: "test", email: "test@example.test", name: "Test" },
					session: {
						id: "test",
						userId: "test",
						expiresAt: new Date(Date.now() + 86400000).toISOString(),
					},
				});
			if (path.endsWith("/snapshot"))
				return Response.json({
					project: { id: boardId, title: "Regression", state: "active" },
					revision: "1",
					objects,
					connectors,
				});
			if (path.endsWith("/commands")) {
				const command = await req.json();
				for (const change of command.changes) {
					if (command.type === "objects.create") {
						objects.push({
							...change,
							id: crypto.randomUUID(),
							version: 1,
							data: { ...change.data, style: change.style ?? {} },
						});
						continue;
					}
					if (command.type === "connectors.create") {
						connectors.push({
							id: crypto.randomUUID(),
							version: 1,
							data: change,
						});
						continue;
					}

					const object = objects.find((value) => value.id === change.id);
					if (!object) continue;
					if (change.patch.style) object.data.style = change.patch.style;
					if (change.patch.x !== undefined) object.x = change.patch.x;
					if (change.patch.y !== undefined) object.y = change.patch.y;
					if (change.patch.width !== undefined)
						object.width = change.patch.width;
					if (change.patch.height !== undefined)
						object.height = change.patch.height;
					if (change.patch.label !== undefined)
						object.data.label = change.patch.label;
					if (change.patch.content !== undefined)
						object.data.content = change.patch.content;
					object.version++;
				}
				return Response.json({ upserts: objects });
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
		page.setDefaultTimeout(4000);
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		await page.goto(`${server.url}board/${boardId}`);
		const node = page.locator(".react-flow__node").first();
		await node.waitFor();
		expect(await page.getByLabel("Zoom level").textContent()).toBe("100%");
		await node.click();
		expect(await node.getAttribute("class")).toContain("selected");
		const group = page.getByRole("button", {
			name: "Group objects",
			exact: true,
		});
		await group.hover();
		await page.getByRole("tooltip").waitFor();
		expect(await page.getByRole("tooltip").textContent()).toContain(
			"Select at least two",
		);
		await group.click({ force: true });
		expect(objects).toHaveLength(2);
		await page
			.getByRole("button", { name: "Show tool labels", exact: true })
			.click();
		expect(
			await page.getByLabel("Creation tools").getAttribute("data-expanded"),
		).toBe("true");
		await page.getByRole("button", { name: "Shapes", exact: true }).click();
		await page
			.getByRole("button", { name: "Add square", exact: true })
			.waitFor();
		await page.keyboard.press("Escape");
		await page
			.getByLabel("Choose a shape", { exact: true })
			.waitFor({ state: "hidden" });
		await page
			.getByRole("button", { name: "Hide tool labels", exact: true })
			.click();
		const before = await node.boundingBox();
		if (!before) throw new Error("Missing node bounds");
		await page.mouse.move(before.x + 40, before.y + 40);
		await page.mouse.down();
		await page.mouse.move(before.x + 140, before.y + 100, { steps: 10 });
		const during = await node.boundingBox();
		expect(during && during.x > before.x + 50).toBe(true);
		await page.mouse.up();
		await page.waitForResponse((response) =>
			response.url().endsWith("/snapshot"),
		);
		const opacity = page.getByLabel("Object opacity");
		await opacity.fill("0.4");
		const saved = page.waitForResponse((response) =>
			response.url().endsWith("/snapshot"),
		);
		await opacity.dispatchEvent("pointerup");
		await saved;
		await page.waitForFunction(
			() =>
				document.querySelector<HTMLElement>(".board-object-visual")?.style
					.opacity === "0.4",
		);
		expect(await page.locator(".react-flow__node").count()).toBe(2);
		expect(await node.isVisible()).toBe(true);
		expect(await page.locator(".react-flow__node").nth(1).isVisible()).toBe(
			true,
		);
		await page.reload();
		await node.waitFor();
		expect(await page.locator(".react-flow__node").count()).toBe(2);

		expect(await page.locator(".react-flow__attribution").count()).toBe(0);
		expect(await page.locator(".board-object [data-kind]").count()).toBe(0);
		await node.dblclick();
		await page.getByLabel(/^label$/i).fill("Edited shape");
		const edited = page.waitForResponse((response) =>
			response.url().endsWith("/snapshot"),
		);
		await page.getByRole("button", { name: "Save", exact: true }).click();
		await edited;
		await node.getByText("Edited shape", { exact: true }).waitFor();
		expect(await node.textContent()).toContain("Edited shape");
		await page.getByRole("button", { name: "Connector", exact: true }).click();
		const source = await node.locator('[data-handleid="right"]').boundingBox();
		const target = await page
			.locator(".react-flow__node")
			.nth(1)
			.locator('[data-handleid="left"]')
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
			{ steps: 12 },
		);
		const connected = page.waitForResponse((response) =>
			response.url().endsWith("/snapshot"),
		);
		await page.mouse.up();
		await connected;
		expect(connectors.length).toBe(1);
		expect(connectors[0]?.data.source).toMatchObject({
			kind: "attached",
			anchor: { x: 1, y: 0.5 },
		});
		await page.locator(".react-flow__edge").waitFor();
		expect(await page.locator(".react-flow__edge").count()).toBe(1);
		const created = page.waitForResponse((response) =>
			response.url().endsWith("/snapshot"),
		);
		await page.getByRole("button", { name: "Table", exact: true }).click();
		await created;
		await page.locator('[data-kind="table"] table').waitFor();
		expect(await page.locator('[data-kind="table"] th').count()).toBe(3);
		await page.getByRole("button", { name: "Select", exact: true }).click();
		await node.click();
		const resize = await node
			.locator(".react-flow__resize-control.bottom.right.handle")
			.boundingBox();
		if (!resize) throw new Error("Resize handle is missing");
		const originalWidth = objects[0]?.width ?? 0;
		await page.mouse.move(
			resize.x + resize.width / 2,
			resize.y + resize.height / 2,
		);
		await page.mouse.down();
		await page.mouse.move(resize.x + 55, resize.y + 45, { steps: 8 });
		const resized = page.waitForResponse((response) =>
			response.url().endsWith("/snapshot"),
		);
		await page.mouse.up();
		await resized;
		expect(objects[0]?.width).toBeGreaterThan(originalWidth);
		expect(objects[0]?.width).toBeCloseTo(objects[0]?.height ?? 0, 1);
		await page.getByRole("button", { name: "Zoom out", exact: true }).click();
		await page.waitForFunction(
			() =>
				document
					.querySelector('[aria-label="Zoom level"]')
					?.textContent?.trim() === "83%",
		);
		const corner = await node
			.locator(".react-flow__resize-control.bottom.right.handle")
			.boundingBox();
		if (!corner) throw new Error("Missing square corner");
		const previousWidth = objects[0]?.width ?? 0;
		await page.mouse.move(
			corner.x + corner.width / 2,
			corner.y + corner.height / 2,
		);
		await page.mouse.down();
		await page.mouse.move(corner.x + 40, corner.y + 40, { steps: 20 });
		const squareSaved = page.waitForResponse((response) =>
			response.url().endsWith("/snapshot"),
		);
		await page.mouse.up();
		await squareSaved;
		expect(objects[0]?.width).toBeGreaterThan(previousWidth);
		expect(objects[0]?.width).toBeCloseTo(objects[0]?.height ?? 0, 1);
		const styleSaved = page.waitForResponse((response) =>
			response.url().endsWith("/snapshot"),
		);
		await page.getByLabel("Line width", { exact: true }).selectOption("6");
		await styleSaved;
		await page.waitForFunction(
			() =>
				document
					.querySelector(".react-flow__node.selected svg rect")
					?.getAttribute("stroke-width") === "6",
		);
		expect(await node.locator("svg rect").getAttribute("stroke-width")).toBe(
			"6",
		);
		await page.getByRole("button", { name: "Pen", exact: true }).click();
		await page.mouse.move(350, 550);
		await page.mouse.down();
		await page.mouse.move(480, 600, { steps: 12 });
		const drawn = page.waitForResponse((response) =>
			response.url().endsWith("/snapshot"),
		);
		await page.mouse.up();
		await drawn;
		await page.locator('[data-kind="freehand"] polyline').waitFor();
		expect(
			objects.find((object) => object.kind === "freehand")?.data.points,
		).toHaveLength(13);
		await page.getByRole("button", { name: "Select", exact: true }).click();
		await page.screenshot({ path: "/tmp/board-refactor-desktop.png" });
		// Drop an OS-style screenshot with no MIME at a panned/zoomed location.
		const png = await page.evaluate(() => {
			const canvas = document.createElement("canvas");
			canvas.width = 80;
			canvas.height = 40;
			const context = canvas.getContext("2d");
			if (!context) throw new Error("Missing canvas context");
			context.fillStyle = "#3388aa";
			context.fillRect(0, 0, 80, 40);
			return canvas.toDataURL("image/png").split(",")[1] ?? "";
		});
		const expectedPoint = await page.evaluate(() => {
			const viewport = document.querySelector(
				".react-flow__viewport",
			) as HTMLElement;
			const pane = document
				.querySelector(".react-flow")
				?.getBoundingClientRect();
			const m = new DOMMatrixReadOnly(getComputedStyle(viewport).transform);
			return {
				x: (900 - (pane?.x ?? 0) - m.e) / m.a,
				y: (500 - (pane?.y ?? 0) - m.f) / m.d,
			};
		});
		await page.evaluate((png) => {
			const transfer = new DataTransfer();
			transfer.items.add(
				new File(
					[Uint8Array.from(atob(png), (c) => c.charCodeAt(0))],
					"Screenshot 2026-09-24 at 10.45.00 AM.png",
				),
			);
			document.querySelector(".react-flow")?.dispatchEvent(
				new DragEvent("drop", {
					bubbles: true,
					cancelable: true,
					dataTransfer: transfer,
					clientX: 900,
					clientY: 500,
				}),
			);
		}, png);
		await page.waitForFunction(() => {
			const img = document.querySelector(
				".board-object img",
			) as HTMLImageElement;
			return img?.naturalWidth > 0;
		});
		const inserted = objects.find((object) => object.kind === "image");
		expect(inserted).toBeDefined();
		expect((inserted?.x ?? 0) + (inserted?.width ?? 0) / 2).toBeCloseTo(
			expectedPoint.x,
			1,
		);
		expect((inserted?.y ?? 0) + (inserted?.height ?? 0) / 2).toBeCloseTo(
			expectedPoint.y,
			1,
		);
		expect([...uploads.values()][0]?.type).toBe("image/png");
		// Picker freezes the last canvas pointer before opening the system dialog.
		await page.mouse.move(900, 500);
		const chooserEvent = page.waitForEvent("filechooser");
		await page
			.getByRole("button", { name: "Upload media", exact: true })
			.click();
		const chooser = await chooserEvent;
		await page.mouse.move(1100, 600);
		await chooser.setFiles({
			name: "picker.png",
			mimeType: "image/png",
			buffer: Buffer.from(png, "base64"),
		});
		await page.waitForFunction(
			() => document.querySelectorAll(".board-object img").length === 2,
		);
		const picked = objects.filter((object) => object.kind === "image")[1];
		expect((picked?.x ?? 0) + (picked?.width ?? 0) / 2).toBeCloseTo(
			expectedPoint.x,
			1,
		);
		expect((picked?.y ?? 0) + (picked?.height ?? 0) / 2).toBeCloseTo(
			expectedPoint.y,
			1,
		);
		await page.setViewportSize({ width: 390, height: 844 });
		expect(
			await page.evaluate(
				() => document.documentElement.scrollWidth <= innerWidth,
			),
		).toBe(true);
		expect(await page.getByLabel("Creation tools").isVisible()).toBe(true);
		await page
			.getByRole("button", { name: "Show tool labels", exact: true })
			.click();
		await page.getByRole("button", { name: "Shapes", exact: true }).click();
		const picker = await page
			.getByLabel("Choose a shape", { exact: true })
			.boundingBox();
		expect(picker && picker.x >= 0 && picker.x + picker.width <= 390).toBe(
			true,
		);
		await page.keyboard.press("Escape");
		await page
			.getByRole("button", { name: "Hide tool labels", exact: true })
			.click();
		const navigation = await page.getByLabel("Canvas navigation").boundingBox();
		expect(navigation && navigation.width < 220 && navigation.x >= 0).toBe(
			true,
		);
		await page.screenshot({ path: "/tmp/board-refactor-mobile.png" });
		// Zoom can cross the old 50% limit and reaches exactly 1%.
		for (let step = 0; step < 30; step++) {
			await page.getByRole("button", { name: "Zoom out", exact: true }).click();
		}
		expect(await page.getByLabel("Zoom level").textContent()).toBe("1%");
		expect(
			await page
				.locator(".react-flow__viewport")
				.evaluate(
					(element) =>
						new DOMMatrixReadOnly(getComputedStyle(element).transform).a,
				),
		).toBeCloseTo(0.01, 5);
		await page.waitForFunction((id) => {
			const saved = localStorage.getItem(`board-viewport:${id}`);
			return saved && JSON.parse(saved).zoom === 0.01;
		}, boardId);
		await page.reload();
		await page.getByLabel("Zoom level").waitFor();
		expect(await page.getByLabel("Zoom level").textContent()).toBe("1%");
		expect(errors).toEqual([]);
	} finally {
		await browser.close();
		await server.stop(true);
	}
}, 15_000);
