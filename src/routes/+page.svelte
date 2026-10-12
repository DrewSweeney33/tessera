<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import type { DecksResponse, QueueCounts } from '#lib/core/api-types.ts';
	import { ApiError, api } from '#lib/ui/api.ts';
	import Icon from '#lib/ui/Icon.svelte';
	import { shell } from '#lib/ui/shell.svelte.ts';

	type View =
		| { kind: 'loading' }
		| { kind: 'error'; message: string }
		| { kind: 'ready'; data: DecksResponse };

	let view = $state<View>({ kind: 'loading' });

	async function load() {
		view = { kind: 'loading' };
		try {
			const data = await api.decks();
			shell.openLeeches = data.openLeeches;
			view = { kind: 'ready', data };
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

	// The share of a bar each queue takes, as percentages. An empty queue takes none.
	function share(counts: QueueCounts) {
		const all = available(counts);
		const pct = (n: number) => (all === 0 ? 0 : (n / all) * 100);
		return { new: pct(counts.new), learning: pct(counts.learning), review: pct(counts.review) };
	}
</script>

<svelte:head>
	<title>Decks · Tessera</title>
</svelte:head>

<div class="page">
	{#if view.kind === 'ready' && view.data.decks.length > 0}
		{@const totals = view.data.totals}
		{@const due = available(totals)}
		{@const bars = share(totals)}
		<header class="head">
			<div class="page-head">
				<p class="eyebrow">Your library</p>
				<h1>Decks</h1>
			</div>
			<a class="btn" href={resolve('/decks/new')}><Icon name="plus" /> New deck</a>
		</header>

		<section class="today" class:today--clear={due === 0} aria-label="Today">
			<svg class="today__motif" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
				<rect x="2" y="2" width="20" height="20" rx="5" />
				<rect x="26" y="2" width="20" height="20" rx="5" />
				<rect x="2" y="26" width="20" height="20" rx="5" />
				<rect x="26" y="26" width="20" height="20" rx="5" class="today__motif-line" />
			</svg>
			<div class="today__main">
				<p class="today__label">{due === 0 ? 'All caught up' : 'Due today'}</p>
				<p class="today__number" aria-hidden="true">{due === 0 ? '0' : due}</p>
				<p class="today__summary" class:sr-only={due > 0} aria-live="polite">
					{#if due === 0}
						Nothing to study right now.
					{:else}
						<strong>{due}</strong> to study today:
						{totals.new} new, {totals.learning} learning, {totals.review} to review.
					{/if}
				</p>
			</div>
			<div class="today__side">
				{#if due > 0}
					<div class="today__bar" aria-hidden="true">
						<span class="seg seg--new" style:width="{bars.new}%"></span>
						<span class="seg seg--learning" style:width="{bars.learning}%"></span>
						<span class="seg seg--review" style:width="{bars.review}%"></span>
					</div>
					<ul class="today__legend" aria-hidden="true">
						<li><span class="dot dot--new"></span>New {totals.new}</li>
						<li><span class="dot dot--learning"></span>Learning {totals.learning}</li>
						<li><span class="dot dot--review"></span>Review {totals.review}</li>
					</ul>
					<a class="btn btn--light btn--lg" href={resolve('/study/[[deckId]]', {})}>
						<Icon name="play" /> Study all decks
					</a>
				{/if}
			</div>
		</section>

		<ul class="ledger decks">
			{#each view.data.decks as deck (deck.id)}
				{@const n = available(deck.counts)}
				{@const bar = share(deck.counts)}
				<li class="row" class:row--due={n > 0}>
					<div class="row__main">
						<h2 class="row__title">{deck.title}</h2>
						<p class="muted row__meta">
							{deck.cardCount}
							{deck.cardCount === 1 ? 'card' : 'cards'}{#if deck.tags.length > 0}<span
									class="row__sep"
									aria-hidden="true">·</span
								>{deck.tags.join(', ')}{/if}
						</p>
						{#if deck.description}
							<p class="row__description">{deck.description}</p>
						{/if}
					</div>

					<dl class="counts">
						<div class="count count--new">
							<dt>New</dt>
							<dd>{deck.counts.new}</dd>
						</div>
						<div class="count count--learning">
							<dt>Learning</dt>
							<dd>{deck.counts.learning}</dd>
						</div>
						<div class="count count--review">
							<dt>Review</dt>
							<dd>{deck.counts.review}</dd>
						</div>
					</dl>

					<div class="row__bar" aria-hidden="true">
						<span class="seg seg--new" style:width="{bar.new}%"></span>
						<span class="seg seg--learning" style:width="{bar.learning}%"></span>
						<span class="seg seg--review" style:width="{bar.review}%"></span>
					</div>

					<div class="row__action">
						{#if n > 0}
							<a class="btn btn--primary" href={resolve('/study/[[deckId]]', { deckId: deck.id })}>
								<Icon name="play" /> Study
							</a>
						{:else if deck.cardCount === 0}
							<span class="state muted">No cards yet</span>
						{:else}
							<span class="state state--done"><Icon name="check" /> Done for now</span>
						{/if}
						<a
							class="btn btn--quiet"
							href={resolve('/decks/[id]/edit', { id: deck.id })}
							aria-label="Edit {deck.title}"
						>
							<Icon name="pencil" /> Edit
						</a>
					</div>
				</li>
			{/each}
		</ul>
	{:else if view.kind === 'ready'}
		<header class="head">
			<div class="page-head">
				<p class="eyebrow">Your library</p>
				<h1>Decks</h1>
			</div>
		</header>
		<section class="empty">
			<svg class="empty__motif" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
				<rect x="2" y="2" width="20" height="20" rx="5" />
				<rect x="26" y="2" width="20" height="20" rx="5" class="empty__accent" />
				<rect x="2" y="26" width="20" height="20" rx="5" />
				<rect x="26" y="26" width="20" height="20" rx="5" class="empty__line" />
			</svg>
			<h2>No decks yet</h2>
			<p>
				Ask Claude to write a deck in the Tessera format, then import it here. The format is
				described by a <a href={resolve('/api/schema')}>JSON Schema</a> you can give to Claude.
			</p>
			<p class="empty__actions">
				<a class="btn btn--primary" href={resolve('/import')}>
					<Icon name="import" /> Import a deck
				</a>
				<a class="btn" href={resolve('/decks/new')}><Icon name="plus" /> New deck</a>
			</p>
		</section>
	{:else if view.kind === 'error'}
		<header class="head">
			<div class="page-head">
				<p class="eyebrow">Your library</p>
				<h1>Decks</h1>
			</div>
		</header>
		<div class="callout callout--error" role="alert">
			<p>{view.message}</p>
			<p class="retry"><button type="button" class="btn" onclick={load}>Try again</button></p>
		</div>
	{:else}
		<header class="head">
			<div class="page-head">
				<p class="eyebrow">Your library</p>
				<h1>Decks</h1>
			</div>
		</header>
		<p class="sr-only" role="status">Loading decks…</p>
		<div class="skeletons" aria-hidden="true">
			<div class="skeleton skeleton--hero"></div>
			<div class="skeleton"></div>
			<div class="skeleton"></div>
			<div class="skeleton"></div>
		</div>
	{/if}
</div>

<style>
	.head {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: var(--space-4);
		margin-block-end: var(--space-5);
	}

	/* Today: one calm card that says what is waiting. It is the only gradient in the app. */
	.today {
		position: relative;
		display: grid;
		gap: var(--space-5);
		margin-block-end: var(--space-6);
		padding: var(--space-5);
		overflow: hidden;
		border-radius: var(--radius-xl);
		background: linear-gradient(135deg, var(--color-accent-deep), var(--color-accent));
		color: var(--color-accent-ink);
		box-shadow:
			var(--shadow-3),
			0 24px 48px -24px color-mix(in oklch, var(--color-accent) 60%, transparent);
	}

	.today--clear {
		background: linear-gradient(135deg, var(--color-accent-soft), var(--color-surface));
		color: var(--color-ink);
		border: 1px solid var(--color-rule);
	}

	.today__motif {
		position: absolute;
		inset-block-start: -1rem;
		inset-inline-end: -1rem;
		width: 11rem;
		height: 11rem;
		fill: currentColor;
		opacity: 0.12;
		transform: rotate(8deg);
		pointer-events: none;
	}

	.today__motif-line {
		fill: none;
		stroke: currentColor;
		stroke-width: 2.5;
	}

	.today--clear .today__motif {
		color: var(--color-accent);
		opacity: 0.2;
	}

	.today__main,
	.today__side {
		position: relative;
		display: grid;
		gap: var(--space-3);
		align-content: end;
	}

	.today__label {
		margin: 0;
		font-size: var(--text-xs);
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		opacity: 0.9;
	}

	.today__number {
		margin: 0;
		font-family: var(--font-display);
		font-size: var(--text-hero);
		font-weight: 500;
		line-height: 0.95;
		letter-spacing: -0.03em;
	}

	.today__summary strong {
		font-weight: 700;
	}

	.today__bar,
	.row__bar {
		display: flex;
		height: 0.5rem;
		overflow: hidden;
		border-radius: 999px;
		background: oklch(100% 0 0 / 0.2);
	}

	.row__bar {
		background: var(--color-sunken);
	}

	.seg {
		display: block;
		height: 100%;
		transition: width var(--dur-slow) var(--ease-out);
	}

	/* On the green card the bar uses light tints so each queue stays apart from the background. */
	.today__bar .seg--new {
		background: var(--color-tint-new);
	}

	.today__bar .seg--learning {
		background: var(--color-tint-learning);
	}

	.today__bar .seg--review {
		background: var(--color-tint-review);
	}

	.row__bar .seg--new {
		background: var(--color-new);
	}

	.row__bar .seg--learning {
		background: var(--color-learning);
	}

	.row__bar .seg--review {
		background: var(--color-review);
	}

	.today__legend {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1) var(--space-4);
		margin: 0;
		padding: 0;
		list-style: none;
		font-size: var(--text-sm);
	}

	.dot {
		display: inline-block;
		width: 0.55rem;
		height: 0.55rem;
		margin-inline-end: 0.4em;
		border-radius: 2px;
	}

	.dot--new {
		background: var(--color-tint-new);
	}

	.dot--learning {
		background: var(--color-tint-learning);
	}

	.dot--review {
		background: var(--color-tint-review);
	}

	/* A light button for use on the green card. */
	.btn--light {
		border-color: transparent;
		background: var(--color-button-light);
		color: var(--color-button-light-ink);
		box-shadow: 0 8px 20px -8px var(--shadow-color);
		font-weight: 600;
	}

	.btn--light:hover {
		border-color: transparent;
		background: var(--color-raised);
		color: var(--color-button-light-ink);
	}

	.btn--lg {
		min-height: 3.25rem;
		padding-inline: var(--space-5);
		font-size: 1.0625rem;
	}

	/* The decks: tiles on a grid. A tile is one deck, with what is waiting and how to start. */
	.decks {
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 21rem), 1fr));
		gap: var(--space-4);
	}

	.decks > .row {
		display: grid;
		grid-template-rows: auto auto auto auto;
		align-content: start;
		gap: var(--space-4);
		padding: var(--space-5);
	}

	.decks > .row:hover {
		border-color: var(--color-rule-strong);
		box-shadow: var(--shadow-2);
	}

	.row__main {
		min-width: 0;
	}

	.row__title {
		font-size: var(--text-md);
	}

	.row__sep {
		margin-inline: 0.5ch;
	}

	.row__meta {
		margin-block-start: var(--space-1);
		font-size: var(--text-sm);
		overflow-wrap: anywhere;
	}

	.row__description {
		margin-block-start: var(--space-2);
		color: var(--color-muted);
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	.counts {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: var(--space-3);
		margin: 0;
	}

	.count {
		min-width: 0;
		padding-block-start: var(--space-2);
		border-block-start: 3px solid var(--color-rule);
	}

	.count--new {
		border-block-start-color: var(--color-new);
	}

	.count--learning {
		border-block-start-color: var(--color-learning);
	}

	.count--review {
		border-block-start-color: var(--color-review);
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
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		align-items: center;
	}

	.row__action .btn--primary {
		flex: 1 1 8rem;
	}

	.row__action .state {
		flex: 1 1 8rem;
	}

	.state {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		min-height: var(--hit);
	}

	.state--done {
		color: var(--color-accent);
		font-weight: 500;
	}

	.empty {
		display: grid;
		justify-items: start;
		gap: var(--space-4);
		max-width: 38rem;
		padding: var(--space-6);
		border: 1px solid var(--color-rule);
		border-radius: var(--radius-xl);
		background: var(--color-surface);
		box-shadow: var(--shadow-2);
	}

	.empty__motif {
		width: 4.5rem;
		height: 4.5rem;
		fill: var(--color-rule-strong);
	}

	.empty__accent {
		fill: var(--color-accent);
	}

	.empty__line {
		fill: none;
		stroke: var(--color-ink);
		stroke-width: 2.5;
	}

	.empty__actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
	}

	.retry {
		margin-block-start: var(--space-3);
	}

	.skeletons {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 21rem), 1fr));
		gap: var(--space-4);
	}

	.skeleton {
		height: 12rem;
		border-radius: var(--radius-lg);
		background: linear-gradient(
			100deg,
			var(--color-sunken) 30%,
			var(--color-surface) 50%,
			var(--color-sunken) 70%
		);
		background-size: 200% 100%;
		animation: shimmer 1.4s linear infinite;
	}

	.skeleton--hero {
		grid-column: 1 / -1;
		height: 10rem;
		border-radius: var(--radius-xl);
	}

	@keyframes shimmer {
		to {
			background-position: -200% 0;
		}
	}

	@media (min-width: 48rem) {
		.today {
			grid-template-columns: minmax(0, 1fr) minmax(0, 22rem);
			align-items: end;
			padding: var(--space-6);
		}
	}
</style>
