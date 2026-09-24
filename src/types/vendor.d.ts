declare module "@njxqlus/jean-claude-bun-dam-sdk" {
	export function createClient(options?: {
		baseUrl?: string;
		headers?: Record<string, string>;
	}): {
		createAsset(input: {
			file: Blob;
			filename?: string;
			metadata?: Record<string, unknown>;
			temporary?: boolean;
			ttlSeconds?: number;
			thumbnails?: unknown[];
		}): Promise<Asset>;
		listAssets(input?: {
			limit?: number;
			metadata?: Record<string, unknown>;
		}): Promise<{ data: Asset[] }>;
		getAsset(id: string): Promise<Asset>;
		finalizeAsset(id: string): Promise<Asset>;
		deleteAsset(id: string): Promise<void>;
		getAssetFile(
			id: string,
		): Promise<{ response: Response; contentType: string | null }>;
	};
	type Asset = {
		id: string;
		original_filename: string;
		mime_type: string;
		size: number;
		expires_at: string | null;
	};
}
