import { sql } from "../lib/db";
import { drainMediaCleanup } from "../server/cleanup";

try {
	console.log(JSON.stringify(await drainMediaCleanup(100)));
} finally {
	await sql.close();
}
