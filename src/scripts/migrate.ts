import { sql } from "../lib/db";

const migrations = [
	
] as const;

type ExistingMigration = {
	name: string;
};

type ExistingTable = {
	exists: boolean;
};

async function main() {
	await sql`
		create table if not exists app_migrations (
			name text primary key,
			applied_at timestamptz not null default current_timestamp
		)
	`;

	const appliedMigrations = await sql<ExistingMigration[]>`
		select name from app_migrations
	`;
	const appliedNames = new Set(appliedMigrations.map(({ name }) => name));

	for (const migration of migrations) {
		if (appliedNames.has(migration.file)) {
			continue;
		}

		const [existingTable] =
			"column" in migration
				? await sql<ExistingTable[]>`
					select exists (
						select from information_schema.columns
						where table_schema = current_schema()
							and table_name = ${migration.table}
							and column_name = ${migration.column}
					) as exists
				`
				: await sql<ExistingTable[]>`
					select exists (
						select from pg_tables
						where schemaname = current_schema() and tablename = ${migration.table}
					) as exists
				`;

		if (existingTable?.exists) {
			await sql`insert into app_migrations (name) values (${migration.file})`;
			console.log(`Recorded ${migration.file}.`);
			continue;
		}

		const migrationSql = await Bun.file(`migrations/${migration.file}`).text();
		await sql.begin(async (transaction) => {
			await transaction.unsafe(migrationSql).simple();
			await transaction`insert into app_migrations (name) values (${migration.file})`;
		});
		console.log(`Applied ${migration.file}.`);
	}
}

try {
	await main();
} finally {
	try {
		await sql.close();
	} catch {
		// A failed transaction can close Bun's connection before cleanup runs.
	}
}