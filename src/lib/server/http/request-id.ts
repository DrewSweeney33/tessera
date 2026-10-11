const VALID = /^[A-Za-z0-9._-]{1,64}$/;

// Keeps a sane id supplied by a proxy, otherwise creates one. Never trusts arbitrary header content,
// since the id is written to logs and echoed in a response header.
export function resolveRequestId(incoming: string | null): string {
	return incoming !== null && VALID.test(incoming) ? incoming : crypto.randomUUID();
}
