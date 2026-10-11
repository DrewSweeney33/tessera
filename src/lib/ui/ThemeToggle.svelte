<script lang="ts">
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
</script>

<button
	type="button"
	class="btn btn--quiet toggle"
	onclick={cycle}
	aria-label={`Theme: ${THEME_LABEL[choice]}. Activate to change.`}
>
	<svg viewBox="0 0 24 24" width="1.25em" height="1.25em" aria-hidden="true" focusable="false">
		<circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2" />
		{#if choice === 'light'}
			<circle cx="12" cy="12" r="3.5" fill="currentColor" />
		{:else if choice === 'dark'}
			<path d="M12 4a8 8 0 0 0 0 16A6.5 6.5 0 0 1 12 4z" fill="currentColor" />
		{:else}
			<path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor" />
		{/if}
	</svg>
	<span class="toggle__text">{THEME_LABEL[choice]}</span>
</button>

<style>
	.toggle {
		padding-inline: var(--space-3);
	}

	.toggle__text {
		display: none;
		font-size: var(--text-sm);
	}

	@media (min-width: 40rem) {
		.toggle__text {
			display: inline;
		}
	}
</style>
