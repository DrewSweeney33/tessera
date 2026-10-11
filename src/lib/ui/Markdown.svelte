<script lang="ts">
	import {
		renderInlineMarkdown,
		renderInlineMarkdownWithoutLinks,
		renderMarkdown
	} from './markdown.ts';

	// `links: false` is for text inside a button. It implies inline.
	let {
		source,
		inline = false,
		links = true
	}: { source: string; inline?: boolean; links?: boolean } = $props();

	// If rendering fails, the raw text is shown so the card can still be read and graded.
	const rendered = $derived.by(() => {
		try {
			return {
				ok: true as const,
				html: !links
					? renderInlineMarkdownWithoutLinks(source)
					: inline
						? renderInlineMarkdown(source)
						: renderMarkdown(source)
			};
		} catch {
			return { ok: false as const };
		}
	});
</script>

{#if rendered.ok}
	<!-- The only place {@html} is allowed. The string is sanitized by renderMarkdown (ADR-005). -->
	<div class="md" class:md--inline={inline || !links}>{@html rendered.html}</div>
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
	}

	.md :global(pre code) {
		padding: 0;
		background: none;
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
