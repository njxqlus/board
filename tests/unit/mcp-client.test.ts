import { expect, test } from "bun:test";
import { boardOrigin } from "../../src/mcp/api-client";

test("MCP credentials only go to HTTPS or loopback HTTP origins", () => {
	expect(boardOrigin("http://localhost:3000")).toBe("http://localhost:3000");
	expect(boardOrigin("https://board.example")).toBe("https://board.example");
	for (const url of [
		"http://board.example",
		"https://person:password@board.example",
		"https://board.example/path",
		"file:///tmp/board",
	])
		expect(() => boardOrigin(url)).toThrow();
});
