// Hostile card text for the sanitization test (ADR-005). Every payload tries to set window.__pwned,
// open a dialog, or smuggle markup past the renderer. None may succeed. `visible` is text that must
// still show on the card, proving the payload was neutralized as text and not silently dropped.
export interface Payload {
	name: string;
	markdown: string;
	visible?: string;
}

const run = 'window.__pwned=1';

export const XSS_CORPUS: Payload[] = [
	{ name: 'script tag', markdown: `<script>${run}</script>`, visible: '<script>' },
	{ name: 'img onerror', markdown: `<img src=x onerror="${run}">`, visible: '<img' },
	{ name: 'svg onload', markdown: `<svg onload="${run}"></svg>`, visible: '<svg' },
	{ name: 'javascript link', markdown: `[click me](javascript:${run})`, visible: 'click me' },
	{ name: 'mixed case javascript link', markdown: `[mixed](JaVaScRiPt:${run})`, visible: 'mixed' },
	{
		name: 'entity encoded javascript link',
		markdown: `[encoded](&#106;avascript:${run})`,
		visible: 'encoded'
	},
	{
		name: 'data html link',
		markdown: `[data](data:text/html,<script>${run}</script>)`,
		visible: 'data'
	},
	{
		name: 'raw anchor with javascript',
		markdown: `<a href="javascript:${run}">raw anchor</a>`,
		visible: '<a href='
	},
	{
		name: 'iframe srcdoc',
		markdown: `<iframe srcdoc="<script>parent.${run}</script>"></iframe>`,
		visible: '<iframe'
	},
	{
		name: 'details ontoggle',
		markdown: `<details open ontoggle="${run}"><summary>x</summary></details>`,
		visible: '<details'
	},
	{
		name: 'form with javascript action',
		markdown: `<form action="javascript:${run}"><button>go</button></form>`,
		visible: '<form'
	},
	{
		name: 'mutation xss with math and style',
		markdown: `<math><mtext><table><mglyph><style><!--</style><img title="--&gt;&lt;img src=1 onerror=${run}&gt;">`,
		visible: '<math>'
	},
	{
		name: 'noscript breakout',
		markdown: `<noscript><p title="</noscript><img src=x onerror=${run}>">`,
		visible: '<noscript>'
	},
	{
		name: 'style import',
		markdown: `<style>@import 'https://evil.example/x.css';</style>`,
		visible: '<style>'
	},
	{
		name: 'image attribute breakout',
		markdown: `![alt text](x" onerror="${run})`,
		visible: 'alt text'
	},
	{ name: 'autofocus input', markdown: `<input autofocus onfocus="${run}">`, visible: '<input' },
	{
		name: 'video source onerror',
		markdown: `<video><source onerror="${run}"></video>`,
		visible: '<video>'
	},
	{
		name: 'nested tag trick',
		markdown: `<scr<script>ipt>${run}</scr</script>ipt>`,
		visible: 'ipt'
	},
	{ name: 'protocol relative link', markdown: `[proto](//evil.example/path)`, visible: 'proto' },
	{
		name: 'button formaction',
		markdown: `<button formaction="javascript:${run}">press</button>`,
		visible: '<button'
	}
];

// Chunks of at most 20 so each deck stays inside the default daily new card limit.
export function chunks<T>(items: T[], size = 15): T[][] {
	const out: T[][] = [];
	for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
	return out;
}
