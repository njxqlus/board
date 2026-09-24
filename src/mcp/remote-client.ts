import { readBounded } from "../shared/http-bytes";
import type * as localClient from "./api-client";

export type BoardClient = Pick<
	typeof localClient,
	"api" | "apiForm" | "binary"
>;

/** Request-scoped client: never share a user's bearer token across requests. */
export function remoteClient(
	dispatch: (request: Request) => Promise<Response>,
	authorization: string,
): BoardClient {
	const request = (path: string, init?: RequestInit) => {
		if (!path.startsWith("/api/boards"))
			throw new Error("Invalid board API path");
		const headers = new Headers(init?.headers);
		headers.set("authorization", authorization);
		return dispatch(
			new Request(`http://board.internal${path}`, { ...init, headers }),
		);
	};
	const json = async (response: Response) => {
		const value = await response.json();
		if (!response.ok)
			throw new Error(
				value.error?.message ?? `Board request failed (${response.status})`,
			);
		return value;
	};
	return {
		api: async (path, init) => {
			const headers = new Headers(init?.headers);
			headers.set("content-type", "application/json");
			return json(await request(path, { ...init, headers }));
		},
		apiForm: async (path, body) =>
			json(await request(path, { method: "POST", body })),
		binary: async (path) => {
			const response = await request(path);
			if (!response.ok)
				throw new Error(`Media request failed (${response.status})`);
			return {
				bytes: await readBounded(response, 4 * 1024 * 1024),
				mimeType:
					response.headers.get("content-type") ?? "application/octet-stream",
			};
		},
	};
}
