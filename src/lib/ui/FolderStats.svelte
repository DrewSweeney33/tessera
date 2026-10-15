<script lang="ts">
	import { onMount } from 'svelte';
	import type { FolderStatsDto } from '#lib/core/api-types.ts';
	import { api, failureMessage } from '#lib/ui/api.ts';
	import { formatDuration, formatPercent } from '#lib/ui/format.ts';

	let { folderId, name }: { folderId: number; name: string } = $props();

	type View =
		| { kind: 'loading' }
		| { kind: 'error'; message: string }
		| { kind: 'ready'; stats: FolderStatsDto };

	let view = $state<View>({ kind: 'loading' });

	async function load() {
		view = { kind: 'loading' };
		try {
			view = { kind: 'ready', stats: await api.folderStats(folderId) };
		} catch (error) {
			view = {
				kind: 'error',
				message: failureMessage(error, 'Something went wrong loading the folder statistics.')
			};
		}
	}

	onMount(load);

	// The tallest day sets the height of the bars. A week with no reviews gets flat bars.
	const tallest = $derived(
		view.kind === 'ready' ? Math.max(1, ...view.stats.days.map((entry) => entry.reviews)) : 1
	);

	// "Oct 14" for a study day label such as "2026-10-14". The label is a calendar date, so no time zone applies.
	function dayLabel(day: string): string {
		const [year, month, date] = day.split('-').map(Number) as [number, number, number];
		return new Date(Date.UTC(year, month - 1, date)).toLocaleDateString(undefined, {
			month: 'short',
			day: 'numeric',
			timeZone: 'UTC'
		});
	}

	const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
</script>

<section class="stats" aria-label="Statistics for {name}">
	{#if view.kind === 'loading'}
		<p class="muted" role="status">Loading statistics…</p>
	{:else if view.kind === 'error'}
		<div class="callout callout--error" role="alert">
			<p>{view.message}</p>
			<p class="retry"><button type="button" class="btn" onclick={load}>Try again</button></p>
		</div>
	{:else}
		{@const s = view.stats}
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
				<dd class="tile__note">cards you keep missing</dd>
			</div>
		</dl>

		<p class="items">
			<strong>{s.folder.cardCount}</strong>
			{s.folder.cardCount === 1 ? 'card' : 'cards'} in {plural(
				s.folder.deckCount,
				'deck',
				'decks'
			)}. Items: {s.items.new} new, {s.items.learning} learning, {s.items.review} in review{#if s.items.suspended > 0},
				{s.items.suspended} suspended{/if}.
		</p>

		<figure class="chart">
			<figcaption class="label">Reviews in the last 14 days</figcaption>
			<ol class="bars" aria-hidden="true">
				{#each s.days as entry (entry.day)}
					<li
						class="bar"
						title="{dayLabel(entry.day)}: {plural(entry.reviews, 'review', 'reviews')}"
					>
						<span class="bar__fill" style:height="{(entry.reviews / tallest) * 100}%"></span>
					</li>
				{/each}
			</ol>
			<p class="axis" aria-hidden="true">
				<span>{dayLabel(s.days[0]!.day)}</span>
				<span>Today</span>
			</p>
			<div class="sr-only">
				<table>
					<caption>Reviews per study day in the last 14 days</caption>
					<thead>
						<tr><th scope="col">Day</th><th scope="col">Reviews</th></tr>
					</thead>
					<tbody>
						{#each s.days as entry (entry.day)}
							<tr><th scope="row">{dayLabel(entry.day)}</th><td>{entry.reviews}</td></tr>
						{/each}
					</tbody>
				</table>
			</div>
		</figure>

		{#if s.weakTags.length > 0}
			<div class="weak">
				<p class="label">Weakest tags (last 90 days)</p>
				<ul>
					{#each s.weakTags as tag (tag.tag)}
						<li>
							<span class="badge">{tag.tag}</span>
							{formatPercent(tag.retention)} recalled in {plural(tag.reviews, 'review', 'reviews')}
						</li>
					{/each}
				</ul>
			</div>
		{/if}
	{/if}
</section>

<style>
	.stats {
		display: grid;
		gap: var(--space-4);
		padding: var(--space-5);
		border: 1px solid var(--color-rule);
		border-radius: var(--radius-lg);
		background: var(--color-surface);
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

	.items {
		margin: 0;
		color: var(--color-muted);
	}

	.chart {
		display: grid;
		gap: var(--space-2);
		margin: 0;
	}

	.bars {
		display: grid;
		grid-template-columns: repeat(14, minmax(0, 1fr));
		align-items: end;
		gap: 0.25rem;
		height: 5rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.bar {
		display: flex;
		align-items: flex-end;
		height: 100%;
		border-radius: 3px;
		background: var(--color-sunken);
	}

	.bar__fill {
		display: block;
		width: 100%;
		min-height: 2px;
		border-radius: 3px;
		background: var(--color-review);
	}

	.axis {
		display: flex;
		justify-content: space-between;
		margin: 0;
		color: var(--color-muted);
		font-size: var(--text-xs);
	}

	.weak ul {
		display: grid;
		gap: var(--space-2);
		margin: var(--space-2) 0 0;
		padding: 0;
		list-style: none;
	}

	.retry {
		margin-block-start: var(--space-3);
	}
</style>
