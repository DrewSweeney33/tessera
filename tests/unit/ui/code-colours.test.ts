import darkTheme from 'shiki/themes/github-dark-high-contrast.mjs';
import lightTheme from 'shiki/themes/github-light-high-contrast.mjs';
import { describe, expect, it } from 'vitest';
import { COLOR_REPLACEMENTS } from '#lib/ui/code-blocks.ts';

// Every colour a highlighted token can have must be readable on the card's code background, in both colour
// schemes (WCAG AA, 4.5 to 1). The backgrounds are the --color-sunken values in src/lib/ui/tokens.css.
// Axe checks the tokens a test page happens to show. This checks all of them, for every language.

const BACKGROUND = {
	light: { l: 0.945, c: 0.013, h: 80 },
	dark: { l: 0.15, c: 0.011, h: 80 }
};

// OKLCH to linear sRGB, then to relative luminance (the WCAG formula works on linear values).
function luminanceOfOklch({ l, c, h }: { l: number; c: number; h: number }): number {
	const a = c * Math.cos((h * Math.PI) / 180);
	const b = c * Math.sin((h * Math.PI) / 180);
	const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
	const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
	const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
	const clamp = (v: number) => Math.min(1, Math.max(0, v));
	const r = clamp(4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_);
	const g = clamp(-1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_);
	const bl = clamp(-0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_);
	return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
}

function luminanceOfHex(hex: string): number {
	const full = hex.length === 4 ? `#${[...hex.slice(1)].map((d) => d + d).join('')}` : hex;
	const [r, g, b] = [1, 3, 5].map((i) => {
		const v = parseInt(full.slice(i, i + 2), 16) / 255;
		return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
	}) as [number, number, number];
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const contrast = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

function tokenColours(
	name: string,
	theme: {
		tokenColors?: { settings?: { foreground?: string } }[];
		colors?: Record<string, string>;
	}
) {
	const colours = new Set<string>();
	for (const rule of theme.tokenColors ?? []) {
		const colour = rule.settings?.foreground;
		if (colour && /^#[0-9a-f]{3,8}$/i.test(colour)) colours.add(colour.toLowerCase());
	}
	const base = theme.colors?.['editor.foreground'];
	if (base) colours.add(base.toLowerCase());
	return [...colours].map((c) => COLOR_REPLACEMENTS[name]?.[c] ?? c);
}

describe.each([
	['light', lightTheme, BACKGROUND.light],
	['dark', darkTheme, BACKGROUND.dark]
] as const)('%s theme token colours', (_scheme, theme, background) => {
	const colours = tokenColours(theme.name ?? '', theme as Parameters<typeof tokenColours>[1]);
	const backgroundLuminance = luminanceOfOklch(background);

	it('has colours to check', () => {
		expect(colours.length).toBeGreaterThan(5);
	});

	it('are all readable on the code background', () => {
		const failing = colours
			.map((colour) => ({ colour, ratio: contrast(luminanceOfHex(colour), backgroundLuminance) }))
			.filter((entry) => entry.ratio < 4.5)
			.map((entry) => `${entry.colour} (${entry.ratio.toFixed(2)} to 1)`);
		expect(failing).toEqual([]);
	});
});

describe('the contrast calculation', () => {
	it('gives the known value for black on white, and notices the faint grey', () => {
		expect(contrast(luminanceOfHex('#000000'), luminanceOfHex('#ffffff'))).toBeCloseTo(21, 0);
		// The original comment grey is what failed in the browser, so the check must see it as too faint.
		const light = luminanceOfOklch(BACKGROUND.light);
		expect(contrast(luminanceOfHex('#66707b'), light)).toBeLessThan(4.5);
		expect(contrast(luminanceOfHex('#5c6570'), light)).toBeGreaterThanOrEqual(4.5);
	});
});
