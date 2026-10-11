<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import type { DecksResponse, QueueCounts } from '#lib/core/api-types.ts';
	import { ApiError, api } from '#lib/ui/api.ts';

	type View =
		| { kind: 'loading' }
		| { kind: 'error'; message: string }
		| { kind: 'ready'; data: DecksResponse };

	let view = $state<View>({ kind: 'loading' });

	async function load() {
		view = { kind: 'loading' };
		try {
			view = { kind: 'ready', data: await api.decks() };
		} catch (error) {
			view = {
				kind: 'error',
				message:
					error instanceof ApiError ? error.message : 'Something went wrong loading your decks.'
			};
		}
	}

	onMount(load);

	const available = (counts: QueueCounts) => counts.new + counts.learning + counts.review;
</script>

<svelte:head>
	<title>Decks · Tessera</title>
</svelte:head>

<div class="page">
	{#if view.kind === 'ready' && view.data.decks.length > 0}
		{@const totals = view.data.totals}
		<header class="head">
			<div>
				<h1>Decks</h1>
				<p class="summary muted" aria-live="polite">
					{#if available(totals) === 0}
						Nothing to study right now.
					{:else}
						<strong>{available(totals)}</strong> to study today:
						{totals.new} new, {totals.learning} learning, {totals.review} to review.
					{/if}
				</p>
			</div>
			{#if available(totals) > 0}
				<a class="btn btn--primary" href={resolve('/study/[[deckId]]', {})}>Study all decks</a>
			{/if}
		</header>

		<ul class="ledger">
			{#each view.data.decks as deck (deck.id)}
				<li class="row">
					<div class="row__main">
						<h2 class="row__title">{deck.title}</h2>
						<p class="muted row__meta">
							{deck.cardCount}
							{deck.cardCount === 1 ? 'card' : 'cards'}{#if deck.tags.length > 0}
								· {deck.tags.join(', ')}{/if}
						</p>
						{#if deck.description}
							<p class="row__description">{deck.description}</p>
						{/if}
					</div>

					<dl class="counts">
						<div>
							<dt>New</dt>
							<dd>{deck.counts.new}</dd>
						</div>
						<div>
							<dt>Learning</dt>
							<dd>{deck.counts.learning}</dd>
						</div>
						<div>
							<dt>Review</dt>
							<dd>{deck.counts.review}</dd>
						</div>
					</dl>

					<div class="row__action">
						{#if available(deck.counts) > 0}
							<a class="btn btn--primary" href={resolve('/study/[[deckId]]', { deckId: deck.id })}>
								Study
							</a>
						{:else}
							<span class="muted">Done for now</span>
						{/if}
					</div>
				</li>
			{/each}
		</ul>
	{:else if view.kind === 'ready'}
		<header class="head">
			<h1>Decks</h1>
		</header>
		<div class="callout empty">
			<h2>No decks yet</h2>
			<p>
				Ask Claude to write a deck in the Tessera format, then import it here. The format is
				described by a <a href={resolve('/api/schema')}>JSON Schema</a> you can give to Claude.
			</p>
			<p><a class="btn btn--primary" href={resolve('/import')}>Import a deck</a></p>
		</div>
	{:else if view.kind === 'error'}
		<header class="head">
			<h1>Decks</h1>
		</header>
		<div class="callout callout--error" role="alert">
			<p>{view.message}</p>
			<p><button type="button" class="btn" onclick={load}>Try again</button></p>
		</div>
	{:else}
		<header class="head">
			<h1>Decks</h1>
		</header>
		<p class="muted" role="status">Loading decks…</p>
	{/if}
</div>

<style>
	.head {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		justify-content: space-between;
		gap: var(--space-4);
		margin-block-end: var(--space-5);
	}

	.summary {
		margin-block-start: var(--space-2);
	}

	.summary strong {
		color: var(--color-ink);
	}

	.ledger {
		margin: 0;
		padding: 0;
		list-style: none;
		border-block-start: 1px solid var(--color-rule-strong);
	}

	.row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: var(--space-3) var(--space-5);
		align-items: center;
		padding-block: var(--space-4);
		border-block-end: 1px solid var(--color-rule);
	}

	.row__main {
		grid-column: 1 / -1;
		min-width: 0;
	}

	.row__title {
		font-size: var(--text-md);
	}

	.row__meta {
		margin-block-start: var(--space-1);
		font-size: var(--text-sm);
	}

	.row__description {
		margin-block-start: var(--space-2);
		max-width: var(--measure);
	}

	.counts {
		display: flex;
		gap: var(--space-5);
		margin: 0;
	}

	.counts div {
		min-width: 0;
	}

	.counts dt {
		color: var(--color-muted);
		font-size: var(--text-sm);
	}

	.counts dd {
		margin: 0;
		font-family: var(--font-display);
		font-size: var(--text-lg);
		font-weight: 600;
		line-height: 1.2;
	}

	.row__action {
		justify-self: end;
	}

	@media (min-width: 48rem) {
		.row {
			grid-template-columns: minmax(0, 1fr) auto auto;
		}

		.row__main {
			grid-column: auto;
		}

		.row__action {
			min-width: 7.5rem;
			text-align: end;
		}
	}

	.empty {
		max-width: 38rem;
	}

	.empty > * + * {
		margin-block-start: var(--space-3);
	}
</style>
