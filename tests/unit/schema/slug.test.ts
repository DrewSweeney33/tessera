import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { ID_PATTERN } from '#lib/core/schema/limits.ts';
import { slugifyTitle } from '#lib/core/slug.ts';

// The id of a deck made by hand comes from its title (US-11). The form and the server use this one function,
// so the id shown while typing is the id that is saved.

describe('slugifyTitle', () => {
	it.each([
		['CCNA OSPF Notes', 'ccna-ospf-notes'],
		['  Spaces   and---dashes  ', 'spaces-and-dashes'],
		['2026 plan', '2026-plan'],
		['-leading and trailing-', 'leading-and-trailing'],
		['Café déjà-vu!', 'cafe-deja-vu'],
		['ÄÖÜ', 'aou'],
		['Straße', 'strasse'],
		['TCP/IP: the basics (v2)', 'tcp-ip-the-basics-v2'],
		['ａｂｃ', 'abc'],
		['A_B', 'a-b'],
		['x', 'x']
	])('turns %j into %j', (title, id) => {
		expect(slugifyTitle(title)).toBe(id);
	});

	it.each(['', '   ', '!!!', '日本語', '---', '🙂🙂', '\n\t'])(
		'gives "deck" when nothing usable is left of %j',
		(title) => {
			expect(slugifyTitle(title)).toBe('deck');
		}
	);

	it('stops at the longest id, without ending on a hyphen', () => {
		const slug = slugifyTitle(`${'word '.repeat(60)}end`);
		expect(slug.length).toBeLessThanOrEqual(64);
		expect(slug.endsWith('-')).toBe(false);
		expect(ID_PATTERN.test(slug)).toBe(true);
		const cutOnSeparator = slugifyTitle(`${'a'.repeat(63)} b`);
		expect(cutOnSeparator).toBe('a'.repeat(63));
	});

	it('always gives a valid deck id, for any text at all (property test)', () => {
		fc.assert(
			fc.property(fc.string({ unit: 'binary', maxLength: 300 }), (title) => {
				expect(ID_PATTERN.test(slugifyTitle(title))).toBe(true);
			}),
			{ numRuns: 400 }
		);
	});

	it('gives the same answer when applied to its own answer (property test)', () => {
		fc.assert(
			fc.property(fc.string({ maxLength: 120 }), (title) => {
				const once = slugifyTitle(title);
				expect(slugifyTitle(once)).toBe(once);
			}),
			{ numRuns: 400 }
		);
	});

	it('never lets a path, a dot, or an uppercase letter through', () => {
		for (const title of [
			'../../etc/passwd',
			'a.b.c',
			'UPPER',
			'a\\b',
			'<script>alert(1)</script>'
		]) {
			const slug = slugifyTitle(title);
			expect(slug).toMatch(/^[a-z0-9-]+$/);
			expect(slug).not.toContain('..');
		}
	});
});
