// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
	currentScheme,
	enhanceCodeBlocks,
	highlightCode,
	isSafeColor,
	languageFor,
	svgToImageSource
} from '#lib/ui/code-blocks.ts';

// Code highlighting and diagrams are built so that card text can never become markup (ADR-010). Mermaid
// itself needs a real browser to measure text, so drawing is covered by the browser tests. What is tested
// here is everything around it that decides what reaches the page.

const decode = (src: string) => decodeURIComponent(src.slice(src.indexOf(',') + 1));

function block(source: string, lang: string): { pre: HTMLPreElement; code: HTMLElement } {
	const pre = document.createElement('pre');
	const code = document.createElement('code');
	code.className = `language-${lang}`;
	code.textContent = source;
	pre.append(code);
	document.body.append(pre);
	return { pre, code };
}

describe('languageFor', () => {
	it('knows the languages and their usual short names', () => {
		expect(languageFor('python')).toBe('python');
		expect(languageFor('PY')).toBe('python');
		expect(languageFor('sh')).toBe('bash');
		expect(languageFor('ps1')).toBe('powershell');
		expect(languageFor('ts')).toBe('typescript');
		expect(languageFor('yml')).toBe('yaml');
	});

	it('has nothing for an unknown language, and never matches a name from Object itself', () => {
		for (const name of [
			'',
			'cobol',
			'mermaid',
			'constructor',
			'__proto__',
			'toString',
			'hasOwnProperty'
		]) {
			expect(languageFor(name), name).toBeUndefined();
		}
	});
});

describe('svgToImageSource', () => {
	const good =
		'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120.5 40" width="100%" style="max-width: 120px">' +
		'<style>.n{fill:#eee}</style><rect class="n" width="100" height="30"/><text x="5" y="20">Hello</text></svg>';

	it('returns an image source with the size of the diagram', () => {
		const src = svgToImageSource(good);
		expect(src.startsWith('data:image/svg+xml;charset=utf-8,')).toBe(true);
		const svg = decode(src);
		expect(svg).toContain('width="121"');
		expect(svg).toContain('height="40"');
		expect(svg).not.toContain('max-width');
		expect(svg).toContain('<rect');
		expect(svg).toContain('Hello');
		expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
	});

	it.each([
		['-50 -10 450 259', 450, 259],
		['0,0,200.2,100', 201, 100],
		['  0 0 10 20  ', 10, 20]
	])('reads the size from a viewBox of %j', (viewBox, width, height) => {
		const svg = decode(
			svgToImageSource(
				`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}"><rect width="1" height="1"/></svg>`
			)
		);
		expect(svg).toContain(`width="${width}"`);
		expect(svg).toContain(`height="${height}"`);
	});

	it('keeps the diagram style rules, which only apply inside the image', () => {
		expect(decode(svgToImageSource(good))).toContain('.n{fill:#eee}');
	});

	it.each([
		['a script element', '<script>window.__pwned=1</script>', '<script'],
		['an onload handler', '', 'onload'],
		['an onclick handler', '', 'onclick'],
		[
			'HTML in a foreignObject',
			'<foreignObject><div>x<img src=x onerror="window.__pwned=1"></div></foreignObject>',
			'foreignObject'
		],
		['a link', '<a href="javascript:window.__pwned=1"><text>x</text></a>', 'javascript:'],
		['an external image', '<image href="https://evil.example/x.png"/>', 'evil.example'],
		['a use of another document', '<use href="https://evil.example/a.svg#x"/>', 'evil.example'],
		['an iframe', '<iframe src="https://evil.example"></iframe>', 'iframe']
	])('removes %s', (_name, inner, forbidden) => {
		const attributes =
			forbidden === 'onload'
				? ' onload="window.__pwned=1"'
				: forbidden === 'onclick'
					? ' onclick="window.__pwned=1"'
					: '';
		const hostile = good.replace('<rect', `${inner}<rect${attributes}`);
		const svg = decode(svgToImageSource(hostile));
		expect(svg).not.toContain(forbidden);
		expect(svg).not.toContain('__pwned');
		expect(svg).toContain('<rect');
	});

	it('refuses something that is not a drawable svg', () => {
		expect(() => svgToImageSource('<p>not a diagram</p>')).toThrow();
		expect(() =>
			svgToImageSource('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>')
		).toThrow();
		expect(() => svgToImageSource('<svg viewBox="0 0 -1 x"><rect/></svg>')).toThrow();
		expect(() => svgToImageSource('')).toThrow();
	});
});

describe('isSafeColor', () => {
	it.each(['#fff', '#0e1116', '#0E1116', '#0e1116ff'])('accepts %s', (value) => {
		expect(isSafeColor(value)).toBe(true);
	});

	it.each([
		undefined,
		'',
		'red',
		'#12',
		'#zzzzzz',
		'#fff; background: url(https://evil.example/x.png)',
		'#fff\n',
		'var(--x)',
		'rgb(0,0,0)',
		'url(https://evil.example)',
		'#fffffffff'
	])('refuses %j', (value) => {
		expect(isSafeColor(value)).toBe(false);
	});
});

describe('highlightCode', () => {
	it('colours tokens and keeps the text exactly', async () => {
		const source = 'const answer: number = 42;\n// done\n';
		const { code } = block(source, 'ts');
		await highlightCode(code, source, 'ts');
		expect(code.classList.contains('shiki')).toBe(true);
		expect(code.textContent).toBe(source);
		const spans = [...code.querySelectorAll<HTMLElement>('span.tk')];
		expect(spans.length).toBeGreaterThan(4);
		expect(spans.some((s) => s.style.getPropertyValue('--shiki-light').startsWith('#'))).toBe(true);
		expect(spans.some((s) => s.style.getPropertyValue('--shiki-dark').startsWith('#'))).toBe(true);
	});

	it('never turns code into markup, whatever it says', async () => {
		const source =
			'<script>window.__pwned=1</script>\n<img src=x onerror="window.__pwned=1">\n<a href="javascript:1">x</a>';
		const { code } = block(source, 'html');
		await highlightCode(code, source, 'html');
		expect(code.textContent).toBe(source);
		expect(code.querySelector('script, img, a, iframe')).toBeNull();
		for (const element of code.querySelectorAll('*')) expect(element.tagName).toBe('SPAN');
		expect(code.querySelectorAll('[onerror], [href], [src]')).toHaveLength(0);
	});

	it('keeps the font style the theme gives a token', async () => {
		const mdSource = '# Title\n\n**bold** and *slanted*';
		const md = block(mdSource, 'md');
		await highlightCode(md.code, mdSource, 'md');
		const spans = [...md.code.querySelectorAll<HTMLElement>('span.tk')];
		expect(spans.map((s) => s.style.fontWeight)).toContain('700');
		expect(spans.map((s) => s.style.fontStyle)).toContain('italic');
	});

	it('only ever sets a colour that looks like a colour', async () => {
		const source = 'echo "hello"';
		const { code } = block(source, 'bash');
		await highlightCode(code, source, 'bash');
		for (const span of code.querySelectorAll<HTMLElement>('span.tk')) {
			for (const name of ['--shiki-light', '--shiki-dark']) {
				const value = span.style.getPropertyValue(name);
				if (value) expect(value).toMatch(/^#[0-9a-f]{3,8}$/i);
			}
		}
	});

	it('leaves an unknown language, and code that is too long, alone', async () => {
		const plain = block('some code', 'cobol');
		await highlightCode(plain.code, 'some code', 'cobol');
		expect(plain.code.querySelector('span')).toBeNull();

		const huge = 'x = 1\n'.repeat(5000);
		const long = block(huge, 'python');
		await highlightCode(long.code, huge, 'python');
		expect(long.code.querySelector('span')).toBeNull();

		const many = 'x\n'.repeat(700);
		const lines = block(many, 'python');
		await highlightCode(lines.code, many, 'python');
		expect(lines.code.querySelector('span')).toBeNull();
	});

	it('does nothing if the card was replaced while the highlighter loaded', async () => {
		const { pre, code } = block('echo hi', 'bash');
		const pending = highlightCode(code, 'echo hi', 'bash');
		pre.remove();
		await pending;
		expect(code.querySelector('span')).toBeNull();
	});
});

describe('enhanceCodeBlocks', () => {
	it('highlights fences with a known language and leaves the rest alone', async () => {
		const root = document.createElement('div');
		root.innerHTML =
			'<pre><code class="language-python">print(1)\n</code></pre>' +
			'<pre><code class="language-cobol">DISPLAY 1</code></pre>' +
			'<pre><code>no language</code></pre>' +
			'<p>text with <code>inline</code> code</p>';
		document.body.append(root);
		const stop = enhanceCodeBlocks(root);
		await expect
			.poll(() => root.querySelector('code.language-python')?.classList.contains('shiki'))
			.toBe(true);
		expect(root.querySelector('code.language-cobol')?.querySelector('span')).toBeNull();
		expect(root.querySelectorAll('pre')).toHaveLength(3);
		expect(root.querySelector('p code')?.querySelector('span')).toBeNull();
		stop();
	});

	it('treats a mermaid fence as a diagram whatever its case', () => {
		const root = document.createElement('div');
		root.innerHTML = '<pre><code class="language-Mermaid">flowchart LR\n A--&gt;B</code></pre>';
		document.body.append(root);
		const stop = enhanceCodeBlocks(root);
		expect(root.querySelector('figure.diagram')).not.toBeNull();
		expect(root.querySelector('pre > code')).toBeNull();
		stop();
	});

	it('shows the source with a note when a diagram cannot be drawn', async () => {
		// jsdom cannot measure text, so Mermaid fails here. That is the failure path.
		const source = 'flowchart LR\n  A[Start] --> B[End]';
		const root = document.createElement('div');
		root.innerHTML = `<pre><code class="language-mermaid">${source}\n</code></pre>`;
		document.body.append(root);
		const stop = enhanceCodeBlocks(root);
		expect(root.querySelector('figure.diagram')).not.toBeNull();
		await expect
			.poll(() => root.querySelector('.diagram-failed'), { timeout: 15000 })
			.not.toBeNull();
		expect(root.querySelector('.md__badge')?.textContent).toBe(
			'This diagram could not be drawn. Showing its source.'
		);
		expect(root.querySelector('.diagram-failed pre')?.textContent).toBe(source);
		stop();
	}, 20000);

	it('does nothing to the page after it is stopped', async () => {
		const source = 'flowchart LR\n  A --> B';
		const root = document.createElement('div');
		root.innerHTML = `<pre><code class="language-mermaid">${source}</code></pre>`;
		document.body.append(root);
		enhanceCodeBlocks(root)();
		await new Promise((resolve) => setTimeout(resolve, 3000));
		expect(root.querySelector('.diagram-failed')).toBeNull();
		expect(root.querySelector('img')).toBeNull();
	}, 10000);
});

describe('currentScheme', () => {
	it('follows a forced theme', () => {
		document.documentElement.setAttribute('data-theme', 'dark');
		expect(currentScheme()).toBe('dark');
		document.documentElement.setAttribute('data-theme', 'light');
		expect(currentScheme()).toBe('light');
		document.documentElement.removeAttribute('data-theme');
	});
});
