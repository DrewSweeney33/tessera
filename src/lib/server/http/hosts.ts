// The host check (ADR-005 section 1). A hostile web page can make a browser send requests to a service on
// the visitor's own machine or network by pointing a domain it controls at that address ("DNS rebinding").
// To the browser such requests look same-origin, so the cross-site protections do not apply. What the page
// cannot fake is the Host header: it is always the attacker's own domain. So the server answers only to the
// names it is meant to be reached by.

// Names that can only be local or private. They are not delegated on the public internet, so an attacker
// cannot point one at a victim's address.
const PRIVATE_SUFFIXES = [
	'.local',
	'.lan',
	'.home.arpa',
	'.internal',
	'.localdomain',
	'.localhost'
];

interface ParsedHost {
	name: string;
	port: string | undefined;
}

// Splits a Host header into name and port. Returns undefined for anything that is not a plausible host,
// so odd input is refused rather than guessed at.
function parseHost(raw: string): ParsedHost | undefined {
	const value = raw.trim().toLowerCase();
	if (value === '' || value.length > 255) return undefined;

	if (value.startsWith('[')) {
		const end = value.indexOf(']');
		if (end < 0) return undefined;
		const name = value.slice(0, end + 1);
		const rest = value.slice(end + 1);
		if (!/^\[[0-9a-f:.]+\]$/.test(name)) return undefined;
		if (rest === '') return { name, port: undefined };
		return /^:\d{1,5}$/.test(rest) ? { name, port: rest.slice(1) } : undefined;
	}

	let name = value;
	let port: string | undefined;
	const colon = value.lastIndexOf(':');
	if (colon >= 0) {
		name = value.slice(0, colon);
		port = value.slice(colon + 1);
		if (!/^\d{1,5}$/.test(port)) return undefined;
	}
	if (name.endsWith('.')) name = name.slice(0, -1);
	if (!/^[a-z0-9]([a-z0-9._-]*[a-z0-9])?$/.test(name) || name.includes('..')) return undefined;
	return { name, port };
}

function isIpv4(name: string): boolean {
	const parts = name.split('.');
	return parts.length === 4 && parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255);
}

// An address, or the loopback name. Reaching the server by one of these is not a rebinding attack,
// because a rebinding page always arrives under its own domain name.
function isAddressOrLoopback(name: string): boolean {
	return (
		name.startsWith('[') || isIpv4(name) || name === 'localhost' || name.endsWith('.localhost')
	);
}

// What is accepted when TESSERA_ALLOWED_HOSTS is not set: single-word names (tessera, nas) and the
// private suffixes above.
function isDefaultName(name: string): boolean {
	return !name.includes('.') || PRIVATE_SUFFIXES.some((suffix) => name.endsWith(suffix));
}

// One entry of TESSERA_ALLOWED_HOSTS, already lower case: "name", "name:port", or "*.domain".
function matchesEntry(entry: string, host: ParsedHost): boolean {
	if (entry.startsWith('*.')) {
		const suffix = entry.slice(1); // ".domain", with or without a port
		const [domain, port] = suffix.split(':');
		if (port !== undefined && port !== host.port) return false;
		// The domain starts with a dot, so the bare domain itself never matches, only names under it.
		return host.name.endsWith(domain!);
	}
	const [name, port] = entry.includes(':') && !entry.startsWith('[') ? entry.split(':') : [entry];
	if (port !== undefined && port !== host.port) return false;
	return name === host.name;
}

// Decides whether a request for this Host may be answered. Addresses and localhost are always fine.
// With no list, the default private-name rules apply. With a list, only the listed names do.
export function isHostAllowed(
	hostHeader: string | null | undefined,
	allowedHosts: readonly string[] | undefined
): boolean {
	if (!hostHeader) return false;
	const host = parseHost(hostHeader);
	if (!host) return false;
	if (isAddressOrLoopback(host.name)) return true;
	if (allowedHosts === undefined) return isDefaultName(host.name);
	return allowedHosts.some((entry) => matchesEntry(entry, host));
}

// A host name that is safe to show back to the person who sent it, or undefined.
export function displayableHost(hostHeader: string): string | undefined {
	const host = parseHost(hostHeader);
	return host ? hostHeader.trim().toLowerCase().slice(0, 100) : undefined;
}
