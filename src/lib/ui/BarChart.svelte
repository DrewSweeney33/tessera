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
	// visually hidden table, so nothing depends on seeing it. A touch screen has no hover, so a tap on a bar shows its
	// sentence under the chart.

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

	let svg = $state<SVGSVGElement>();
	let picked = $state<number | undefined>();

	// The bars are narrow on a phone, so a tap picks the nearest bar from where along the chart it landed.
	$effect(() => {
		const target = svg;
		if (!target) return;
		const pick = (event: MouseEvent) => {
			const box = target.getBoundingClientRect();
			if (box.width === 0) return;
			const index = Math.floor(((event.clientX - box.left) / box.width) * bars.length);
			picked = index >= 0 && index < bars.length ? index : undefined;
		};
		target.addEventListener('click', pick);
		return () => target.removeEventListener('click', pick);
	});

	// A different set of bars (another scope was chosen) clears the pick.
	$effect(() => {
		void bars;
		picked = undefined;
	});
</script>

<figure class="chart">
	<figcaption class="label">{caption}</figcaption>
	<svg
		bind:this={svg}
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
					class:fill--picked={index === picked}
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
	<p class="readout" aria-live="polite">
		{#if picked !== undefined && bars[picked]}
			{bars[picked]!.title}
		{:else}
			<span class="muted">Tap a bar to see that day.</span>
		{/if}
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
		grid-template-columns: minmax(0, 1fr);
		gap: var(--space-2);
		margin: 0;
	}

	.svg {
		display: block;
		width: 100%;
		overflow: visible;
	}

	.track {
		fill: color-mix(in oklch, var(--color-ink) 9%, var(--color-sunken));
	}

	.fill--review {
		fill: var(--color-review);
	}

	.fill--new {
		fill: var(--color-new);
	}

	.fill--picked {
		stroke: var(--color-ink);
		stroke-width: 2px;
		vector-effect: non-scaling-stroke;
	}

	.readout {
		min-height: 1.5rem;
		margin: 0;
		font-size: var(--text-sm);
	}

	.axis {
		display: flex;
		justify-content: space-between;
		margin: 0;
		color: var(--color-muted);
		font-size: var(--text-xs);
	}
</style>
