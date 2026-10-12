import { LIMITS } from './schema/limits.ts';

// An id for a deck made by hand, from its title (US-11): lower case ASCII letters and digits with single hyphens
// between, at most the longest id the schema allows. A title with nothing usable in it (all symbols, or a script
// with no ASCII letters) gives "deck", and the server makes it unique. The form shows this while the owner types and
// the server uses it when no id is given, so the one function is the one answer.
export function slugifyTitle(title: string): string {
	const ascii = title
		.normalize('NFKD')
		.replace(/\p{M}+/gu, '')
		.replaceAll('ß', 'ss')
		.toLowerCase();
	const slug = ascii
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+/, '')
		.slice(0, LIMITS.maxIdLength)
		.replace(/-+$/, '');
	return slug === '' ? 'deck' : slug;
}
