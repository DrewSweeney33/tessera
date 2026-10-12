import { describe, expect, it } from 'vitest';
import { displayableHost, isHostAllowed } from '#lib/server/http/hosts.ts';

// DNS rebinding: the attacker's page always arrives under a domain name the attacker controls, so the
// defences are about names. Every "refused" case below is a name an attacker could actually use.

const accepted = (host: string, list?: readonly string[]) => isHostAllowed(host, list);

describe('with no list (the default rules)', () => {
	it.each([
		'localhost',
		'localhost:3000',
		'LOCALHOST',
		'localhost.',
		'app.localhost:3000',
		'127.0.0.1',
		'127.0.0.1:3000',
		'192.168.30.99:3000',
		'10.0.0.5',
		'[::1]',
		'[::1]:3000',
		'[fe80::1]:3000',
		'tessera',
		'tessera:3000',
		'nas',
		'my-server',
		'tessera.lan',
		'tessera.local:3000',
		'box.home.arpa',
		'a.b.internal',
		'host.localdomain',
		'Tessera.LAN'
	])('answers %s', (host) => {
		expect(accepted(host)).toBe(true);
	});

	it.each([
		['an ordinary domain', 'attacker.example'],
		['an ordinary domain with a port', 'attacker.example:3000'],
		['a public name that is the owner own domain (needs the setting)', 'tessera.sweentech.com'],
		['a service that resolves any address as a name', '127.0.0.1.nip.io'],
		['a rebinding service name', '7f000001.c0a80001.rbndr.us'],
		['localhost as a prefix of a real domain', 'localhost.evil.com'],
		['a private suffix as a prefix of a real domain', 'tessera.lan.evil.com'],
		['a private suffix inside a real domain', 'lan.evil.com'],
		['the suffix with a dot in front only', 'x.notlan.com'],
		['a name ending in local without a dot', 'evillocal.com'],
		['an IPv4 lookalike with a letter', '127.0.0.x'],
		['an IPv4 with a part over 255', '300.1.1.1'],
		['a long numeric domain', '1.2.3.4.5'],
		['userinfo tricks', 'localhost@evil.com'],
		['a path', 'evil.com/lan'],
		['a space', 'evil .lan'],
		['a port that is not numeric', 'tessera:abc'],
		['an empty label', 'a..lan'],
		['a leading dot', '.lan'],
		['an unterminated IPv6 literal', '[::1'],
		['an IPv6 literal with junk', '[zz::1]'],
		['a very long name', 'a'.repeat(300) + '.lan'],
		['nothing', '']
	])('refuses %s', (_label, host) => {
		expect(accepted(host)).toBe(false);
	});

	it('refuses a missing header', () => {
		expect(isHostAllowed(null, undefined)).toBe(false);
		expect(isHostAllowed(undefined, undefined)).toBe(false);
	});
});

describe('with TESSERA_ALLOWED_HOSTS set', () => {
	const list = ['tessera.sweentech.com', 'box.example.org:8443', '*.homelab.example'];

	it.each([
		'tessera.sweentech.com',
		'tessera.sweentech.com:443',
		'TESSERA.SWEENTECH.COM',
		'box.example.org:8443',
		'app.homelab.example',
		'a.b.homelab.example:3000'
	])('answers %s', (host) => {
		expect(accepted(host, list)).toBe(true);
	});

	it.each([
		['an unlisted name', 'attacker.example'],
		['a listed name on another port when the entry has a port', 'box.example.org:80'],
		['a listed name without the required port', 'box.example.org'],
		['a longer name that merely ends the same way', 'eviltessera.sweentech.com'],
		['a name that contains the listed one', 'tessera.sweentech.com.evil.com'],
		['the bare domain of a wildcard entry', 'homelab.example'],
		['a lookalike of a wildcard entry', 'xhomelab.example'],
		['the default private names, because the list replaces them', 'tessera.lan'],
		['a single word name, for the same reason', 'nas']
	])('refuses %s', (_label, host) => {
		expect(accepted(host, list)).toBe(false);
	});

	it('still answers addresses and localhost, which are not a rebinding route', () => {
		for (const host of ['localhost:3000', '127.0.0.1', '192.168.1.5:3000', '[::1]:3000']) {
			expect(accepted(host, list)).toBe(true);
		}
	});

	it('answers any name under .localhost even when a list replaces the defaults', () => {
		expect(accepted('app.localhost:3000', list)).toBe(true);
		expect(accepted('tessera.localhost', list)).toBe(true);
	});

	it('matches a wildcard entry that carries a port', () => {
		expect(accepted('x.lab.example:3000', ['*.lab.example:3000'])).toBe(true);
		expect(accepted('x.lab.example:80', ['*.lab.example:3000'])).toBe(false);
	});
});

describe('displayableHost', () => {
	it('returns plausible hosts, lower case, and nothing for junk', () => {
		expect(displayableHost('Tessera.Sweentech.com:443')).toBe('tessera.sweentech.com:443');
		expect(displayableHost('<script>alert(1)</script>')).toBeUndefined();
		expect(displayableHost('evil .lan')).toBeUndefined();
	});
});
