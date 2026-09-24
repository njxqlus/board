import { createHash } from "node:crypto";
import { readdir } from "node:fs/promises";
import { sql } from "../lib/db";

type Applied = { name: string; checksum: string };
async function main() {
	const files = (await readdir("migrations"))
		.filter((name) => /^\d+_.+\.sql$/.test(name))
		.toSorted();
	await sql.begin(async (tx) => {
		await tx`select pg_advisory_xact_lock(8743216)`;
		await tx`create table if not exists app_migrations (name text primary key, checksum text not null, applied_at timestamptz not null default now())`;
		const applied = new Map(
			(await tx<Applied[]>`select name, checksum from app_migrations`).map(
				(row) => [row.name, row.checksum],
			),
		);
		for (const name of files) {
			const source = await Bun.file(`migrations/${name}`).text();
			const checksum = createHash("sha256").update(source).digest("hex");
			const old = applied.get(name);
			if (old && old !== checksum)
				throw new Error(`Migration checksum drift: ${name}`);
			if (old) continue;
			await tx.unsafe(source).simple();
			await tx`insert into app_migrations ${tx({ name, checksum })}`;
			console.log(`Applied ${name}`);
		}
	});
}
try {
	await main();
} finally {
	await sql.close();
}
