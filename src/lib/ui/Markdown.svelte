<script lang="ts">
	import {
		renderInlineMarkdown,
		renderInlineMarkdownWithoutLinks,
		renderMarkdown
	} from './markdown.ts';
	import { enhanceCodeBlocks } from './code-blocks.ts';

	// `links: false` is for text inside a button. It implies inline.
	let {
		source,
		inline = false,
		links = true
	}: { source: string; inline?: boolean; links?: boolean } = $props();

	let root = $state<HTMLElement>();

	function render(text: string): string {
		if (!links) return renderInlineMarkdownWithoutLinks(text);
		return inline ? renderInlineMarkdown(text) : renderMarkdown(text);
	}

	// If rendering fails, the raw text is shown so the card can still be read and graded.
	const rendered = $derived.by(() => {
		try {
			return { ok: true as const, html: render(source) };
		} catch {
			return { ok: false as const };
		}
	});

	// Code fences are highlighted and mermaid fences drawn after the text is on the page. The libraries load
	// only when a card has one. Text inside a button (links off) and inline text never has a block.
	$effect(() => {
		if (!root || !rendered.ok || inline || !links) return;
		return enhanceCodeBlocks(root);
	});
</script>

{#if rendered.ok}
	<!-- The only place {@html} is allowed. The string is sanitized by renderMarkdown (ADR-005). -->
	<div class="md" class:md--inline={inline || !links} bind:this={root}>{@html rendered.html}</div>
{:else}
	<div class="md md--failed">
		<p class="md__badge" role="status">This card could not be formatted. Showing the raw text.</p>
		<pre>{source}</pre>
	</div>
{/if}

<style>
	.md {
		overflow-wrap: anywhere;
	}

	.md :global(> * + *) {
		margin-block-start: 0.85em;
	}

	.md :global(h1),
	.md :global(h2),
	.md :global(h3),
	.md :global(h4) {
		font-size: 1.1em;
		font-weight: 600;
	}

	.md :global(ul),
	.md :global(ol) {
		margin: 0;
		padding-inline-start: 1.4em;
	}

	.md :global(li + li) {
		margin-block-start: 0.25em;
	}

	.md :global(a) {
		text-decoration-color: var(--color-accent);
	}

	.md :global(code) {
		padding: 0.1em 0.35em;
		border-radius: var(--radius-sm);
		background: var(--color-sunken);
	}

	.md :global(pre) {
		margin: 0;
		padding: var(--space-3) var(--space-4);
		overflow-x: auto;
		border: 1px solid var(--color-rule);
		border-radius: var(--radius);
		background: var(--color-sunken);
		font-size: 0.875rem;
		line-height: 1.5;
		tab-size: 4;
		/* Code is read character by character: -> and != must not turn into arrows and symbols. */
		font-variant-ligatures: none;
	}

	.md :global(pre code) {
		padding: 0;
		background: none;
	}

	/* Highlighted code: each token carries a colour for both schemes, picked by the active colour scheme. */
	.md :global(code.shiki .tk) {
		color: light-dark(var(--shiki-light, currentcolor), var(--shiki-dark, currentcolor));
	}

	.md :global(.diagram) {
		margin: 0;
		overflow-x: auto;
	}

	.md :global(.diagram__image) {
		display: block;
		max-width: 100%;
		height: auto;
		margin-inline: auto;
	}

	.md :global(.diagram__status) {
		font-family: var(--font-body);
		font-size: var(--text-sm);
	}

	.md :global(.diagram__source) {
		margin-block-start: var(--space-2);
		font-family: var(--font-body);
		font-size: var(--text-sm);
	}

	.md :global(.diagram__source summary) {
		display: inline-flex;
		align-items: center;
		min-height: var(--hit);
		color: var(--color-accent);
		cursor: pointer;
	}

	.md :global(.diagram__source pre) {
		font-family: var(--font-code);
	}

	/* Built in script, so the scoped rules above do not reach it. */
	.md :global(.md__badge) {
		color: var(--color-error);
		font-family: var(--font-body);
		font-size: var(--text-sm);
	}

	.md :global(.diagram-failed pre) {
		margin: var(--space-2) 0 0;
		white-space: pre-wrap;
		font-family: var(--font-code);
	}

	.md :global(blockquote) {
		margin: 0;
		padding-inline-start: var(--space-4);
		color: var(--color-muted);
	}

	.md :global(table) {
		display: block;
		max-width: 100%;
		overflow-x: auto;
		border-collapse: collapse;
		font-size: 0.9375em;
	}

	.md :global(th),
	.md :global(td) {
		padding: var(--space-2) var(--space-3);
		border: 1px solid var(--color-rule-strong);
		text-align: start;
	}

	.md :global(th) {
		background: var(--color-sunken);
		font-weight: 600;
	}

	.md :global(hr) {
		border: 0;
		border-block-start: 1px solid var(--color-rule);
	}

	.md--inline {
		display: inline;
	}

	.md__badge {
		color: var(--color-error);
		font-size: var(--text-sm);
	}

	.md--failed pre {
		margin: var(--space-2) 0 0;
		white-space: pre-wrap;
		font-family: var(--font-code);
	}
</style>
