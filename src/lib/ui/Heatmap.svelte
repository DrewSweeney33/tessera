<script lang="ts">
	import type { HeatCellDto } from '#lib/core/api-types.ts';
	import { heatLevel } from '#lib/core/stats.ts';

	// Reviews per study day for the last half year as a calendar, drawn with plain SVG (ADR-017): a column per week,
	// Monday at the top. Darker means more reviews, relative to the busiest day, and the numbers are in a visually
	// hidden table, so colour is never the only way to read it.

	let { weeks, caption }: { weeks: (HeatCellDto | null)[][]; caption: string } = $props();

	const CELL = 12;
	const GAP = 3;
	const STEP = CELL + GAP;
	const LABEL_WIDTH = 18;
	const MONTH_ROW = 12;

	const cells = $derived(weeks.flat().filter((cell): cell is HeatCellDto => cell !== null));
	const busiest = $derived(Math.max(0, ...cells.map((cell) => cell.reviews)));
	const total = $derived(cells.reduce((sum, cell) => sum + cell.reviews, 0));
	const activeDays = $derived(cells.filter((cell) => cell.reviews > 0).length);
	const width = $derived(LABEL_WIDTH + weeks.length * STEP);
	const height = MONTH_ROW + 7 * STEP;

	const WEEKDAYS = ['Mon', '', 'Wed', '', 'Fri', '', ''];

	function dayLabel(day: string): string {
		const [year, month, date] = day.split('-').map(Number) as [number, number, number];
		return new Date(Date.UTC(year, month - 1, date)).toLocaleDateString(undefined, {
			month: 'short',
			day: 'numeric',
			timeZone: 'UTC'
		});
	}

	// A month name above the first column in which a new month starts.
	const months = $derived.by(() => {
		const out: { x: number; text: string }[] = [];
		let last = '';
		weeks.forEach((week, index) => {
			const first = week.find((cell) => cell !== null);
			if (!first) return;
			const month = first.day.slice(0, 7);
			if (month !== last) {
				last = month;
				const [year, number] = month.split('-').map(Number) as [number, number];
				out.push({
					x: LABEL_WIDTH + index * STEP,
					text: new Date(Date.UTC(year, number - 1, 1)).toLocaleDateString(undefined, {
						month: 'short',
						timeZone: 'UTC'
					})
				});
			}
		});
		return out;
	});

	const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
</script>

<figure class="chart">
	<figcaption class="label">{caption}</figcaption>
	<div class="scroll">
		<svg
			class="svg"
			viewBox="0 0 {width} {height}"
			role="img"
			aria-label="{caption}. {plural(total, 'review', 'reviews')} on {plural(
				activeDays,
				'day',
				'days'
			)}."
			style:min-width="{width * 0.75}px"
		>
			{#each months as month (month.x)}
				<text class="text" x={month.x} y="9">{month.text}</text>
			{/each}
			{#each WEEKDAYS as name, row (row)}
				{#if name}
					<text class="text" x="0" y={MONTH_ROW + row * STEP + 10}>{name}</text>
				{/if}
			{/each}
			{#each weeks as week, column (column)}
				{#each week as cell, row (row)}
					{#if cell}
						<rect
							class="cell cell--{heatLevel(cell.reviews, busiest)}"
							x={LABEL_WIDTH + column * STEP}
							y={MONTH_ROW + row * STEP}
							width={CELL}
							height={CELL}
							rx="2.5"
						>
							<title>{dayLabel(cell.day)}: {plural(cell.reviews, 'review', 'reviews')}</title>
						</rect>
					{/if}
				{/each}
			{/each}
		</svg>
	</div>
	<p class="legend" aria-hidden="true">
		<span>Fewer</span>
		{#each [0, 1, 2, 3, 4] as level (level)}
			<svg width="12" height="12" viewBox="0 0 12 12"
				><rect class="cell cell--{level}" width="12" height="12" rx="2.5" /></svg
			>
		{/each}
		<span>More</span>
	</p>
	<div class="sr-only">
		<table>
			<caption>{caption}</caption>
			<thead>
				<tr><th scope="col">Day</th><th scope="col">Reviews</th></tr>
			</thead>
			<tbody>
				{#each cells.filter((cell) => cell.reviews > 0) as cell (cell.day)}
					<tr><th scope="row">{dayLabel(cell.day)}</th><td>{cell.reviews}</td></tr>
				{/each}
			</tbody>
		</table>
	</div>
</figure>

<style>
	.chart {
		display: grid;
		gap: var(--space-2);
		margin: 0;
	}

	.scroll {
		overflow-x: auto;
	}

	.svg {
		display: block;
		width: 100%;
	}

	.text {
		fill: var(--color-muted);
		font-size: 9px;
		font-family: var(--font-body);
	}

	.cell {
		fill: var(--color-sunken);
	}

	.cell--1 {
		fill: color-mix(in oklch, var(--color-review) 28%, var(--color-sunken));
	}

	.cell--2 {
		fill: color-mix(in oklch, var(--color-review) 52%, var(--color-sunken));
	}

	.cell--3 {
		fill: color-mix(in oklch, var(--color-review) 76%, var(--color-sunken));
	}

	.cell--4 {
		fill: var(--color-review);
	}

	.legend {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 3px;
		margin: 0;
		color: var(--color-muted);
		font-size: var(--text-xs);
	}

	.legend span {
		padding-inline: var(--space-1);
	}
</style>
