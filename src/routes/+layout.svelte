<script lang="ts">
	import '#lib/ui/fonts.css';
	import '#lib/ui/tokens.css';
	import '#lib/ui/base.css';
	import favicon from '#lib/assets/favicon.svg';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import Logo from '#lib/ui/Logo.svelte';
	import ThemeToggle from '#lib/ui/ThemeToggle.svelte';
	import { applyTheme, loadTheme } from '#lib/ui/theme.ts';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();

	// Applied before the first render so a manual theme choice does not flash the other theme.
	applyTheme(loadTheme());

	const here = (path: string) =>
		path === '/' ? page.url.pathname === '/' : page.url.pathname.startsWith(path);
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<a class="skip-link" href="#main">Skip to content</a>

<header class="bar">
	<div class="bar__inner">
		<a class="wordmark" href={resolve('/')} aria-label="Tessera, home">
			<Logo />
			<span>Tessera</span>
		</a>
		<nav aria-label="Main" class="bar__nav">
			<a href={resolve('/')} class="nav-link" aria-current={here('/') ? 'page' : undefined}>
				Decks
			</a>
			<a
				href={resolve('/import')}
				class="nav-link"
				aria-current={here('/import') ? 'page' : undefined}
			>
				Import
			</a>
		</nav>
		<ThemeToggle />
	</div>
</header>

<main id="main" tabindex="-1">
	{@render children()}
</main>

<style>
	.bar {
		border-block-end: 1px solid var(--color-rule);
		background: var(--color-paper);
	}

	.bar__inner {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		width: min(100% - 2 * var(--gutter), var(--page-width));
		min-height: 3.5rem;
		margin-inline: auto;
	}

	.wordmark {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		margin-inline-end: auto;
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

	.bar__nav {
		display: flex;
		gap: var(--space-1);
	}

	.nav-link {
		display: inline-flex;
		align-items: center;
		min-height: var(--hit);
		padding-inline: var(--space-3);
		border-radius: var(--radius);
		color: var(--color-muted);
		font-weight: 500;
		text-decoration: none;
		white-space: nowrap;
	}

	.nav-link:hover {
		color: var(--color-ink);
		background: var(--color-sunken);
	}

	.nav-link[aria-current='page'] {
		color: var(--color-ink);
		box-shadow: inset 0 -2px 0 var(--color-accent);
		border-end-start-radius: 0;
		border-end-end-radius: 0;
	}

	main:focus {
		outline: none;
	}
</style>
