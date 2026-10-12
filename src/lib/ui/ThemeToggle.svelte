<script lang="ts">
	import Icon from './Icon.svelte';
	import {
		THEME_LABEL,
		applyTheme,
		loadTheme,
		nextTheme,
		saveTheme,
		type ThemeChoice
	} from './theme.ts';

	let choice = $state<ThemeChoice>(loadTheme());

	function cycle() {
		choice = nextTheme(choice);
		applyTheme(choice);
		saveTheme(choice);
	}

	const ICON = { auto: 'auto', light: 'sun', dark: 'moon' } as const;
</script>

<button
	type="button"
	class="toggle"
	onclick={cycle}
	aria-label={`Theme: ${THEME_LABEL[choice]}. Activate to change.`}
	title={`Theme: ${THEME_LABEL[choice]}`}
>
	<Icon name={ICON[choice]} size="1.2rem" />
</button>

<style>
	.toggle {
		display: inline-grid;
		place-items: center;
		width: var(--hit);
		height: var(--hit);
		border: 1px solid transparent;
		border-radius: 50%;
		background: transparent;
		color: var(--color-muted);
		cursor: pointer;
		touch-action: manipulation;
		transition:
			background-color var(--dur-fast) var(--ease-out),
			color var(--dur-fast) var(--ease-out),
			transform var(--dur-fast) var(--ease-out);
	}

	.toggle:hover {
		background: var(--color-sunken);
		color: var(--color-ink);
	}

	.toggle:active {
		transform: scale(0.92);
	}
</style>
