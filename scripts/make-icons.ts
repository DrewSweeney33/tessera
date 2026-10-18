// Renders the app icons from the logo (ADR-018). Run by hand when the logo changes; the PNGs are committed.
//   node scripts/make-icons.ts
// Uses the Playwright Chromium that is already a dev dependency, so nothing is added to the build.
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = join('static', 'icons');

// The favicon's light colours (src/lib/assets/favicon.svg), so the app icon matches the tab icon.
const COLOURS = {
	paper: 'oklch(97.5% 0.01 80)',
	ink: 'oklch(21% 0.015 80)',
	accent: 'oklch(46% 0.1 185)',
	soft: 'oklch(60% 0.014 80)'
};

// The four tiles of the logo on a 24 unit grid, drawn into a `size` pixel square. `scale` shrinks the artwork around the
// centre (a maskable icon keeps it inside the middle 80 percent so a launcher can crop the corners). `round` rounds the
// corners of the background; a maskable or Apple icon is a full square, the launcher shapes it.
function page(size: number, scale: number, round: boolean): string {
	return `<!doctype html><html><body style="margin:0;background:transparent">
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24">
<rect width="24" height="24" rx="${round ? 5 : 0}" fill="${COLOURS.paper}"/>
<g transform="translate(12 12) scale(${scale}) translate(-12 -12)">
<rect x="3" y="3" width="8" height="8" rx="1.3" fill="${COLOURS.ink}"/>
<rect x="13" y="3" width="8" height="8" rx="1.3" fill="${COLOURS.accent}"/>
<rect x="3" y="13" width="8" height="8" rx="1.3" fill="${COLOURS.soft}"/>
<rect x="13.75" y="13.75" width="6.5" height="6.5" rx="1" fill="none" stroke="${COLOURS.ink}" stroke-width="1.5"/>
</g></svg></body></html>`;
}

const ICONS: { file: string; size: number; scale: number; round: boolean }[] = [
	{ file: 'icon-192.png', size: 192, scale: 1, round: true },
	{ file: 'icon-512.png', size: 512, scale: 1, round: true },
	// Maskable: a full-bleed square with the artwork inside the safe zone.
	{ file: 'icon-maskable-512.png', size: 512, scale: 0.72, round: false },
	// Apple touch icon: a full square, iOS rounds it.
	{ file: 'apple-touch-icon.png', size: 180, scale: 0.86, round: false }
];

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch(process.env['CI'] ? {} : { channel: 'chrome' });
try {
	for (const icon of ICONS) {
		const context = await browser.newContext({
			viewport: { width: icon.size, height: icon.size },
			deviceScaleFactor: 1
		});
		const tab = await context.newPage();
		await tab.setContent(page(icon.size, icon.scale, icon.round));
		const png = await tab.screenshot({ omitBackground: true, type: 'png' });
		writeFileSync(join(OUT, icon.file), png);
		console.log(`${icon.file} ${icon.size}x${icon.size} ${png.length} bytes`);
		await context.close();
	}

	// The paper colour as hex, for the manifest, which does not understand oklch.
	const probe = await browser.newPage();
	const hex = await probe.evaluate((colour) => {
		const canvas = document.createElement('canvas');
		canvas.width = canvas.height = 1;
		const context = canvas.getContext('2d')!;
		context.fillStyle = colour;
		context.fillRect(0, 0, 1, 1);
		const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
		return '#' + [r, g, b].map((value) => value!.toString(16).padStart(2, '0')).join('');
	}, COLOURS.paper);
	console.log(`paper colour for the manifest: ${hex}`);
} finally {
	await browser.close();
}
