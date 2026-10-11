// A random UUID v4 for review ids. crypto.randomUUID only exists in secure contexts (https or
// localhost), and a self-hosted app on a plain http LAN address is not one. getRandomValues works
// everywhere, so build the UUID from it when needed.
export function newId(): string {
	if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
	const bytes = crypto.getRandomValues(new Uint8Array(16));
	bytes[6] = (bytes[6]! & 0x0f) | 0x40; // version 4
	bytes[8] = (bytes[8]! & 0x3f) | 0x80; // variant 10
	const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0'));
	return [
		hex.slice(0, 4).join(''),
		hex.slice(4, 6).join(''),
		hex.slice(6, 8).join(''),
		hex.slice(8, 10).join(''),
		hex.slice(10, 16).join('')
	].join('-');
}
