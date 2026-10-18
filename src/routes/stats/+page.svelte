<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import type { DecksResponse, StatsDto } from '#lib/core/api-types.ts';
	import { api, failureMessage } from '#lib/ui/api.ts';
	import BarChart, { type Bar } from '#lib/ui/BarChart.svelte';
	import { formatDuration, formatPercent } from '#lib/ui/format.ts';
	import Heatmap from '#lib/ui/Heatmap.svelte';

	// Statistics (ADR-017): how studying is going for every deck, one folder, or one deck. Only study is counted;
	// practice answers are shown on their own line. The scope is in the address (?folder=<id> or ?deck=<id>) and the
	// last choice is remembered in this browser.

	type View =
		{ kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; stats: StatsDto };

	const STORAGE_KEY = 'tessera.stats.scope';

	let view = $state<View>({ kind: 'loading' });
	let choices = $state<DecksResponse | undefined>();

	// The scope as one string: "" for every deck, "folder:3", or "deck:ccna-01".
	function readScope(): string {
		const folder = page.url.searchParams.get('folder');
		const deck = page.url.searchParams.get('deck');
		if (folder !== null && /^[1-9][0-9]{0,8}$/.test(folder)) return `folder:${folder}`;
		if (deck !== null && /^[a-z0-9][a-z0-9-]{0,63}$/.test(deck)) return `deck:${deck}`;
		return '';
	}

	function remembered(): string {
		try {
			const value = localStorage.getItem(STORAGE_KEY) ?? '';
			return /^(folder:[1-9][0-9]{0,8}|deck:[a-z0-9][a-z0-9-]{0,63})$/.test(value) ? value : '';
		} catch {
			return '';
		}
	}

	let scope = $state('');

	function parts(value: string): { deckId?: string; folderId?: number } {
		if (value.startsWith('folder:')) return { folderId: Number(value.slice(7)) };
		if (value.startsWith('deck:')) return { deckId: value.slice(5) };
		return {};
	}

	// Each request gets a number. A slow answer to an earlier choice (or to the first load) must not replace the
	// numbers of the scope that was picked after it.
	let latest = 0;

	async function load() {
		const mine = ++latest;
		view = { kind: 'loading' };
		try {
			const stats = await api.stats(parts(scope));
			if (mine !== latest) return;
			view = { kind: 'ready', stats };
		} catch (error) {
			if (mine !== latest) return;
			// A folder or deck that is gone: fall back to every deck instead of showing an error for a stale choice.
			if (scope !== '' && error instanceof Error && 'status' in error && error.status === 404) {
				await choose('');
				return;
			}
			view = {
				kind: 'error',
				message: failureMessage(error, 'Something went wrong loading the statistics.')
			};
		}
	}

	async function choose(value: string) {
		scope = value;
		try {
			localStorage.setItem(STORAGE_KEY, value);
		} catch {
			// Not remembered: the choice still works for this visit.
		}
		// Put the choice in the address without adding a history entry, so it can be shared or bookmarked.
		const target = new URL(resolve('/stats'), page.url.href);
		if (value !== '')
			target.searchParams.set(
				value.startsWith('folder:') ? 'folder' : 'deck',
				value.slice(value.indexOf(':') + 1)
			);
		// The address is built from resolve() above, which the rule cannot see through a URL object.
		// eslint-disable-next-line svelte/no-navigation-without-resolve
		await goto(target, { replaceState: true });
		await load();
	}

	onMount(async () => {
		scope = readScope() || remembered();
		try {
			choices = await api.decks();
		} catch {
			choices = undefined;
		}
		await load();
	});

	function dayLabel(day: string): string {
		const [year, month, date] = day.split('-').map(Number) as [number, number, number];
		return new Date(Date.UTC(year, month - 1, date)).toLocaleDateString(undefined, {
			month: 'short',
			day: 'numeric',
			timeZone: 'UTC'
		});
	}

	const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

	const reviewBars = $derived<Bar[]>(
		view.kind === 'ready'
			? view.stats.days.map((entry) => ({
					label: dayLabel(entry.day),
					value: entry.reviews,
					title: `${dayLabel(entry.day)}: ${plural(entry.reviews, 'review', 'reviews')}`
				}))
			: []
	);

	const forecastBars = $derived<Bar[]>(
		view.kind === 'ready'
			? view.stats.forecast.days.map((entry) => ({
					label: dayLabel(entry.day),
					value: entry.due,
					title: `${dayLabel(entry.day)}: ${plural(entry.due, 'item', 'items')} due`
				}))
			: []
	);

	const everStudied = $derived(
		view.kind === 'ready' &&
			(view.stats.reviews30Days > 0 ||
				view.stats.heatmap.some((week) => week.some((cell) => (cell?.reviews ?? 0) > 0)))
	);
</script>

<svelte:head>
	<title>Statistics · Tessera</title>
</svelte:head>

<div class="page stats">
	<header class="head">
		<h1>Statistics</h1>
		<div class="picker">
			<label for="scope">Show</label>
			<select
				id="scope"
				class="field"
				value={scope}
				onchange={(event) => void choose(event.currentTarget.value)}
			>
				<option value="">All decks</option>
				{#if choices && choices.folders.length > 0}
					<optgroup label="Folders">
						{#each choices.folders as folder (folder.id)}
							<option value="folder:{folder.id}">{folder.name}</option>
						{/each}
					</optgroup>
				{/if}
				{#if choices && choices.decks.length > 0}
					<optgroup label="Decks">
						{#each choices.decks as deck (deck.id)}
							<option value="deck:{deck.id}">{deck.title}</option>
						{/each}
					</optgroup>
				{/if}
			</select>
		</div>
	</header>

	{#if view.kind === 'loading'}
		<p class="muted" role="status">Loading statistics…</p>
	{:else if view.kind === 'error'}
		<div class="callout callout--error" role="alert">
			<p>{view.message}</p>
			<p class="retry"><button type="button" class="btn" onclick={load}>Try again</button></p>
		</div>
	{:else}
		{@const s = view.stats}
		<p class="muted summary">
			<strong>{s.scope.label}</strong>:
			{plural(s.cardCount, 'card', 'cards')} in {plural(s.deckCount, 'deck', 'decks')}. Items: {s
				.items.new} new, {s.items.learning} learning, {s.items.review} in review{#if s.items.suspended > 0},
				{s.items.suspended} suspended{/if}.
		</p>

		{#if !everStudied && s.cardCount === 0}
			<p class="callout">
				There is nothing here yet. <a href={resolve('/import')}>Import a deck</a> and study it, and the
				numbers appear here.
			</p>
		{:else if !everStudied}
			<p class="callout">
				No reviews yet for {s.scope.label}. The numbers appear after your first study session.
			</p>
		{/if}

		<dl class="tiles">
			<div class="tile">
				<dt>Reviews today</dt>
				<dd>{s.reviewsToday}</dd>
				<dd class="tile__note">{formatDuration(s.timeTodayMs)}</dd>
			</div>
			<div class="tile">
				<dt>Last 7 days</dt>
				<dd>{s.reviews7Days}</dd>
				<dd class="tile__note">{formatDuration(s.time7DaysMs)}</dd>
			</div>
			<div class="tile">
				<dt>Last 30 days</dt>
				<dd>{s.reviews30Days}</dd>
				<dd class="tile__note">reviews</dd>
			</div>
			<div class="tile">
				<dt>Recalled, 30 days</dt>
				<dd>{formatPercent(s.retention30Days)}</dd>
				<dd class="tile__note">7 days: {formatPercent(s.retention7Days)}</dd>
			</div>
			<div class="tile">
				<dt>Streak</dt>
				<dd>{s.streakDays}</dd>
				<dd class="tile__note">{s.streakDays === 1 ? 'day' : 'days'} in a row</dd>
			</div>
			<div class="tile">
				<dt>Open leeches</dt>
				<dd>{s.openLeeches}</dd>
				<dd class="tile__note">
					<a href={resolve('/leeches')}>cards you keep missing</a>
				</dd>
			</div>
		</dl>

		<p class="practiced">
			{#if s.practicedToday.answers > 0}
				Practiced today: <strong>{plural(s.practicedToday.items, 'card', 'cards')}</strong> in
				{plural(s.practicedToday.answers, 'answer', 'answers')} ({formatDuration(
					s.practicedToday.timeMs
				)}). Practice is not counted in the numbers above.
			{:else}
				No practice today. Practice answers are kept apart and never counted in these numbers.
			{/if}
		</p>

		<section class="block" aria-labelledby="h-days">
			<h2 id="h-days">Reviews, last 14 days</h2>
			<BarChart
				bars={reviewBars}
				caption="Reviews per study day, last 14 days"
				valueHeading="Reviews"
				first={dayLabel(s.days[0]!.day)}
				last="Today"
			/>
		</section>

		<section class="block" aria-labelledby="h-forecast">
			<h2 id="h-forecast">Coming due, next 30 days</h2>
			<p class="muted note">
				Review and relearning items by the study day they fall due.
				{#if s.forecast.overdue > 0}
					<strong>{plural(s.forecast.overdue, 'review item is', 'review items are')}</strong> already
					past due.
				{/if}
			</p>
			<BarChart
				bars={forecastBars}
				caption="Items due per study day, next 30 days"
				valueHeading="Items due"
				first="Today"
				last={dayLabel(s.forecast.days[s.forecast.days.length - 1]!.day)}
				tone="new"
			/>
		</section>

		<section class="block" aria-labelledby="h-heat">
			<h2 id="h-heat">The last 26 weeks</h2>
			<Heatmap weeks={s.heatmap} caption="Reviews per study day, last 26 weeks" />
		</section>

		<section class="block" aria-labelledby="h-tags">
			<h2 id="h-tags">Recall by tag</h2>
			{#if s.tagRetention.length === 0}
				<p class="muted">
					Tags appear here once a tag has at least 5 reviews of cards you had already learned in the
					last 90 days.
				</p>
			{:else}
				<p class="muted note">
					Share of reviews of learned cards graded Hard, Good, or Easy, over 90 days. Lowest first.
				</p>
				<ul class="tags">
					{#each s.tagRetention as tag (tag.tag)}
						<li>
							<span class="badge">{tag.tag}</span>
							<span class="meter" role="img" aria-label="{formatPercent(tag.retention)} recalled">
								<span class="meter__fill" style:width="{Math.round(tag.retention * 100)}%"></span>
							</span>
							<span class="tags__text"
								>{formatPercent(tag.retention)} in {plural(tag.reviews, 'review', 'reviews')}</span
							>
						</li>
					{/each}
				</ul>
			{/if}
		</section>
	{/if}
</div>

<style>
	.stats {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--space-5);
		align-content: start;
	}

	.head {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		justify-content: space-between;
		gap: var(--space-4);
	}

	.head h1 {
		margin: 0;
	}

	.picker {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		flex: 0 1 16rem;
		gap: var(--space-1);
		min-width: 0;
	}

	.picker label {
		color: var(--color-muted);
		font-size: var(--text-sm);
	}

	.summary,
	.practiced,
	.note {
		margin: 0;
	}

	.note {
		margin-block-end: var(--space-2);
		font-size: var(--text-sm);
	}

	.tiles {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 9.5rem), 1fr));
		gap: var(--space-3);
		margin: 0;
	}

	.tile {
		min-width: 0;
		padding: var(--space-3) var(--space-4);
		border-radius: var(--radius);
		background: var(--color-sunken);
	}

	.tile dt {
		color: var(--color-muted);
		font-size: var(--text-sm);
	}

	.tile dd {
		margin: 0;
		font-family: var(--font-display);
		font-size: var(--text-lg);
		font-weight: 600;
		line-height: 1.2;
	}

	.tile .tile__note {
		color: var(--color-muted);
		font-family: var(--font-body);
		font-size: var(--text-sm);
		font-weight: 400;
	}

	.block {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--space-2);
		padding: var(--space-5);
		border: 1px solid var(--color-rule);
		border-radius: var(--radius-lg);
		background: var(--color-surface);
	}

	.block h2 {
		margin: 0;
		font-size: var(--text-lg);
	}

	.tags {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--space-2);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.tags li {
		display: grid;
		grid-template-columns: minmax(6rem, 10rem) minmax(4rem, 1fr);
		align-items: center;
		gap: var(--space-1) var(--space-3);
	}

	.tags__text {
		grid-column: 1 / -1;
		color: var(--color-muted);
		font-size: var(--text-sm);
	}

	@media (min-width: 40rem) {
		.tags li {
			grid-template-columns: minmax(6rem, 10rem) minmax(6rem, 1fr) 11rem;
		}

		.tags__text {
			grid-column: auto;
		}
	}

	.meter {
		display: block;
		height: 0.625rem;
		overflow: hidden;
		border-radius: 999px;
		background: var(--color-sunken);
	}

	.meter__fill {
		display: block;
		height: 100%;
		border-radius: 999px;
		background: var(--color-review);
	}

	.retry {
		margin-block-start: var(--space-3);
	}
</style>
