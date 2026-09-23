import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";
import { databasePool, provisioningAuth } from "../lib/auth";

async function promptPassword() {
	if (!input.isTTY) {
		throw new Error("Password prompting requires an interactive terminal.");
	}

	output.write("Password: ");
	input.setRawMode(true);
	input.resume();
	input.setEncoding("utf8");

	return new Promise<string>((resolve, reject) => {
		let password = "";

		const finish = () => {
			input.off("data", onData);
			input.setRawMode(false);
			input.pause();
			output.write("\n");
		};

		const onData = (character: string) => {
			if (character === "\r" || character === "\n") {
				finish();
				resolve(password);
				return;
			}

			if (character === "\u0003") {
				finish();
				reject(new Error("Cancelled."));
				return;
			}

			if (character === "\u007f") {
				password = password.slice(0, -1);
				return;
			}

			password += character;
		};

		input.on("data", onData);
	});
}

async function main() {
	const prompt = createInterface({ input, output });
	const email = (await prompt.question("Email: ")).trim().toLowerCase();
	prompt.close();
	const password = await promptPassword();

	if (!email || !password) {
		throw new Error("Email and password are required.");
	}

	await provisioningAuth.api.signUpEmail({
		body: {
			email,
			name: email,
			password,
		},
	});

	console.log(`Created user ${email}.`);
}

try {
	await main();
} catch (error) {
	console.error(
		error instanceof Error ? error.message : "Unable to create user.",
	);
	process.exitCode = 1;
} finally {
	await databasePool.end();
}