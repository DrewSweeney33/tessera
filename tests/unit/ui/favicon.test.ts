import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

// The tab icon was the SvelteKit starter's Svelte logo until the first real deploy (the owner saw it in the
// browser tab). It is now Tessera's own mark, the same four tiles as the logo in the page header.

const icon = readFileSync('src/lib/assets/favicon.svg', 'utf8');
const layout = readFileSync('src/routes/+layout.svelte', 'utf8');

describe('the tab icon', () => {
	it('is Tessera, not the starter project logo', () => {
		expect(icon).toContain('<title>Tessera</title>');
		expect(icon.toLowerCase()).not.toContain('svelte');
	});

	it('has the same four tiles as the header logo: three solid and one outlined', () => {
		expect(icon.match(/<rect\b/g)).toHaveLength(5); // a background plus four tiles
		expect(icon).toMatch(/stroke-width/);
	});

	it('is readable on a light and on a dark tab strip', () => {
		expect(icon).toMatch(/prefers-color-scheme:\s*dark/);
		// It carries its own background, so it does not depend on the colour behind it.
		expect(icon).toMatch(/class="bg"/);
	});

	it('carries no script, no external reference, and no embedded raster image', () => {
		expect(icon).not.toMatch(/<script|href=|xlink:|<image|url\(|@import/i);
	});

	it('is small enough for the browser to inline', () => {
		expect(Buffer.byteLength(icon)).toBeLessThan(2000);
	});

	it('is the file the page links as its icon', () => {
		expect(layout).toMatch(/import favicon from '#lib\/assets\/favicon\.svg'/);
		expect(layout).toMatch(/<link rel="icon" href=\{favicon\}/);
	});
});
