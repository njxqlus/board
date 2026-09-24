import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";
export function Login() {
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [error, setError] = useState("");
	const submit = async (e: React.FormEvent) => {
		e.preventDefault();
		const result = await authClient.signIn.email({
			email: email.trim().toLowerCase(),
			password,
		});
		if (result.error) setError("Invalid email or password.");
	};
	return (
		<main className="flex min-h-screen items-center justify-center p-4">
			<form
				onSubmit={submit}
				className="flex w-full max-w-sm flex-col gap-4 rounded-lg border bg-card p-6 shadow"
			>
				<h1 className="text-2xl font-semibold">Collaborative Board</h1>
				<label htmlFor="login-email">
					Email
					<Input
						id="login-email"
						value={email}
						onChange={(e) => setEmail(e.target.value)}
						type="email"
						required
					/>
				</label>
				<label htmlFor="login-password">
					Password
					<Input
						id="login-password"
						value={password}
						onChange={(e) => setPassword(e.target.value)}
						type="password"
						required
					/>
				</label>
				{error && (
					<p role="alert" className="text-destructive">
						{error}
					</p>
				)}
				<Button type="submit">Sign in</Button>
			</form>
		</main>
	);
}
