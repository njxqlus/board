const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function getEncryptionSecret() {
	const secret = process.env.BETTER_AUTH_SECRET;
	if (!secret || secret.length < 32) {
		throw new Error(
			"BETTER_AUTH_SECRET must be set to encrypt Akahu credentials.",
		);
	}
	return secret;
}

async function getKey() {
	return crypto.subtle.importKey(
		"raw",
		await crypto.subtle.digest(
			"SHA-256",
			textEncoder.encode(getEncryptionSecret()),
		),
		{ name: "AES-GCM" },
		false,
		["encrypt", "decrypt"],
	);
}

function encode(value: Uint8Array) {
	return Buffer.from(value).toString("base64url");
}

function decode(value: string) {
	return Buffer.from(value, "base64url");
}

export async function encryptSecret(value: string) {
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const ciphertext = await crypto.subtle.encrypt(
		{ name: "AES-GCM", iv },
		await getKey(),
		textEncoder.encode(value),
	);
	return `${encode(iv)}.${encode(new Uint8Array(ciphertext))}`;
}

export async function decryptSecret(value: string) {
	const [encodedIv, encodedCiphertext] = value.split(".");
	if (!encodedIv || !encodedCiphertext)
		throw new Error("Invalid encrypted credential.");
	const plaintext = await crypto.subtle.decrypt(
		{ name: "AES-GCM", iv: decode(encodedIv) },
		await getKey(),
		decode(encodedCiphertext),
	);
	return textDecoder.decode(plaintext);
}