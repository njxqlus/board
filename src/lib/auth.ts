import { betterAuth } from "better-auth";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
	throw new Error("DATABASE_URL must be set before starting the application.");
}

/** Authentication storage uses Better Auth's direct PostgreSQL adapter. */
export const databasePool = new Pool({ connectionString: databaseUrl });

export const auth = betterAuth({
	appName: "MyHub",
	database: databasePool,
	// Keep the browser signed in while it remains active: a visit after one week
	// renews the 30-day rolling session window.
	session: {
		expiresIn: 60 * 60 * 24 * 30,
		updateAge: 60 * 60 * 24 * 7,
	},
	emailAndPassword: {
		enabled: true,
		disableSignUp: true,
	},
	advanced: {
		useSecureCookies: process.env.NODE_ENV === "production",
	},
});

/** Used only by the interactive user-provisioning script, never by the web route. */
export const provisioningAuth = betterAuth({
	appName: "MyHub",
	database: databasePool,
	emailAndPassword: {
		enabled: true,
		autoSignIn: false,
		disableSignUp: false,
	},
});