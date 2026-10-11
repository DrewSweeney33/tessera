// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
	renderInlineMarkdown,
	renderInlineMarkdownWithoutLinks,
	renderMarkdown,
	sanitizeHtml
} from '#lib/ui/markdown.ts';
import { XSS_CORPUS } from '../../e2e/xss-corpus.ts';

// ADR-005 has two layers: marked is configured so raw HTML never becomes markup, then DOMPurify
// sanitizes the output. The browser tests in tests/e2e/xss.spec.ts exercise both together. These
// tests exercise each layer on its own, so a regression in one cannot hide behind the other.
// DOMPurify's engine is tested by its authors in real browsers. What is tested here is our configuration.

const FORBIDDEN = new Set([
	'script',
	'iframe',
	'frame',
	'object',
	'embed',
	'img',
	'svg',
	'math',
	'form',
	'input',
	'button',
	'select',
	'textarea',
	'style',
	'link',
	'meta',
	'video',
	'audio',
	'source',
	'base',
	'template'
]);
const URL_ATTRIBUTES = ['href', 'src', 'action', 'formaction', 'xlink:href', 'srcdoc', 'data'];

// Returns every dangerous thing found in an HTML string.
function dangers(html: string): string[] {
	const root = document.createElement('div');
	root.innerHTML = html;
	const found: string[] = [];
	for (const el of root.querySelectorAll('*')) {
		const tag = el.tagName.toLowerCase();
		if (FORBIDDEN.has(tag)) found.push(`<${tag}>`);
		for (const attr of el.attributes) {
			const name = attr.name.toLowerCase();
			if (name.startsWith('on')) found.push(name);
			if (name === 'style' || name === 'id' || name === 'name') found.push(name);
			if (URL_ATTRIBUTES.includes(name) && /^\s*(javascript|data|vbscript):/i.test(attr.value)) {
				found.push(`${name}=${attr.value}`);
			}
		}
		// An anchor whose href was stripped is inert, so only anchors that still have one are checked.
		if (tag === 'a' && el.hasAttribute('href')) {
			const href = el.getAttribute('href') ?? '';
			if (!/^(https?:|mailto:|#|\?|\.{1,2}\/|\/(?!\/))/i.test(href)) found.push(`link ${href}`);
		}
	}
	return found;
}

// The text a reader sees once the HTML is parsed, with entities decoded.
function textOf(html: string): string {
	const root = document.createElement('div');
	root.innerHTML = html;
	return root.textContent ?? '';
}

describe('the danger detector itself', () => {
	it('flags real attacks, so a clean result is meaningful', () => {
		expect(dangers('<img src=x onerror=alert(1)>')).toEqual(
			expect.arrayContaining(['<img>', 'onerror'])
		);
		expect(dangers('<a href="javascript:alert(1)">x</a>').length).toBeGreaterThan(0);
		expect(dangers('<p style="x:y" id="a">t</p>')).toEqual(['style', 'id']);
		expect(dangers('<svg onload=1></svg>')).toContain('<svg>');
		expect(dangers('<p>safe <b>text</b> <a href="https://example.com">link</a></p>')).toEqual([]);
	});
});

// Raw HTML that never passes through marked, as if the first layer had a bug.
const RAW_HTML = [
	'<script>window.__pwned=1</script>',
	'<img src=x onerror="window.__pwned=1">',
	'<svg onload="window.__pwned=1"><script>window.__pwned=1</script></svg>',
	'<a href="javascript:window.__pwned=1">x</a>',
	'<a href="  JaVaScRiPt:window.__pwned=1">x</a>',
	'<a href="data:text/html;base64,PHNjcmlwdD4=">x</a>',
	'<a href="//evil.example/x">x</a>',
	'<iframe srcdoc="<script>1</script>"></iframe>',
	'<object data="javascript:1"></object><embed src="javascript:1">',
	'<form action="javascript:1"><input name="a"><button formaction="javascript:1">x</button></form>',
	'<details open ontoggle="window.__pwned=1">x</details>',
	'<p onclick="window.__pwned=1" style="position:fixed;inset:0">x</p>',
	'<math><mtext><table><mglyph><style><!--</style><img title="--&gt;&lt;img src=1 onerror=window.__pwned=1&gt;">',
	'<noscript><p title="</noscript><img src=x onerror=window.__pwned=1>">',
	'<video><source onerror="window.__pwned=1"></video>',
	'<style>@import "https://evil.example/x.css";</style>',
	'<div id="x" name="y">clobber</div>',
	'<input autofocus onfocus="window.__pwned=1">',
	'<base href="https://evil.example/">',
	'<meta http-equiv="refresh" content="0;url=https://evil.example">',
	'<link rel="stylesheet" href="https://evil.example/x.css">',
	'<template><script>1</script></template>'
];

describe('layer 2: the sanitizer on raw hostile HTML', () => {
	it.each(RAW_HTML.map((html, i) => [i + 1, html] as const))(
		'payload %i is neutralized',
		(_i, html) => {
			expect(dangers(sanitizeHtml(html))).toEqual([]);
		}
	);

	it('keeps harmless formatting', () => {
		const html =
			'<p>Use <code>show ip route</code> and <strong>read</strong> the <em>output</em>.</p><pre><code class="language-cisco">interface g0/0\n</code></pre><ul><li>a</li></ul><table><tr><th>x</th><td>y</td></tr></table>';
		const out = sanitizeHtml(html);
		for (const piece of [
			'<code>show ip route</code>',
			'<strong>read</strong>',
			'<em>output</em>',
			'class="language-cisco"',
			'<li>a</li>',
			'<th>x</th>'
		]) {
			expect(out).toContain(piece);
		}
	});

	it('makes every link open safely', () => {
		const out = sanitizeHtml(
			'<a href="https://example.com/a">a</a> <a href="/import">b</a> <a href="#top">c</a>'
		);
		const links = [...new DOMParser().parseFromString(out, 'text/html').querySelectorAll('a')];
		expect(links).toHaveLength(3);
		for (const link of links) {
			expect(link.getAttribute('rel')).toBe('noopener noreferrer');
			expect(link.getAttribute('target')).toBe('_blank');
		}
	});
});

describe('layer 1: marked configuration, with the corpus', () => {
	it.each(XSS_CORPUS.map((payload) => [payload.name, payload] as const))(
		'%s is rendered as inert text',
		(_name, payload) => {
			const html = renderMarkdown(payload.markdown);
			expect(dangers(html)).toEqual([]);
			if (payload.visible) expect(textOf(html)).toContain(payload.visible);
		}
	);

	it('shows raw HTML as text instead of dropping it', () => {
		expect(renderMarkdown('<b>bold?</b>')).toContain('&lt;b&gt;bold?&lt;/b&gt;');
	});

	it('drops images but keeps their alt text', () => {
		const html = renderMarkdown('![a diagram](https://evil.example/x.png)');
		expect(html).not.toContain('<img');
		expect(html).toContain('a diagram');
	});

	it('keeps only safe link targets', () => {
		const html = renderMarkdown(
			'[ok](https://example.com) [mail](mailto:a@b.co) [rel](./x) [bad](javascript:1) [proto](//evil.example)'
		);
		expect(html.match(/<a /g)).toHaveLength(3);
		expect(html).not.toContain('javascript');
		expect(html).not.toContain('evil.example');
	});

	it('renders code fences as plain code, escaping their content', () => {
		const html = renderMarkdown('```html\n<script>alert(1)</script>\n```');
		expect(html).toContain('&lt;script&gt;');
		expect(dangers(html)).toEqual([]);
	});
});

describe('inline rendering', () => {
	it('has no paragraph wrapper and is equally safe', () => {
		expect(renderInlineMarkdown('**bold** text')).toBe('<strong>bold</strong> text');
		expect(dangers(renderInlineMarkdown('<img src=x onerror=1> [x](javascript:1)'))).toEqual([]);
	});
});

describe('renderInlineMarkdownWithoutLinks (text inside a button)', () => {
	it('keeps the words of a link and drops the link', () => {
		const html = renderInlineMarkdownWithoutLinks('see [the RFC](https://example.com/rfc) now');
		expect(html).toBe('see the RFC now');
		expect(html).not.toContain('<a');
	});

	it('still formats code and emphasis, and still refuses markup', () => {
		const html = renderInlineMarkdownWithoutLinks(
			'run `show ip route` **now** <script>alert(1)</script>'
		);
		expect(html).toContain('<code>show ip route</code>');
		expect(html).toContain('<strong>now</strong>');
		expect(html).not.toContain('<script');
	});

	it('leaves no control inside a button for any item in the attack corpus', () => {
		for (const sample of XSS_CORPUS) {
			const host = document.createElement('div');
			host.innerHTML = renderInlineMarkdownWithoutLinks(sample.markdown);
			expect(host.querySelector('a, button, input, script, iframe'), sample.markdown).toBeNull();
		}
	});
});
