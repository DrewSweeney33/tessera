<script lang="ts">
	import '#lib/ui/fonts.css';
	import '#lib/ui/tokens.css';
	import '#lib/ui/base.css';
	import favicon from '#lib/assets/favicon.svg';
	import { resolve } from '$app/paths';
	import { afterNavigate } from '$app/navigation';
	import { page } from '$app/state';
	import Icon from '#lib/ui/Icon.svelte';
	import Logo from '#lib/ui/Logo.svelte';
	import ThemeToggle from '#lib/ui/ThemeToggle.svelte';
	import { refreshShell, shell } from '#lib/ui/shell.svelte.ts';
	import { applyTheme, loadTheme } from '#lib/ui/theme.ts';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();

	// Applied before the first render so a manual theme choice does not flash the other theme.
	applyTheme(loadTheme());

	// The home page sets the leech count from what it loads anyway. Every other page asks once per visit.
	afterNavigate(() => {
		if (page.url.pathname !== '/') void refreshShell();
	});

	// Decks is also the home of everything about one deck: its editor, a new deck, and a study or practice session.
	const here = (path: string) => {
		const at = page.url.pathname;
		if (path !== '/') return at.startsWith(path);
		return (
			at === '/' || at.startsWith('/decks') || at.startsWith('/study') || at.startsWith('/practice')
		);
	};

	// Studying or practicing hides the phone navigation, so the card and the answer buttons have the whole screen.
	const studying = $derived(
		page.url.pathname.startsWith('/study') || page.url.pathname.startsWith('/practice')
	);
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<meta name="theme-color" content="oklch(97.5% 0.01 80)" media="(prefers-color-scheme: light)" />
	<meta name="theme-color" content="oklch(18% 0.012 80)" media="(prefers-color-scheme: dark)" />
</svelte:head>

<a class="skip-link" href="#main">Skip to content</a>

<div class="shell" class:shell--studying={studying}>
	<div class="rail">
		<header class="bar">
			<a class="wordmark" href={resolve('/')} aria-label="Tessera, home">
				<Logo />
				<span>Tessera</span>
			</a>
			<ThemeToggle />
		</header>

		<nav aria-label="Main" class="tabs">
			<a href={resolve('/')} class="tab" aria-current={here('/') ? 'page' : undefined}>
				<span class="tab__icon"><Icon name="decks" /></span>
				<span class="tab__label">Decks</span>
			</a>
			<a href={resolve('/import')} class="tab" aria-current={here('/import') ? 'page' : undefined}>
				<span class="tab__icon"><Icon name="import" /></span>
				<span class="tab__label">Import</span>
			</a>
			<a href={resolve('/stats')} class="tab" aria-current={here('/stats') ? 'page' : undefined}>
				<span class="tab__icon"><Icon name="chart" /></span>
				<span class="tab__label">Stats</span>
			</a>
			<a
				href={resolve('/leeches')}
				class="tab"
				aria-current={here('/leeches') ? 'page' : undefined}
			>
				<span class="tab__icon"><Icon name="leeches" /></span>
				<span class="tab__label">Leeches</span>{#if shell.openLeeches > 0}<span class="tab__badge"
						><span class="sr-only">&nbsp;(</span>{shell.openLeeches}<span class="sr-only">)</span
						></span
					>{/if}
			</a>
			<a
				href={resolve('/settings')}
				class="tab"
				aria-current={here('/settings') ? 'page' : undefined}
			>
				<span class="tab__icon"><Icon name="settings" /></span>
				<span class="tab__label">Settings</span>
			</a>
			<a
				href={resolve('/trash')}
				class="tab tab--minor tab--first-minor"
				aria-current={here('/trash') ? 'page' : undefined}
			>
				<span class="tab__icon"><Icon name="trash" /></span>
				<span class="tab__label">Trash</span>
			</a>
			<a
				href={resolve('/backups')}
				class="tab tab--minor"
				aria-current={here('/backups') ? 'page' : undefined}
			>
				<span class="tab__icon"><Icon name="backups" /></span>
				<span class="tab__label">Backups</span>
			</a>
		</nav>
	</div>

	<main id="main" tabindex="-1">
		{@render children()}
	</main>
</div>

<style>
	/* Phone first. The bar sits on top, the tabs sit under the thumb, and the page scrolls between them. */
	.shell {
		min-height: 100dvh;
	}

	.rail {
		display: contents;
	}

	.bar {
		position: sticky;
		inset-block-start: 0;
		z-index: 20;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		min-height: var(--bar-height);
		padding-inline: max(var(--gutter), env(safe-area-inset-left))
			max(var(--gutter), env(safe-area-inset-right));
		padding-block-start: env(safe-area-inset-top);
		border-block-end: 1px solid var(--color-rule);
		background: color-mix(in oklch, var(--color-paper) 82%, transparent);
		-webkit-backdrop-filter: blur(14px) saturate(1.3);
		backdrop-filter: blur(14px) saturate(1.3);
	}

	.wordmark {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		min-height: var(--hit);
		color: var(--color-ink);
		font-family: var(--font-display);
		font-size: var(--text-md);
		font-weight: 600;
		letter-spacing: -0.01em;
		text-decoration: none;
		white-space: nowrap;
	}

	.wordmark:hover {
		color: var(--color-ink);
	}

	.tabs {
		position: fixed;
		inset-inline: 0;
		inset-block-end: 0;
		z-index: 20;
		display: grid;
		grid-template-columns: repeat(5, minmax(0, 1fr));
		gap: var(--space-1);
		padding: var(--space-1) max(var(--space-2), env(safe-area-inset-right))
			calc(var(--space-1) + env(safe-area-inset-bottom))
			max(var(--space-2), env(safe-area-inset-left));
		border-block-start: 1px solid var(--color-rule);
		background: color-mix(in oklch, var(--color-surface) 88%, transparent);
		-webkit-backdrop-filter: blur(16px) saturate(1.4);
		backdrop-filter: blur(16px) saturate(1.4);
	}

	/* Trash and Backups are rare. On a phone they live on the Settings page, not in the tab bar. */
	.tabs .tab--minor {
		display: none;
	}

	.tab {
		position: relative;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 2px;
		min-height: 3.25rem;
		border-radius: var(--radius);
		color: var(--color-muted);
		font-size: var(--text-xs);
		font-weight: 500;
		text-decoration: none;
		white-space: nowrap;
		touch-action: manipulation;
		transition: color var(--dur-fast) var(--ease-out);
	}

	.tab:hover {
		color: var(--color-ink);
	}

	.tab__icon {
		display: grid;
		place-items: center;
		width: 3.5rem;
		height: 1.9rem;
		border-radius: 999px;
		transition:
			background-color var(--dur) var(--ease-out),
			transform var(--dur) var(--ease-spring);
	}

	.tab:active .tab__icon {
		transform: scale(0.92);
	}

	.tab[aria-current='page'] {
		color: var(--color-ink);
		font-weight: 600;
	}

	.tab[aria-current='page'] .tab__icon {
		background: var(--color-accent-soft);
		color: var(--color-accent);
	}

	.tab__badge {
		position: absolute;
		inset-block-start: 0.15rem;
		inset-inline-start: calc(50% + 0.35rem);
		min-width: 1.15rem;
		padding-inline: 0.3em;
		border-radius: 999px;
		background: var(--color-again);
		color: var(--color-paper);
		font-size: 0.6875rem;
		font-weight: 700;
		line-height: 1.15rem;
		text-align: center;
	}

	/* On the study screen a phone gets no bars at all: the card is the whole page. */
	.shell--studying .tabs,
	.shell--studying .bar {
		display: none;
	}

	main {
		display: block;
		padding-block-end: calc(var(--tabs-height) + env(safe-area-inset-bottom));
	}

	.shell--studying main {
		padding-block-end: 0;
	}

	main:focus {
		outline: none;
	}

	/* Tablet: the tab bar stays, with room to breathe. */
	@media (min-width: 40rem) {
		.tabs {
			grid-template-columns: repeat(5, minmax(0, 9rem));
			justify-content: center;
		}
	}

	/* Desktop: the bars become a rail down the left side. */
	@media (min-width: 64rem) {
		.shell {
			display: grid;
			grid-template-columns: var(--rail-width) minmax(0, 1fr);
			align-items: start;
		}

		.rail {
			position: sticky;
			inset-block-start: 0;
			display: flex;
			flex-direction: column;
			gap: var(--space-5);
			height: 100dvh;
			padding: var(--space-5) var(--space-4);
			border-inline-end: 1px solid var(--color-rule);
			background: color-mix(in oklch, var(--color-surface) 55%, transparent);
		}

		.bar {
			position: static;
			min-height: 0;
			padding: 0 var(--space-1) 0 var(--space-3);
			border: 0;
			background: none;
			-webkit-backdrop-filter: none;
			backdrop-filter: none;
		}

		.tabs {
			position: static;
			display: flex;
			flex: 1;
			flex-direction: column;
			gap: 2px;
			padding: 0;
			border: 0;
			background: none;
			-webkit-backdrop-filter: none;
			backdrop-filter: none;
		}

		.tabs .tab,
		.tabs .tab--minor {
			display: flex;
		}

		.tab {
			flex-direction: row;
			justify-content: flex-start;
			gap: var(--space-3);
			min-height: var(--hit);
			padding-inline: var(--space-3);
			font-size: var(--text-base);
			transition:
				color var(--dur-fast) var(--ease-out),
				background-color var(--dur-fast) var(--ease-out);
		}

		.tab:hover {
			background: var(--color-sunken);
		}

		.tab__icon {
			width: auto;
			height: auto;
			border-radius: 0;
			background: none;
		}

		.tab[aria-current='page'] {
			background: var(--color-accent-soft);
		}

		.tab[aria-current='page'] .tab__icon {
			background: none;
		}

		.tab__badge {
			position: static;
			margin-inline-start: auto;
		}

		.tab--first-minor {
			margin-block-start: auto;
		}

		/* The study screen keeps the rail on a desktop: there is room, and it is a way out. */
		.shell--studying .tabs,
		.shell--studying .bar {
			display: flex;
		}

		main {
			min-width: 0;
			padding-block-end: 0;
		}
	}
</style>
