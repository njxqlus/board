import { betterAuth } from "better-auth";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
	throw new Error("DATABASE_URL must be set before starting the application.");
}

/** Authentication storage uses Better Auth's direct PostgreSQL adapter. */
export const databasePool = new Pool({ connectionString: databaseUrl });
const configuredAuthUrl = new URL(
	process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
);
const loopbackHttp =
	configuredAuthUrl.protocol === "http:" &&
	["localhost", "127.0.0.1", "::1"].includes(configuredAuthUrl.hostname);

export const auth = betterAuth({
	appName: "Collaborative Board",
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
	rateLimit: { customRules: { "/sign-in/email": { window: 900, max: 30 } } },
	advanced: {
		// The HTTP boundary overwrites this header; never trust a browser value.
		ipAddress: { ipAddressHeaders: ["x-board-auth-ip"] },
		// A production image is smoke-testable on localhost, while every non-loopback
		// production origin still receives Secure cookies.
		useSecureCookies: process.env.NODE_ENV === "production" && !loopbackHttp,
	},
});

/** Used only by the interactive user-provisioning script, never by the web route. */
export const provisioningAuth = betterAuth({
	appName: "Collaborative Board",
	database: databasePool,
	emailAndPassword: {
		enabled: true,
		autoSignIn: false,
		disableSignUp: false,
	},
});
