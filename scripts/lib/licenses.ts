// License policy for shipped (production) dependencies. Staff-engineer standard: permissive licenses only.
// The application itself is AGPL-3.0. Everything it bundles must be compatible with that.
export const ALLOWED_LICENSES: ReadonlySet<string> = new Set([
	'MIT',
	'Apache-2.0',
	'ISC',
	'BSD-2-Clause',
	'BSD-3-Clause',
	'MPL-2.0',
	'0BSD',
	'BlueOak-1.0.0',
	'CC0-1.0',
	'Unlicense'
]);

// Evaluates an SPDX expression such as "(MIT OR Apache-2.0)" or "MIT AND BSD-3-Clause".
// OR needs at least one allowed alternative. AND needs all of them. "X WITH exception" counts as X.
export function isAllowed(
	expression: string,
	allowed: ReadonlySet<string> = ALLOWED_LICENSES
): boolean {
	const tokens = expression.match(/\(|\)|[^\s()]+/g) ?? [];
	let position = 0;
	// Set when an operand is missing or a bracket is unbalanced. Such an expression is never allowed.
	let malformed = false;

	const peek = () => tokens[position];
	const take = () => (position < tokens.length ? tokens[position++] : undefined);

	function parseOr(): boolean {
		let result = parseAnd();
		while (peek()?.toUpperCase() === 'OR') {
			take();
			const next = parseAnd();
			result = result || next;
		}
		return result;
	}

	function parseAnd(): boolean {
		let result = parsePrimary();
		while (peek()?.toUpperCase() === 'AND') {
			take();
			const next = parsePrimary();
			result = result && next;
		}
		return result;
	}

	function parsePrimary(): boolean {
		const token = take();
		if (token === undefined || token === ')') {
			malformed = true;
			return false;
		}
		if (token === '(') {
			const inner = parseOr();
			if (peek() === ')') take();
			else malformed = true;
			return inner;
		}
		const ok = allowed.has(token.replace(/\+$/, ''));
		if (peek()?.toUpperCase() === 'WITH') {
			take();
			take();
		}
		return ok;
	}

	const result = parseOr();
	return result && !malformed && position === tokens.length;
}

export interface LockPackage {
	version?: string;
	license?: string;
	dev?: boolean;
	devOptional?: boolean;
	link?: boolean;
}

export interface LicenseFinding {
	name: string;
	version: string;
	license: string;
	allowed: boolean;
}

// Reads the production packages from a package-lock.json structure. Dev-only packages are not shipped.
export function productionLicenses(lock: {
	packages?: Record<string, LockPackage>;
}): LicenseFinding[] {
	const findings: LicenseFinding[] = [];
	for (const [path, entry] of Object.entries(lock.packages ?? {})) {
		if (path === '' || entry.dev || entry.link) continue;
		const name = path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length);
		const license = entry.license ?? 'UNKNOWN';
		findings.push({
			name,
			version: entry.version ?? 'unknown',
			license,
			allowed: license !== 'UNKNOWN' && isAllowed(license)
		});
	}
	return findings.sort((a, b) => a.name.localeCompare(b.name));
}
