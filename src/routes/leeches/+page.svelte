<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import type { DeckSummaryDto, LeechDto, LeechesResponse } from '#lib/core/api-types.ts';
	import { api, failureMessage } from '#lib/ui/api.ts';
	import { cardSides } from '#lib/ui/card-sides.ts';
	import { copyText } from '#lib/ui/clipboard.ts';
	import Icon from '#lib/ui/Icon.svelte';
	import Markdown from '#lib/ui/Markdown.svelte';
	import { refreshShell } from '#lib/ui/shell.svelte.ts';

	type View =
		| { kind: 'loading' }
		| { kind: 'error'; message: string }
		| { kind: 'ready'; data: LeechesResponse };

	let view = $state<View>({ kind: 'loading' });
	let decks = $state<DeckSummaryDto[]>([]);
	let deckId = $state(page.url.searchParams.get('deckId') ?? '');
	let busy = $state<string | undefined>();
	let problem = $state<string | undefined>();
	let announcement = $state('');
	let copyState = $state<'idle' | 'copied' | 'manual'>('idle');
	let reportText = $state('');

	async function load() {
		try {
			const [leeches, list] = await Promise.all([api.leeches(deckId || undefined), api.decks()]);
			decks = list.decks;
			view = { kind: 'ready', data: leeches };
		} catch (error) {
			view = {
				kind: 'error',
				message: failureMessage(error, 'Something went wrong loading the leeches.')
			};
		}
	}

	onMount(load);

	const idOf = (leech: LeechDto) => `${leech.cardPk}-${leech.ordinal}`;
	const when = (iso: string | null) =>
		iso ? new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' }) : 'never';
	const percent = (share: number) => `${Math.round(share * 100)}%`;

	type Action = 'reset' | 'suspend' | 'unsuspend';
	const DONE: Record<Action, string> = {
		reset: 'Reset. The card is no longer a leech.',
		suspend: 'Suspended. The card is out of your study sessions.',
		unsuspend: 'Put back in your study sessions.'
	};

	async function act(leech: LeechDto, action: Action) {
		if (busy) return;
		busy = `${idOf(leech)}:${action}`;
		problem = undefined;
		try {
			if (action === 'reset') await api.resetLeech(leech.cardPk, leech.ordinal);
			else await api.setSuspended(leech.cardPk, action === 'suspend');
			announcement = DONE[action];
			await load();
			void refreshShell();
		} catch (error) {
			problem = failureMessage(error, 'Something went wrong. Nothing was changed.');
		} finally {
			busy = undefined;
		}
	}

	async function copyReport() {
		if (busy) return;
		busy = 'report';
		problem = undefined;
		copyState = 'idle';
		try {
			reportText = await api.weakSpotReport(deckId || undefined);
			copyState = (await copyText(reportText)) ? 'copied' : 'manual';
			announcement = copyState === 'copied' ? 'The report is copied.' : 'Copy the report below.';
		} catch (error) {
			problem = failureMessage(error, 'Something went wrong making the report.');
		} finally {
			busy = undefined;
		}
	}

	function chooseDeck() {
		copyState = 'idle';
		reportText = '';
		void load();
	}

	const open = $derived(view.kind === 'ready' ? view.data.openCount : 0);
</script>

<svelte:head>
	<title>Leeches · Tessera</title>
</svelte:head>

<div class="page stack">
	<header class="page-head">
		<a class="crumb" href={resolve('/')}><Icon name="back" size="1em" /> All decks</a>
		<h1>Leeches</h1>
		<p class="lead">
			Cards you keep forgetting. Tessera flags a card after it lapses eight times. Ask Claude to
			rewrite them, fix them yourself in the editor, or set one aside.
		</p>
	</header>

	<p class="sr-only" role="status" aria-live="polite">{announcement}</p>

	<div class="toolbar">
		<div class="stack">
			<label for="deck-filter">Show</label>
			<select
				id="deck-filter"
				class="field field--text field--select"
				bind:value={deckId}
				onchange={chooseDeck}
			>
				<option value="">All decks</option>
				{#each decks as deck (deck.id)}
					<option value={deck.id}>{deck.title}</option>
				{/each}
			</select>
		</div>
		<button
			type="button"
			class="btn btn--primary"
			disabled={busy !== undefined}
			data-state={busy === 'report' ? 'loading' : undefined}
			onclick={copyReport}
		>
			<Icon name="copy" /> Copy the weak-spot report for Claude
		</button>
	</div>

	{#if copyState === 'copied'}
		<div class="callout callout--ok" role="status">
			<p>
				<strong>Copied.</strong> Paste it into a chat with Claude. It asks for the revised cards back
				as a deck, which you import as usual. Each card keeps its id, so what you studied stays.
			</p>
		</div>
	{:else if copyState === 'manual'}
		<div class="callout stack">
			<label for="report-text">
				Your browser blocked copying. Select and copy this text, then paste it into a chat with
				Claude:
			</label>
			<textarea
				id="report-text"
				class="field"
				rows="12"
				readonly
				value={reportText}
				onfocus={(event) => event.currentTarget.select()}></textarea>
		</div>
	{/if}

	{#if problem}
		<div class="callout callout--error" role="alert"><p>{problem}</p></div>
	{/if}

	{#if view.kind === 'loading'}
		<p class="muted" role="status">Loading the leeches…</p>
	{:else if view.kind === 'error'}
		<div class="callout callout--error" role="alert">
			<p>{view.message}</p>
			<p><button type="button" class="btn" onclick={load}>Try again</button></p>
		</div>
	{:else}
		{@const data = view.data}
		<section class="stack" aria-labelledby="cards-heading">
			<h2 id="cards-heading">
				Cards {#if data.leeches.length > 0}<span class="muted"
						>({open} to deal with{data.leeches.length > open
							? `, ${data.leeches.length - open} set aside`
							: ''})</span
					>{/if}
			</h2>
			{#if data.leeches.length === 0}
				<div class="callout"><p>No leeches. Nothing is being forgotten over and over.</p></div>
			{:else}
				<ul class="ledger">
					{#each data.leeches as leech (idOf(leech))}
						{@const sides = cardSides({
							type: leech.type,
							content: leech.content,
							ordinal: leech.ordinal
						})}
						<li class="row" class:row--set-aside={leech.suspended}>
							<div class="row__main">
								<p class="meta muted small">
									<a href={resolve('/decks/[id]/edit', { id: leech.deckId })}>{leech.deckTitle}</a>
									<span class="sep" aria-hidden="true">·</span
									>{sides.kind}{#if leech.type === 'cloze'}
										(blank {leech.ordinal}){/if}<span class="sep" aria-hidden="true">·</span
									>{leech.lapses} lapses, {leech.reps} reviews<span class="sep" aria-hidden="true"
										>·</span
									>last {when(leech.lastReviewedAt)}
									{#if leech.suspended}<span class="badge">Set aside</span>{/if}
								</p>
								<div class="card-text"><Markdown source={sides.front} /></div>
								{#if sides.back.trim() !== ''}
									<div class="card-text card-text--answer"><Markdown source={sides.back} /></div>
								{/if}
								{#if leech.type === 'choice' && Array.isArray(leech.content['choices'])}
									<ol class="choices">
										{#each leech.content['choices'] as choice, index (index)}
											<li class:right={index === leech.content['correct']}>
												<Markdown source={String(choice)} inline />
											</li>
										{/each}
									</ol>
								{/if}
								{#if leech.wrongAnswers.length > 0}
									<p class="wrong small">
										<span class="muted">You typed:</span>
										{#each leech.wrongAnswers as answer, index (index)}<code>{answer}</code>{/each}
									</p>
								{/if}
							</div>
							<div class="row__actions">
								<a
									class="btn"
									href={resolve('/decks/[id]/edit', { id: leech.deckId })}
									aria-label="Edit {leech.deckTitle}"
								>
									Edit deck
								</a>
								<button
									type="button"
									class="btn"
									disabled={busy !== undefined}
									data-state={busy === `${idOf(leech)}:reset` ? 'loading' : undefined}
									aria-label="Reset the leech flag of card {leech.key}"
									onclick={() => act(leech, 'reset')}
								>
									Reset
								</button>
								{#if leech.suspended}
									<button
										type="button"
										class="btn"
										disabled={busy !== undefined}
										aria-label="Put card {leech.key} back in study sessions"
										onclick={() => act(leech, 'unsuspend')}
									>
										Put back
									</button>
								{:else}
									<button
										type="button"
										class="btn btn--quiet"
										disabled={busy !== undefined}
										aria-label="Set card {leech.key} aside"
										onclick={() => act(leech, 'suspend')}
									>
										Set aside
									</button>
								{/if}
							</div>
						</li>
					{/each}
				</ul>
				<p class="muted small">
					<strong>Reset</strong> clears the flag and the lapse count and keeps everything else, for
					a card you have fixed. <strong>Set aside</strong> takes the card out of your study sessions
					until you put it back.
				</p>
			{/if}
		</section>

		<section class="stack" aria-labelledby="tags-heading">
			<h2 id="tags-heading">Weakest tags</h2>
			{#if data.weakTags.length === 0}
				<p class="muted">No tag has enough reviews yet to say which is weakest.</p>
			{:else}
				<table class="tags">
					<caption class="sr-only">Tags by how well they are remembered, weakest first</caption>
					<thead>
						<tr>
							<th scope="col">Tag</th>
							<th scope="col">Reviews</th>
							<th scope="col">Remembered</th>
							<th scope="col">Forgotten</th>
							<th scope="col">Cards</th>
						</tr>
					</thead>
					<tbody>
						{#each data.weakTags as row (row.tag)}
							<tr>
								<th scope="row">
									{row.tag}
									<a
										class="tag-practice"
										href="{resolve('/practice')}?tag={encodeURIComponent(row.tag)}"
										aria-label="Practice the tag {row.tag}">Practice</a
									>
								</th>
								<td>{row.reviews}</td>
								<td>{percent(row.retention)}</td>
								<td>{percent(row.lapseRate)}</td>
								<td>{row.cards}</td>
							</tr>
						{/each}
					</tbody>
				</table>
				<p class="muted small">
					From your reviews of cards that were already learned, over the last 90 days. A tag needs
					at least ten reviews to be listed.
				</p>
			{/if}
		</section>
	{/if}
</div>

<style>
	.small {
		font-size: var(--text-sm);
	}

	.page.stack > :global(* + *) {
		margin-block-start: var(--space-5);
	}

	.stack > :global(* + *) {
		margin-block-start: var(--space-3);
	}

	.toolbar {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		justify-content: space-between;
		gap: var(--space-4);
	}

	/* A flex item will not shrink below its content by default, and a select's content is its longest option. */
	.toolbar > * {
		min-width: 0;
		max-width: 100%;
	}

	.field--select {
		width: auto;
		min-height: var(--hit);
	}

	.sep {
		margin-inline: 0.5ch;
	}

	.row {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--space-3) var(--space-5);
	}

	.row--set-aside .card-text {
		opacity: 0.7;
	}

	.row__main {
		min-width: 0;
	}

	.row__main > :global(* + *) {
		margin-block-start: var(--space-2);
	}

	.row__actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		align-items: flex-start;
	}

	.card-text {
		overflow-wrap: anywhere;
	}

	.card-text--answer {
		padding-inline-start: var(--space-3);
		border-inline-start: 3px solid var(--color-rule-strong);
		color: var(--color-muted);
	}

	.choices {
		margin: 0;
		padding-inline-start: 1.6em;
	}

	.choices .right {
		font-weight: 600;
	}

	.wrong code {
		margin-inline-end: var(--space-2);
		padding: 0 0.4em;
		border-radius: var(--radius-sm);
		background: var(--color-sunken);
		overflow-wrap: anywhere;
	}

	.badge {
		margin-inline-start: var(--space-2);
		background: var(--color-hard-soft);
	}

	.tags {
		width: 100%;
		border-collapse: collapse;
		font-variant-numeric: tabular-nums;
	}

	.tags th,
	.tags td {
		padding: var(--space-3);
		text-align: start;
		border-block-end: 1px solid var(--color-rule);
		overflow-wrap: anywhere;
	}

	/* Under the tag name, with a touch area of its own, so the table keeps its five columns on a phone. */
	.tag-practice {
		display: flex;
		align-items: center;
		min-height: var(--hit);
		font-weight: 400;
	}

	.tags thead th {
		font-size: var(--text-sm);
		color: var(--color-muted);
		font-weight: 500;
	}

	@media (min-width: 48rem) {
		.row {
			grid-template-columns: minmax(0, 1fr) auto;
		}
	}
</style>
