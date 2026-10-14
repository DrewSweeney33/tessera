<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import type { DeleteDeckResponse, TrashedDeckDto } from '#lib/core/api-types.ts';
	import { api, failureMessage } from '#lib/ui/api.ts';
	import Icon from '#lib/ui/Icon.svelte';
	import { formatDateTime } from '#lib/ui/format.ts';

	type View =
		| { kind: 'loading' }
		| { kind: 'error'; message: string }
		| { kind: 'ready'; decks: TrashedDeckDto[] };

	let view = $state<View>({ kind: 'loading' });
	// The deck whose "Delete for good" panel is open, what has been typed, and any problem to show.
	let deleting = $state<string | undefined>();
	let typed = $state('');
	let problem = $state<string | undefined>();
	let busy = $state<string | undefined>();
	let notice = $state<{ kind: 'restored'; title: string; id: string } | undefined>();
	let deleted = $state<DeleteDeckResponse['deleted'] | undefined>();
	let announcement = $state('');

	// Arriving from the editor after moving a deck here: say so, so Restore is right there if it was a mistake. The id
	// only picks a deck from the list. It is never shown.
	const movedDeck = $derived(
		view.kind === 'ready' ? view.decks.find((deck) => deck.id === page.state.moved) : undefined
	);

	async function load() {
		view = { kind: 'loading' };
		try {
			view = { kind: 'ready', decks: (await api.trash()).decks };
		} catch (error) {
			view = {
				kind: 'error',
				message: failureMessage(error, 'Something went wrong loading the Trash.')
			};
		}
	}

	onMount(load);

	async function restore(deck: TrashedDeckDto) {
		if (busy) return;
		busy = deck.id;
		problem = undefined;
		deleted = undefined;
		try {
			await api.restoreDeck(deck.id);
			if (view.kind === 'ready') view.decks = view.decks.filter((d) => d.id !== deck.id);
			notice = { kind: 'restored', title: deck.title, id: deck.id };
			announcement = `${deck.title} restored.`;
		} catch (error) {
			problem = failureMessage(error, 'Something went wrong restoring the deck.');
		} finally {
			busy = undefined;
		}
	}

	async function openDelete(deck: TrashedDeckDto) {
		deleting = deck.id;
		typed = '';
		problem = undefined;
		await tick();
		document.getElementById(`confirm-${deck.id}`)?.focus();
	}

	function cancelDelete(deck: TrashedDeckDto) {
		deleting = undefined;
		typed = '';
		problem = undefined;
		void tick().then(() => document.getElementById(`delete-${deck.id}`)?.focus());
	}

	// The button waits until what was typed matches. The server checks again.
	const matches = (deck: TrashedDeckDto) => typed.trim() === deck.title.trim();

	async function deleteForever(deck: TrashedDeckDto) {
		if (busy || !matches(deck)) return;
		busy = deck.id;
		problem = undefined;
		notice = undefined;
		try {
			const response = await api.deleteDeckForever(deck.id, typed);
			deleted = response.deleted;
			deleting = undefined;
			typed = '';
			if (view.kind === 'ready') view.decks = view.decks.filter((d) => d.id !== deck.id);
			announcement = `${deck.title} deleted for good.`;
		} catch (error) {
			problem = failureMessage(error, 'Something went wrong deleting the deck.');
			await tick();
			document.getElementById(`confirm-${deck.id}`)?.focus();
		} finally {
			busy = undefined;
		}
	}
</script>

<svelte:head>
	<title>Trash · Tessera</title>
</svelte:head>

<div class="page stack">
	<header class="page-head">
		<a class="crumb" href={resolve('/')}><Icon name="back" size="1em" /> All decks</a>
		<h1>Trash</h1>
		<p class="lead">
			A deck you delete waits here, with its cards and everything you studied. Nothing is lost until
			you delete a deck for good.
		</p>
	</header>

	<p class="sr-only" role="status" aria-live="polite">{announcement}</p>

	{#if movedDeck && !notice && !deleted}
		<div class="callout callout--ok" role="status">
			<p>
				<strong>{movedDeck.title}</strong> is in the Trash. It is out of your deck list and your study
				sessions. Restore it below if that was a mistake.
			</p>
		</div>
	{/if}

	{#if notice}
		<div class="callout callout--ok" role="status">
			<p>
				<strong>{notice.title}</strong> is back in your decks.
				<a href={resolve('/study/[[deckId]]', { deckId: notice.id })}>Study it</a>
			</p>
		</div>
	{/if}

	{#if deleted}
		<div class="callout callout--ok" role="status">
			<p>
				<strong>{deleted.title}</strong> is deleted for good: {deleted.cards}
				{deleted.cards === 1 ? 'card' : 'cards'} and {deleted.reviews}
				{deleted.reviews === 1 ? 'review' : 'reviews'}.
			</p>
			<p class="muted small">
				A copy of everything as it was just before is saved as <code>{deleted.snapshot.name}</code>
				in the backups folder, in case you change your mind.
			</p>
		</div>
	{/if}

	{#if view.kind === 'loading'}
		<p class="muted" role="status">Loading the Trash…</p>
	{:else if view.kind === 'error'}
		<div class="callout callout--error" role="alert">
			<p>{view.message}</p>
			<p><button type="button" class="btn" onclick={load}>Try again</button></p>
		</div>
	{:else if view.decks.length === 0}
		<div class="callout">
			<p>The Trash is empty.</p>
		</div>
	{:else}
		<ul class="ledger">
			{#each view.decks as deck (deck.id)}
				<li class="row">
					<div class="row__main">
						<h2 class="row__title">{deck.title}</h2>
						<p class="muted small">
							{deck.cardCount}
							{deck.cardCount === 1 ? 'card' : 'cards'}<span class="sep" aria-hidden="true">·</span
							>{deck.reviewCount}
							{deck.reviewCount === 1 ? 'review' : 'reviews'} of history<span
								class="sep"
								aria-hidden="true">·</span
							>moved here {formatDateTime(deck.trashedAt)}
						</p>
					</div>
					<div class="row__actions">
						<button
							type="button"
							class="btn btn--primary"
							disabled={busy !== undefined}
							data-state={busy === deck.id && deleting !== deck.id ? 'loading' : undefined}
							aria-label="Restore {deck.title}"
							onclick={() => restore(deck)}
						>
							<Icon name="undo" /> Restore
						</button>
						<button
							id="delete-{deck.id}"
							type="button"
							class="btn"
							disabled={busy !== undefined}
							aria-expanded={deleting === deck.id ? 'true' : 'false'}
							aria-controls="panel-{deck.id}"
							aria-label="Delete {deck.title} for good"
							onclick={() => (deleting === deck.id ? cancelDelete(deck) : openDelete(deck))}
						>
							Delete for good…
						</button>
					</div>

					{#if deleting === deck.id}
						<form
							id="panel-{deck.id}"
							class="danger stack"
							onsubmit={(event) => {
								event.preventDefault();
								void deleteForever(deck);
							}}
						>
							<p>
								<strong>This cannot be undone from the page.</strong> It deletes the deck, its
								{deck.cardCount}
								{deck.cardCount === 1 ? 'card' : 'cards'}, and its {deck.reviewCount}
								{deck.reviewCount === 1 ? 'review' : 'reviews'} of history. A copy of your data is saved
								first.
							</p>
							<label for="confirm-{deck.id}">
								Type the deck title to confirm: <strong class="typed-title">{deck.title}</strong>
							</label>
							<input
								id="confirm-{deck.id}"
								class="field field--text"
								type="text"
								bind:value={typed}
								autocomplete="off"
								spellcheck="false"
								aria-invalid={problem ? 'true' : undefined}
								aria-describedby={problem ? `problem-${deck.id}` : undefined}
							/>
							{#if problem}
								<p id="problem-{deck.id}" class="problem" role="alert">{problem}</p>
							{/if}
							<p class="actions">
								<button
									type="submit"
									class="btn btn--danger"
									disabled={!matches(deck) || busy !== undefined}
									data-state={busy === deck.id ? 'loading' : undefined}
								>
									Delete for good
								</button>
								<button type="button" class="btn btn--quiet" onclick={() => cancelDelete(deck)}>
									Cancel
								</button>
							</p>
						</form>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}

	{#if problem && deleting === undefined}
		<div class="callout callout--error" role="alert"><p>{problem}</p></div>
	{/if}
</div>

<style>
	.small {
		font-size: var(--text-sm);
	}

	.page.stack > :global(* + *) {
		margin-block-start: var(--space-5);
	}

	.sep {
		margin-inline: 0.5ch;
	}

	.row {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--space-3) var(--space-5);
		align-items: center;
	}

	.row__main {
		min-width: 0;
	}

	.row__title {
		font-size: var(--text-md);
	}

	.row__actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}

	.danger {
		padding: var(--space-4) var(--space-5);
		border: 1px solid var(--color-error);
		border-radius: var(--radius-lg);
		background: var(--color-error-soft);
	}

	.danger > :global(* + *) {
		margin-block-start: var(--space-3);
	}

	.typed-title {
		overflow-wrap: anywhere;
	}

	.problem {
		font-size: var(--text-sm);
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
		align-items: center;
		margin: 0;
	}

	@media (min-width: 48rem) {
		.row {
			grid-template-columns: minmax(0, 1fr) auto;
		}

		.danger {
			grid-column: 1 / -1;
		}
	}
</style>
