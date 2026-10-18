<script lang="ts" module>
	export interface Bar {
		// The label for the table row, such as "Oct 14".
		label: string;
		value: number;
		// "Oct 14: 12 reviews", shown as a hover title.
		title: string;
	}
</script>

<script lang="ts">
	// A bar chart drawn with plain SVG (no chart library, ADR-017). Each bar has a label for the axis ends, a value,
	// and a sentence for the hover title and for screen readers. The chart is a picture; the same numbers are in a
	// visually hidden table, so nothing depends on seeing it.

	let {
		bars,
		caption,
		valueHeading,
		first,
		last,
		tone = 'review',
		height = 96
	}: {
		bars: Bar[];
		caption: string;
		valueHeading: string;
		// The text under the left and the right end of the axis.
		first: string;
		last: string;
		tone?: 'review' | 'new';
		height?: number;
	} = $props();

	const width = $derived(bars.length * 10);
	const tallest = $derived(Math.max(1, ...bars.map((bar) => bar.value)));
	const total = $derived(bars.reduce((sum, bar) => sum + bar.value, 0));
</script>

<figure class="chart">
	<figcaption class="label">{caption}</figcaption>
	<svg
		class="svg"
		viewBox="0 0 {width} {height}"
		preserveAspectRatio="none"
		role="img"
		aria-label="{caption}. {total} in all."
		style:height="{height / 16}rem"
	>
		{#each bars as bar, index (index)}
			<g>
				<title>{bar.title}</title>
				<rect class="track" x={index * 10 + 1} y="0" width="8" {height} rx="1.5" />
				<rect
					class="fill fill--{tone}"
					x={index * 10 + 1}
					y={height - Math.max(bar.value > 0 ? 2 : 0, (bar.value / tallest) * height)}
					width="8"
					height={Math.max(bar.value > 0 ? 2 : 0, (bar.value / tallest) * height)}
					rx="1.5"
				/>
			</g>
		{/each}
	</svg>
	<p class="axis" aria-hidden="true">
		<span>{first}</span>
		<span>{last}</span>
	</p>
	<div class="sr-only">
		<table>
			<caption>{caption}</caption>
			<thead>
				<tr><th scope="col">Day</th><th scope="col">{valueHeading}</th></tr>
			</thead>
			<tbody>
				{#each bars as bar, index (index)}
					<tr><th scope="row">{bar.label}</th><td>{bar.value}</td></tr>
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

	.svg {
		display: block;
		width: 100%;
		overflow: visible;
	}

	.track {
		fill: var(--color-sunken);
	}

	.fill--review {
		fill: var(--color-review);
	}

	.fill--new {
		fill: var(--color-new);
	}

	.axis {
		display: flex;
		justify-content: space-between;
		margin: 0;
		color: var(--color-muted);
		font-size: var(--text-xs);
	}
</style>
