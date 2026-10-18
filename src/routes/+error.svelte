<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import Icon from '#lib/ui/Icon.svelte';

	// A page that does not exist (a mistyped address, an old bookmark) or a page that broke. Either way the person gets a
	// plain sentence, the app around it, and one way back. The raw message is never shown.
	const missing = $derived(page.status === 404);
	const heading = $derived(missing ? 'That page does not exist' : 'Something went wrong');
</script>

<svelte:head>
	<title>{heading} · Tessera</title>
</svelte:head>

<div class="page narrow stack">
	<header class="page-head">
		<p class="eyebrow">Error {page.status}</p>
		<h1>{heading}</h1>
		<p class="lead">
			{#if missing}
				The address may have a typo, or the deck may have been deleted. Your decks are all still
				here.
			{:else}
				Tessera could not show this page. Reload it, or go back to your decks.
			{/if}
		</p>
	</header>
	<p>
		<a class="btn btn--primary" href={resolve('/')}><Icon name="back" /> Back to decks</a>
	</p>
</div>

<style>
	.narrow {
		max-width: 42rem;
	}
</style>
