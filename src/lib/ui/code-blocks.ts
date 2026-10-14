import DOMPurify from 'dompurify';

// Code highlighting and diagrams inside rendered card text (M2-11, ADR-010). Both libraries are large, so
// they are loaded on first use only, by a card that has a code fence. They run in the browser, under the
// Content-Security-Policy with no relaxation: no eval, no WebAssembly, no inline script.
//
// Card text is untrusted. So:
//   - Highlighted code is built from DOM nodes with textContent. No HTML string is ever parsed, so code
//     such as "<script>" can only ever be text.
//   - A diagram is drawn by Mermaid in strict mode, sanitized again, and then shown as an image (a data
//     URI). An image cannot run script, load anything else, or change the page's styles, whatever the
//     diagram text says.
//   - Anything that fails, takes too long, or is too big is shown as plain source with a note.

const MAX_CODE_CHARS = 20_000;
const MAX_CODE_LINES = 600;
const MAX_DIAGRAM_CHARS = 8_000;
const DRAW_TIMEOUT_MS = 8_000;

// ---- Highlighting

// The languages that get colour, by the name Shiki uses. The documentation lists exactly these, and a test
// keeps the two in step.
const LANGUAGES: Record<string, () => Promise<unknown>> = {
	bash: () => import('shiki/langs/bash.mjs'),
	c: () => import('shiki/langs/c.mjs'),
	cpp: () => import('shiki/langs/cpp.mjs'),
	csharp: () => import('shiki/langs/csharp.mjs'),
	css: () => import('shiki/langs/css.mjs'),
	diff: () => import('shiki/langs/diff.mjs'),
	dockerfile: () => import('shiki/langs/dockerfile.mjs'),
	go: () => import('shiki/langs/go.mjs'),
	html: () => import('shiki/langs/html.mjs'),
	ini: () => import('shiki/langs/ini.mjs'),
	java: () => import('shiki/langs/java.mjs'),
	javascript: () => import('shiki/langs/javascript.mjs'),
	json: () => import('shiki/langs/json.mjs'),
	markdown: () => import('shiki/langs/markdown.mjs'),
	powershell: () => import('shiki/langs/powershell.mjs'),
	python: () => import('shiki/langs/python.mjs'),
	rust: () => import('shiki/langs/rust.mjs'),
	shellsession: () => import('shiki/langs/shellsession.mjs'),
	sql: () => import('shiki/langs/sql.mjs'),
	toml: () => import('shiki/langs/toml.mjs'),
	typescript: () => import('shiki/langs/typescript.mjs'),
	xml: () => import('shiki/langs/xml.mjs'),
	yaml: () => import('shiki/langs/yaml.mjs')
};

const ALIASES: Record<string, string> = {
	sh: 'bash',
	shell: 'bash',
	zsh: 'bash',
	shellscript: 'bash',
	console: 'shellsession',
	ps1: 'powershell',
	pwsh: 'powershell',
	js: 'javascript',
	mjs: 'javascript',
	ts: 'typescript',
	py: 'python',
	yml: 'yaml',
	'c++': 'cpp',
	cs: 'csharp',
	golang: 'go',
	rs: 'rust',
	htm: 'html',
	md: 'markdown',
	jsonc: 'json',
	docker: 'dockerfile',
	conf: 'ini'
};

// For the documentation tests: what the highlighter knows, and the short names it accepts.
export const HIGHLIGHT_LANGUAGES: readonly string[] = Object.keys(LANGUAGES);
export const LANGUAGE_ALIASES: Readonly<Record<string, string>> = ALIASES;

// The grammar name for a fence's language, or undefined when there is none to use.
export function languageFor(info: string): string | undefined {
	const name = info.toLowerCase();
	const resolved = Object.hasOwn(ALIASES, name) ? ALIASES[name]! : name;
	return Object.hasOwn(LANGUAGES, resolved) ? resolved : undefined;
}

// A theme pair with strong contrast on the card's code background, in both colour schemes.
const THEMES = { light: 'github-light-high-contrast', dark: 'github-dark-high-contrast' } as const;

// Colours that would be hard to read on the card's code background (checked by a unit test against every
// colour in both themes). The light theme's comment grey is a little faint (about 4.3 to 1). A few rare
// scopes (a carriage return, git status marks in a diff) are near white or near black because the theme
// gives them a background of their own, which is not painted here. They get the normal text colour.
// Keyed by theme, because a colour that is wrong in one theme can be fine in the other.
export const COLOR_REPLACEMENTS: Record<string, Record<string, string>> = {
	[THEMES.light]: { '#66707b': '#5c6570', '#ffffff': '#0e1116', '#e7ecf0': '#0e1116' },
	[THEMES.dark]: { '#272b33': '#f0f3f6' }
};

type Highlighter = import('shiki/core').HighlighterCore;
let highlighterPromise: Promise<Highlighter> | undefined;

function getHighlighter(): Promise<Highlighter> {
	highlighterPromise ??= (async () => {
		const [{ createHighlighterCore }, { createJavaScriptRegexEngine }] = await Promise.all([
			import('shiki/core'),
			import('shiki/engine/javascript')
		]);
		return createHighlighterCore({
			themes: [
				import('shiki/themes/github-light-high-contrast.mjs'),
				import('shiki/themes/github-dark-high-contrast.mjs')
			],
			langs: [],
			// The JavaScript engine needs no WebAssembly, so the policy does not need 'wasm-unsafe-eval'.
			engine: createJavaScriptRegexEngine()
		});
	})();
	// A failed load must be retried next time, not remembered.
	highlighterPromise.catch(() => (highlighterPromise = undefined));
	return highlighterPromise;
}

// A token colour is written into a style property, so only a plain hex colour is accepted.
export function isSafeColor(value: string | undefined): value is string {
	return value !== undefined && /^#[0-9a-f]{3,8}$/i.test(value);
}

// Replaces the contents of a <code> element with highlighted tokens. Throws if the language cannot load.
export async function highlightCode(
	code: HTMLElement,
	source: string,
	lang: string
): Promise<void> {
	const language = languageFor(lang);
	if (!language) return;
	if (source.length > MAX_CODE_CHARS || source.split('\n').length > MAX_CODE_LINES) return;

	const highlighter = await getHighlighter();
	await highlighter.loadLanguage(LANGUAGES[language]!() as Promise<never>);
	const lines = highlighter.codeToTokensWithThemes(source, {
		lang: language,
		themes: THEMES,
		colorReplacements: COLOR_REPLACEMENTS
	});

	const fragment = document.createDocumentFragment();
	lines.forEach((line, index) => {
		for (const token of line) {
			const span = document.createElement('span');
			span.textContent = token.content;
			const light = token.variants['light']?.color;
			const dark = token.variants['dark']?.color;
			if (isSafeColor(light)) span.style.setProperty('--shiki-light', light);
			if (isSafeColor(dark)) span.style.setProperty('--shiki-dark', dark);
			const fontStyle = token.variants['light']?.fontStyle ?? 0;
			if (fontStyle & 1) span.style.fontStyle = 'italic';
			if (fontStyle & 2) span.style.fontWeight = '700';
			span.className = 'tk';
			fragment.append(span);
		}
		if (index < lines.length - 1) fragment.append('\n');
	});
	// The card may have been replaced while the highlighter loaded.
	if (!code.isConnected) return;
	code.replaceChildren(fragment);
	code.classList.add('shiki');
}

// ---- Diagrams

export type Scheme = 'light' | 'dark';

export function currentScheme(): Scheme {
	const forced = document.documentElement.getAttribute('data-theme');
	if (forced === 'light' || forced === 'dark') return forced;
	// Without matchMedia (an old or minimal browser) the light scheme is the safe choice.
	if (typeof matchMedia !== 'function') return 'light';
	return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

// Calls back when the colour scheme changes, whether the person toggled the theme or the system changed.
function watchScheme(callback: () => void): () => void {
	const observer = new MutationObserver(callback);
	observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
	const query =
		typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : undefined;
	query?.addEventListener('change', callback);
	return () => {
		observer.disconnect();
		query?.removeEventListener('change', callback);
	};
}

// A viewBox is four numbers, and its first two (the origin) can be negative, as in a sequence diagram.
const SVG_SIZE = /^\s*(-?[\d.]+)[\s,]+(-?[\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*$/;

// Sanitizes the SVG that Mermaid drew and returns it as an image source. Exported to test on its own with
// hostile SVG that never passes through Mermaid. Throws if there is nothing drawable left.
export function svgToImageSource(svg: string): string {
	const body = DOMPurify.sanitize(svg, {
		USE_PROFILES: { svg: true, svgFilters: true },
		// Labels are plain SVG text. HTML inside a diagram has no place in an image.
		FORBID_TAGS: ['script', 'foreignObject', 'iframe', 'object', 'embed', 'a', 'image', 'use'],
		FORBID_ATTR: ['href', 'xlink:href', 'src'],
		// The diagram's own style rules are kept. They apply only inside the image.
		ADD_TAGS: ['style'],
		RETURN_DOM: true
	});
	const root = (body as Element).querySelector('svg');
	if (!root) throw new Error('no diagram');
	// Without a size an image has none of its own, so give it the diagram's.
	const box = SVG_SIZE.exec(root.getAttribute('viewBox') ?? '');
	if (!box) throw new Error('no size');
	root.setAttribute('width', String(Math.ceil(Number(box[3]))));
	root.setAttribute('height', String(Math.ceil(Number(box[4]))));
	root.removeAttribute('style');
	root.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
	return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(root))}`;
}

type Mermaid = (typeof import('mermaid'))['default'];
let mermaidPromise: Promise<Mermaid> | undefined;
let drawing: Promise<unknown> = Promise.resolve();
let counter = 0;

function getMermaid(): Promise<Mermaid> {
	mermaidPromise ??= import('mermaid').then((module) => module.default);
	mermaidPromise.catch(() => (mermaidPromise = undefined));
	return mermaidPromise;
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error('timed out')), ms);
		work.then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			(error: unknown) => {
				clearTimeout(timer);
				reject(error instanceof Error ? error : new Error(String(error)));
			}
		);
	});
}

// Draws a diagram and returns it as an image source. Drawing is one at a time: Mermaid keeps global state.
export function drawDiagram(source: string, scheme: Scheme): Promise<string> {
	if (source.length > MAX_DIAGRAM_CHARS) return Promise.reject(new Error('too large'));
	const job = drawing.then(async () => {
		const mermaid = await getMermaid();
		mermaid.initialize({
			startOnLoad: false,
			securityLevel: 'strict',
			theme: scheme === 'dark' ? 'dark' : 'neutral',
			htmlLabels: false,
			flowchart: { htmlLabels: false },
			maxTextSize: MAX_DIAGRAM_CHARS,
			maxEdges: 200,
			logLevel: 'fatal',
			suppressErrorRendering: true,
			fontFamily: 'system-ui, sans-serif'
		});
		const { svg } = await mermaid.render(`tessera-diagram-${++counter}`, source);
		return svgToImageSource(svg);
	});
	// A failed or slow drawing must not block the ones queued behind it.
	drawing = job.catch(() => undefined);
	return withTimeout(job, DRAW_TIMEOUT_MS);
}

function failureNote(message: string, source: string): HTMLElement {
	const box = document.createElement('div');
	box.className = 'md--failed diagram-failed';
	const note = document.createElement('p');
	note.className = 'md__badge';
	note.setAttribute('role', 'status');
	note.textContent = message;
	const pre = document.createElement('pre');
	pre.textContent = source;
	box.append(note, pre);
	return box;
}

function diagramFigure(source: string): {
	figure: HTMLElement;
	show: (src: string) => void;
	fail: () => void;
	status: HTMLElement;
} {
	const figure = document.createElement('figure');
	figure.className = 'diagram';
	const status = document.createElement('p');
	status.className = 'diagram__status muted';
	status.setAttribute('role', 'status');
	status.textContent = 'Drawing the diagram…';
	figure.append(status);

	const show = (src: string) => {
		const image = document.createElement('img');
		image.className = 'diagram__image';
		image.alt = 'Diagram. Its source is under “Diagram source”.';
		image.decoding = 'async';
		image.src = src;
		const details = document.createElement('details');
		details.className = 'diagram__source';
		const summary = document.createElement('summary');
		summary.textContent = 'Diagram source';
		const pre = document.createElement('pre');
		pre.textContent = source;
		details.append(summary, pre);
		figure.replaceChildren(image, details);
	};
	const fail = () =>
		figure.replaceChildren(
			failureNote('This diagram could not be drawn. Showing its source.', source)
		);
	return { figure, show, fail, status };
}

// ---- Entry point

// Finds the code blocks inside rendered card text and upgrades them. Returns a function that stops the work
// when the text is replaced or the card goes away.
export function enhanceCodeBlocks(root: HTMLElement): () => void {
	let active = true;
	const stops: (() => void)[] = [];

	for (const code of root.querySelectorAll<HTMLElement>('pre > code')) {
		const pre = code.parentElement;
		if (!pre) continue;
		const lang = /(?:^|\s)language-([^\s]+)/.exec(code.className)?.[1];
		if (!lang) continue;
		const source = (code.textContent ?? '').replace(/\n$/, '');

		if (lang.toLowerCase() === 'mermaid') {
			const { figure, show, fail } = diagramFigure(source);
			pre.replaceWith(figure);
			void drawDiagram(source, currentScheme()).then(
				(src) => active && show(src),
				(error: unknown) => {
					// Quiet, but there for anyone looking at why a diagram did not draw.
					console.debug('Diagram not drawn:', error instanceof Error ? error.message : error);
					if (active) fail();
				}
			);
			stops.push(
				watchScheme(() => {
					// Drawn again for the other colour scheme, quietly: the old image stays until the new one is ready.
					void drawDiagram(source, currentScheme()).then(
						(src) => {
							const image = figure.querySelector('img');
							if (active && image) image.src = src;
						},
						() => undefined
					);
				})
			);
			continue;
		}

		if (!languageFor(lang)) continue;
		// The plain code stays as it was. A highlighter that cannot load is not the card's problem.
		highlightCode(code, source, lang).catch(() => undefined);
	}

	return () => {
		active = false;
		for (const stop of stops) stop();
	};
}
