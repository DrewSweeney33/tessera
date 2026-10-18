<script lang="ts" module>
	// Line icons on a 24 grid (the Lucide set, ISC licence), as plain shapes so no markup is injected (ADR-005 allows
	// {@html} in the Markdown component only). They are always decorative: the control around one carries the name.
	type Shape =
		| { d: string; fill?: true }
		| { x: number; y: number; w: number; h: number; rx?: number }
		| { cx: number; cy: number; r: number; fill?: true };

	const path = (...ds: string[]): Shape[] => ds.map((d) => ({ d }));
	const tile = (x: number, y: number): Shape => ({ x, y, w: 7, h: 7, rx: 1.5 });

	const SHAPES = {
		decks: [tile(3, 3), tile(14, 3), tile(14, 14), tile(3, 14)],
		import: path('M12 15V3', 'm7 10 5 5 5-5', 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4'),
		leeches: path(
			'M4 22V4a1 1 0 0 1 .4-.8A6 6 0 0 1 8 2c3 0 5 2 7.333 2q2 0 3.067-.8A1 1 0 0 1 20 4v10a1 1 0 0 1-.4.8A6 6 0 0 1 16 16c-3 0-5-2-8-2a6 6 0 0 0-4 1.528'
		),
		settings: path(
			'M10 5H3',
			'M12 19H3',
			'M14 3v4',
			'M16 17v4',
			'M21 12h-9',
			'M21 19h-5',
			'M21 5h-7',
			'M8 10v4',
			'M8 12H3'
		),
		trash: path(
			'M3 6h18',
			'M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6',
			'M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2',
			'M10 11v6',
			'M14 11v6'
		),
		backups: path(
			'M22 12H2',
			'M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z',
			'M6 16h.01',
			'M10 16h.01'
		),
		plus: path('M5 12h14', 'M12 5v14'),
		play: path('M6 3.5v17a1 1 0 0 0 1.5.86l14-8.5a1 1 0 0 0 0-1.72l-14-8.5A1 1 0 0 0 6 3.5z'),
		pencil: path(
			'M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z',
			'm15 5 4 4'
		),
		back: path('m12 19-7-7 7-7', 'M19 12H5'),
		arrowUp: path('m5 12 7-7 7 7', 'M12 19V5'),
		arrowDown: path('M12 5v14', 'm19 12-7 7-7-7'),
		check: path('M20 6 9 17l-5-5'),
		x: path('M18 6 6 18', 'm6 6 12 12'),
		sun: [
			{ cx: 12, cy: 12, r: 4 },
			...path(
				'M12 2v2',
				'M12 20v2',
				'm4.93 4.93 1.41 1.41',
				'm17.66 17.66 1.41 1.41',
				'M2 12h2',
				'M20 12h2',
				'm6.34 17.66-1.41 1.41',
				'm19.07 4.93-1.41 1.41'
			)
		],
		moon: path('M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z'),
		auto: [
			{ cx: 12, cy: 12, r: 9 },
			{ d: 'M12 3a9 9 0 0 1 0 18z', fill: true }
		],
		chevron: path('m9 18 6-6-6-6'),
		hint: path(
			'M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5',
			'M9 18h6',
			'M10 22h4'
		),
		download: path('M12 15V3', 'm7 10 5 5 5-5', 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4'),
		copy: [
			{ x: 8, y: 8, w: 14, h: 14, rx: 2 },
			...path('M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2')
		],
		file: path(
			'M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z',
			'M14 2v4a2 2 0 0 0 2 2h4'
		),
		search: [{ cx: 11, cy: 11, r: 8 }, ...path('m21 21-4.3-4.3')],
		tag: [
			...path(
				'M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z'
			),
			{ cx: 7.5, cy: 7.5, r: 0.5, fill: true }
		],
		undo: path('M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8', 'M3 3v5h5'),
		cards: [{ x: 3, y: 6, w: 14, h: 16, rx: 2 }, ...path('M7 3h12a2 2 0 0 1 2 2v12')],
		folder: path(
			'M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z'
		),
		'folder-plus': path(
			'M12 10v6',
			'M9 13h6',
			'M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z'
		),
		chart: path('M3 3v16a2 2 0 0 0 2 2h16', 'M18 17V9', 'M13 17V5', 'M8 17v-3'),
		calendar: path(
			'M8 2v4',
			'M16 2v4',
			'M3 10h18',
			'M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z'
		),
		repeat: path(
			'm17 2 4 4-4 4',
			'M3 11v-1a4 4 0 0 1 4-4h14',
			'm7 22-4-4 4-4',
			'M21 13v1a4 4 0 0 1-4 4H3'
		)
	} satisfies Record<string, Shape[]>;

	export type IconName = keyof typeof SHAPES;
	export { SHAPES };
</script>

<script lang="ts">
	let { name, size = '1.25em' }: { name: IconName; size?: string } = $props();
	const shapes = $derived<Shape[]>(SHAPES[name]);
</script>

<svg
	viewBox="0 0 24 24"
	width={size}
	height={size}
	fill="none"
	stroke="currentColor"
	stroke-width="1.75"
	stroke-linecap="round"
	stroke-linejoin="round"
	aria-hidden="true"
	focusable="false"
	class="icon"
>
	{#each shapes as shape, index (index)}
		{#if 'd' in shape}
			<path d={shape.d} fill={shape.fill ? 'currentColor' : undefined} />
		{:else if 'w' in shape}
			<rect x={shape.x} y={shape.y} width={shape.w} height={shape.h} rx={shape.rx} />
		{:else}
			<circle
				cx={shape.cx}
				cy={shape.cy}
				r={shape.r}
				fill={shape.fill ? 'currentColor' : undefined}
			/>
		{/if}
	{/each}
</svg>

<style>
	.icon {
		flex: none;
	}
</style>
