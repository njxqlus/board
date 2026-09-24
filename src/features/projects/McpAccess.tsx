import { Copy, KeyRound, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";

type AccessKey = {
	id: string;
	label: string;
	expires_at: string;
	created_at: string;
};
export function McpAccess() {
	const [open, setOpen] = useState(false);
	const [keys, setKeys] = useState<AccessKey[]>([]);
	const [issued, setIssued] = useState<{ id: string; token: string } | null>(
		null,
	);
	const [busy, setBusy] = useState(false);
	const [message, setMessage] = useState("");
	const endpoint = `${window.location.origin}/mcp`;
	const config = issued
		? `[mcp_servers.board]\nurl = ${JSON.stringify(endpoint)}\nhttp_headers = { Authorization = ${JSON.stringify(`Bearer ${issued.token}`)} }`
		: "";
	const request = async (init?: RequestInit) => {
		const response = await fetch("/api/mcp/keys", init);
		const value = await response.json();
		if (!response.ok)
			throw new Error(value.error?.message ?? "Unable to manage MCP keys");
		return value;
	};
	const run = async (work: () => Promise<void>) => {
		setBusy(true);
		setMessage("");
		try {
			await work();
		} catch (error) {
			setMessage(error instanceof Error ? error.message : "Request failed");
		} finally {
			setBusy(false);
		}
	};
	return (
		<section aria-label="MCP access">
			<Button
				variant="outline"
				aria-expanded={open}
				disabled={busy}
				onClick={() => {
					if (open) {
						setOpen(false);
						setIssued(null);
						return;
					}
					setOpen(true);
					void run(async () => setKeys(await request()));
				}}
			>
				<KeyRound data-icon="inline-start" />
				Connect Codex / MCP
			</Button>
			{open && (
				<Card className="mt-3">
					<CardHeader>
						<CardTitle>Remote MCP access</CardTitle>
						<CardDescription>
							Connect directly using Streamable HTTP. No local adapter or
							installation is needed. Each key grants your board permissions,
							including editing and deletion, but cannot manage members or
							access keys. Keys expire after 90 days.
						</CardDescription>
					</CardHeader>
					<CardContent className="flex flex-col gap-3">
						<p>
							Server URL: <code className="break-all">{endpoint}</code>
						</p>
						{issued && (
							<>
								<p>
									Copy this key now; it will not be shown again. Keep it
									private.
								</p>
								<code className="break-all" data-testid="new-mcp-key">
									{issued.token}
								</code>
								<div className="flex flex-wrap gap-2">
									<Button
										variant="outline"
										onClick={() =>
											void run(async () => {
												await navigator.clipboard.writeText(issued.token);
												setMessage("Key copied");
											})
										}
									>
										<Copy data-icon="inline-start" />
										Copy key
									</Button>
									<Button
										variant="outline"
										onClick={() =>
											void run(async () => {
												await navigator.clipboard.writeText(config);
												setMessage(
													"Configuration copied; paste into your private Codex config.toml, never into the repository",
												);
											})
										}
									>
										<Copy data-icon="inline-start" />
										Copy Codex configuration
									</Button>
								</div>
							</>
						)}
						<p>
							In Codex MCP settings, choose Streamable HTTP, enter this URL, and
							add the header <code>Authorization: Bearer YOUR_KEY</code>.
							Alternatively, copy the configuration into your private Codex
							config.toml.
						</p>
						<ul className="flex flex-col gap-2">
							{keys.map((key) => (
								<li
									key={key.id}
									className="flex flex-wrap items-center justify-between gap-2"
								>
									<span>
										{key.label} · {key.id.slice(0, 8)} · expires{" "}
										{new Date(key.expires_at).toLocaleDateString()}
									</span>
									<Button
										variant="outline"
										size="sm"
										disabled={busy}
										aria-label={`Revoke key ${key.id.slice(0, 8)}`}
										onClick={() => {
											if (
												!window.confirm(
													"Revoke this key? MCP clients using it will lose access immediately.",
												)
											)
												return;
											void run(async () => {
												await request({
													method: "DELETE",
													headers: { "content-type": "application/json" },
													body: JSON.stringify({ id: key.id }),
												});
												if (issued?.id === key.id) setIssued(null);
												setKeys(await request());
											});
										}}
									>
										<X data-icon="inline-start" />
										Revoke
									</Button>
								</li>
							))}
						</ul>
						<p role="status">{message}</p>
					</CardContent>
					<CardFooter>
						<Button
							disabled={busy || Boolean(issued)}
							onClick={() => {
								if (
									!window.confirm(
										"Create a 90-day key with access to all your boards, including editing and deletion?",
									)
								)
									return;
								void run(async () => {
									setIssued(await request({ method: "POST" }));
									setKeys(await request());
								});
							}}
						>
							<KeyRound data-icon="inline-start" />
							Create access key
						</Button>
					</CardFooter>
				</Card>
			)}
		</section>
	);
}
