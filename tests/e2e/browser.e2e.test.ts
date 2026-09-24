import { expect, test } from "bun:test";
import { chromium } from "playwright";

const baseUrl = process.env.E2E_BASE_URL;
const email = process.env.E2E_EMAIL;
const password = process.env.E2E_PASSWORD;
const memberEmail = process.env.E2E_MEMBER_EMAIL;
const memberPassword = process.env.E2E_MEMBER_PASSWORD;

async function signIn(
	page: import("playwright").Page,
	account: string,
	secret: string,
) {
	await page.goto(baseUrl ?? "", { waitUntil: "networkidle" });
	await page.getByLabel("Email").fill(account);
	await page.getByLabel("Password").fill(secret);
	await page.getByRole("button", { name: "Sign in" }).click();
	await page.getByRole("heading", { name: "Your boards" }).waitFor();
}

test.skipIf(!baseUrl)(
	"production deep link renders the login shell",
	async () => {
		const browser = await chromium.launch({ headless: true });
		try {
			const page = await browser.newPage({
				viewport: { width: 390, height: 844 },
			});
			const boardId = "00000000-0000-4000-8000-000000000001";
			await page.goto(`${baseUrl}/board/${boardId}`, {
				waitUntil: "networkidle",
			});
			expect(
				await page
					.getByRole("heading", { name: "Collaborative Board" })
					.count(),
			).toBe(1);
			expect(await page.getByLabel("Email").count()).toBe(1);
			expect(await page.url()).toBe(`${baseUrl}/board/${boardId}`);
		} finally {
			await browser.close();
		}
	},
	{ timeout: 15_000 },
);

test.skipIf(!baseUrl || !email || !password)(
	"authenticated user can create content and permanently delete a test board",
	async () => {
		const browser = await chromium.launch({ headless: true });
		try {
			const page = await browser.newPage();
			const title = `E2E board ${crypto.randomUUID()}`;
			await signIn(page, email ?? "", password ?? "");
			await page.getByPlaceholder("Untitled board").fill(title);
			await page.getByRole("button", { name: "Create board" }).click();
			await page
				.getByRole("button", { name: "Back to boards", exact: true })
				.first()
				.waitFor();
			await page.getByLabel("Shapes", { exact: true }).click();
			await page
				.getByRole("button", { name: "Add rectangle", exact: true })
				.click();
			await page.locator('[data-kind="shape"]').waitFor();
			const firstNode = page.locator(".react-flow__node").first();
			const before = await firstNode.boundingBox();
			if (!before) throw new Error("Shape has no measured bounds");
			await page.mouse.move(before.x + 30, before.y + 30);
			await page.mouse.down();
			await page.mouse.move(before.x + 250, before.y + 160, { steps: 15 });
			const moveResponse = page.waitForResponse(
				(response) =>
					response.url().endsWith("/commands") &&
					response.request().method() === "POST",
			);
			await page.mouse.up();
			expect((await moveResponse).ok()).toBe(true);
			const after = await firstNode.boundingBox();
			expect(after && after.x - before.x > 100).toBe(true);
			await page
				.getByRole("button", { name: "Sticky note", exact: true })
				.click();
			await page.locator('[data-kind="sticky"]').waitFor();
			await page
				.getByRole("button", { name: "Connector", exact: true })
				.click();
			const source = await firstNode
				.locator('[data-handleid="left"]')
				.boundingBox();
			const target = await page
				.locator(".react-flow__node")
				.last()
				.locator('[data-handleid="right"]')
				.boundingBox();
			if (!source || !target)
				throw new Error("Connection handles are not visible");
			await page.mouse.move(
				source.x + source.width / 2,
				source.y + source.height / 2,
			);
			await page.mouse.down();
			await page.mouse.move(
				target.x + target.width / 2,
				target.y + target.height / 2,
				{ steps: 15 },
			);
			await page.mouse.up();
			await page.locator(".react-flow__edge").waitFor();
			await page.getByRole("button", { name: "Table", exact: true }).click();
			const table = page.locator('[data-kind="table"]');
			await table.waitFor();
			await table.dblclick();
			const editor = page.locator(".ProseMirror");
			await editor.waitFor();
			await editor.locator("th p").first().click();
			await page.keyboard.press("End");
			await page.keyboard.type(" updated");
			await page.getByRole("button", { name: "Add row", exact: true }).click();
			const saveTable = page.waitForResponse(
				(response) =>
					response.url().endsWith("/commands") &&
					response.request().method() === "POST",
			);
			await page.getByRole("button", { name: "Save", exact: true }).click();
			const tableResponse = await saveTable;
			expect(tableResponse.ok()).toBe(true);
			await page.locator("dialog").waitFor({ state: "detached" });
			expect(await table.locator("tr").count()).toBe(4);
			await page.reload();
			await table.waitFor();
			expect(await table.textContent()).toContain("updated");
			expect(
				await page.evaluate(
					() => document.documentElement.scrollWidth <= innerWidth,
				),
			).toBe(true);
			await page.getByRole("button", { name: "Settings" }).click();
			await page
				.getByLabel("Type the board title to permanently delete")
				.fill(title);
			page.once("dialog", (dialog) => dialog.accept());
			await page.getByRole("button", { name: "Delete permanently" }).click();
			await page.getByRole("heading", { name: "Your boards" }).waitFor();
		} finally {
			await browser.close();
		}
	},
	{ timeout: 15_000 },
);

test.skipIf(!baseUrl || !email || !password || !memberEmail || !memberPassword)(
	"two collaborators receive a committed board change without reloading",
	async () => {
		const browser = await chromium.launch({ headless: true });
		try {
			const owner = await browser.newPage();
			const member = await browser.newPage();
			const title = `Realtime board ${crypto.randomUUID()}`;
			await signIn(owner, email ?? "", password ?? "");
			await owner.getByPlaceholder("Untitled board").fill(title);
			await owner.getByRole("button", { name: "Create board" }).click();
			await owner.getByRole("button", { name: "Settings" }).waitFor();
			await owner.getByRole("button", { name: "Settings" }).click();
			await owner.getByLabel("Add existing member").fill(memberEmail ?? "");
			await owner.getByRole("button", { name: "Add member" }).click();
			await owner.getByText(memberEmail ?? "", { exact: true }).waitFor();
			await owner.getByRole("button", { name: "Close" }).click();
			await signIn(member, memberEmail ?? "", memberPassword ?? "");
			await member.getByText(title, { exact: true }).click();
			await member
				.getByRole("button", { name: "Back to boards", exact: true })
				.first()
				.waitFor();
			await owner.getByLabel("Shapes", { exact: true }).click();
			await owner
				.getByRole("button", { name: "Add rectangle", exact: true })
				.click();
			await member.locator('[data-kind="shape"]').waitFor();
			await owner.getByRole("button", { name: "Settings" }).click();
			await owner
				.getByLabel("Type the board title to permanently delete")
				.fill(title);
			owner.once("dialog", (dialog) => dialog.accept());
			await owner.getByRole("button", { name: "Delete permanently" }).click();
			await owner.getByRole("heading", { name: "Your boards" }).waitFor();
		} finally {
			await browser.close();
		}
	},
	{ timeout: 15_000 },
);
