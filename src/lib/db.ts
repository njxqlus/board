import { SQL } from "bun";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
	throw new Error("DATABASE_URL must be set before starting the application.");
}

/** Use this parameterized Bun SQL client for application database queries. */
export const sql = new SQL(databaseUrl);