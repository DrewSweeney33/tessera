import DOMPurify from 'dompurify';
import { Marked } from 'marked';

// Card text is Markdown written by an LLM, so it is untrusted input to the browser (ADR-005).
// Two layers: marked is configured so raw HTML never becomes markup, then DOMPurify sanitizes
// whatever is left. This module is browser-only: DOMPurify needs a real DOM.

// Links may point to http(s), mail, an anchor, or a relative path. Nothing else, so no
// javascript:, data:, or vbscript: URLs, and no protocol-relative //host links.
const SAFE_URL = /^(?:https?:|mailto:|#|\?|\.{1,2}\/|\/(?!\/))/i;

function escapeHtml(text: string): string {
	return text
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#39;');
}

const marked = new Marked({
	gfm: true,
	renderer: {
		// Raw HTML in the source is shown as text, never parsed.
		html({ text }) {
			return escapeHtml(text);
		},
		// No images in v1. The alt text is kept so nothing silently disappears.
		image({ text }) {
			return escapeHtml(text);
		},
		link({ href, title, tokens }) {
			const label = this.parser.parseInline(tokens);
			if (!SAFE_URL.test(href.trim())) return label;
			const titleAttribute = title ? ` title="${escapeHtml(title)}"` : '';
			return `<a href="${escapeHtml(href.trim())}"${titleAttribute}>${label}</a>`;
		}
	}
});

const FORBIDDEN_TAGS = [
	'style',
	'form',
	'input',
	'button',
	'textarea',
	'select',
	'option',
	'iframe',
	'frame',
	'frameset',
	'object',
	'embed',
	'img',
	'picture',
	'source',
	'video',
	'audio',
	'svg',
	'math',
	'link',
	'meta',
	'base',
	'script',
	'template',
	'dialog'
];

// id and name exist only to enable DOM clobbering, and card text never needs them.
const FORBIDDEN_ATTRIBUTES = [
	'style',
	'srcset',
	'srcdoc',
	'formaction',
	'action',
	'autofocus',
	'id',
	'name'
];

// External links open in a new tab and never leak the opener or the referrer.
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
	if (node instanceof HTMLAnchorElement && node.hasAttribute('href')) {
		node.setAttribute('rel', 'noopener noreferrer');
		node.setAttribute('target', '_blank');
	}
});

// Exported so the second layer can be tested on its own with raw HTML that never passes marked.
export function sanitizeHtml(html: string): string {
	return DOMPurify.sanitize(html, {
		USE_PROFILES: { html: true },
		FORBID_TAGS: FORBIDDEN_TAGS,
		FORBID_ATTR: FORBIDDEN_ATTRIBUTES,
		ALLOW_DATA_ATTR: false,
		ALLOWED_URI_REGEXP: SAFE_URL
	});
}

// Renders Markdown to sanitized HTML. May throw on pathological input, so callers fall back to
// showing the raw text (the card must stay gradable).
export function renderMarkdown(source: string): string {
	return sanitizeHtml(marked.parse(source, { async: false }));
}

// The same, for a single line of text with no paragraph wrapper.
export function renderInlineMarkdown(source: string): string {
	return sanitizeHtml(marked.parseInline(source, { async: false }));
}
