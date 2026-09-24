import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "./tools";

await createMcpServer().connect(new StdioServerTransport());
