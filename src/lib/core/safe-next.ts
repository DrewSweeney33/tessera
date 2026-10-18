// Where to go after signing in. It comes from the address bar (`/login?next=/settings`), so it is only ever a path on
// this site: it must start with a single slash, hold no control characters or backslashes, and not go back to the login
// or into the API. Anything else is the start page, so a crafted link cannot send a person to another site.
export function safeNextPath(raw: string | null | undefined): string {
	if (typeof raw !== 'string' || raw.length === 0 || raw.length > 500) return '/';
	if (!raw.startsWith('/') || raw.startsWith('//')) return '/';
	// eslint-disable-next-line no-control-regex
	if (/[\u0000-\u001f\u007f\\]/.test(raw)) return '/';
	if (/^\/(login|api)(\/|\?|#|$)/i.test(raw)) return '/';
	try {
		const parsed = new URL(raw, 'http://localhost');
		if (parsed.origin !== 'http://localhost') return '/';
	} catch {
		return '/';
	}
	return raw;
}
