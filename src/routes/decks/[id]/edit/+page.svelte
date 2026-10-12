<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { SvelteMap, SvelteSet } from 'svelte/reactivity';
	import { beforeNavigate } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import type {
		DeckCardDto,
		DeckDocumentDto,
		FieldErrorDto,
		ImportCommitDto,
		ImportPlanSummary
	} from '#lib/core/api-types.ts';
	import {
		CARD_TYPES,
		blankCard,
		cardPreviewText,
		cardProblems,
		changeSummary,
		deckProblems,
		newCardId,
		tidyDeck,
		type EditProblem,
		type EditableCardType
	} from '#lib/core/deck-edit.ts';
	import { LIMITS } from '#lib/core/schema/limits.ts';
	import { ApiError, api, fetchFile } from '#lib/ui/api.ts';
	import { cardFieldElementId } from '#lib/ui/card-fields.ts';
	import CardEditor from '#lib/ui/CardEditor.svelte';
	import { saveBlob } from '#lib/ui/download.ts';
	import ImportPlan from '#lib/ui/ImportPlan.svelte';

	const TYPE_LABEL: Record<EditableCardType, string> = {
		basic: 'Basic',
		cloze: 'Fill in the blank',
		typed: 'Typed answer',
		choice: 'Multiple choice'
	};
	const FIRST_FIELD: Record<EditableCardType, string> = {
		basic: 'front',
		cloze: 'text',
		typed: 'front',
		choice: 'front'
	};
	const PAGE_SIZE = 50;

	const deckId = $derived(page.params['id'] ?? '');
	const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

	type View = 'loading' | 'missing' | 'error' | 'ready';
	let view = $state<View>('loading');
	let loadMessage = $state('');

	let original = $state<DeckDocumentDto | undefined>();
	let draft = $state<DeckDocumentDto | undefined>();
	let revision = $state('');
	let tagsText = $state('');
	let removed = $state<DeckCardDto[]>([]);

	let filter = $state('');
	let limit = $state(PAGE_SIZE);
	let open = $state<Record<string, boolean>>({});
	let newType = $state<EditableCardType>('basic');

	let attempted = $state(false);
	let serverErrors = $state<FieldErrorDto[]>([]);
	let failure = $state<string | undefined>();
	let conflict = $state(false);
	let busy = $state<'review' | 'save' | 'export' | undefined>();
	let plan = $state<ImportPlanSummary | undefined>();
	let planFor = $state('');
	let saved = $state<ImportCommitDto | undefined>();
	let confirmingDiscard = $state(false);
	let announcement = $state('');

	const draftJson = $derived(draft ? JSON.stringify(draft) : '');
	const summary = $derived(
		original && draft
			? changeSummary(original, draft)
			: { changed: 0, added: 0, removed: 0, detailsChanged: false, any: false }
	);
	// Cards taken out count as removed even though they are no longer in the draft.
	const dirty = $derived(summary.any);
	const stale = $derived(plan !== undefined && planFor !== draftJson);

	async function load() {
		view = 'loading';
		try {
			const response = await api.getDeck(deckId);
			original = clone(response.document);
			draft = clone(response.document);
			revision = response.revision;
			tagsText = (draft.deck.tags ?? []).join(', ');
			removed = [];
			open = {};
			filter = '';
			limit = PAGE_SIZE;
			attempted = false;
			serverErrors = [];
			failure = undefined;
			conflict = false;
			plan = undefined;
			confirmingDiscard = false;
			view = 'ready';
		} catch (error) {
			if (error instanceof ApiError && error.status === 404) {
				view = 'missing';
			} else {
				loadMessage =
					error instanceof ApiError ? error.message : 'Something went wrong loading this deck.';
				view = 'error';
			}
		}
	}

	onMount(() => {
		void load();
		const warn = (event: BeforeUnloadEvent) => {
			if (dirty) event.preventDefault();
		};
		window.addEventListener('beforeunload', warn);
		return () => window.removeEventListener('beforeunload', warn);
	});

	// Leaving with edits that are not saved asks first. The browser asks for itself when the tab or site is left.
	beforeNavigate((navigation) => {
		if (!dirty) return;
		if (navigation.type === 'leave') {
			navigation.cancel();
		} else if (!window.confirm('You have changes that are not saved. Leave without saving them?')) {
			navigation.cancel();
		}
	});

	// What is wrong with the edit, by card id, plus the deck as a whole.
	function collectProblems(doc: DeckDocumentDto) {
		const byCard = new SvelteMap<string, EditProblem[]>();
		for (const card of doc.cards) {
			const problems = cardProblems(card);
			if (problems.length > 0) byCard.set(card.id, problems);
		}
		return { deck: deckProblems(doc), byCard };
	}

	// The server's answer names cards by position, such as cards[3].front. Positions are the draft's order.
	function serverProblemsFor(index: number): EditProblem[] {
		const prefix = `cards[${index}]`;
		return serverErrors
			.filter((error) => error.path === prefix || error.path.startsWith(`${prefix}.`))
			.map((error) => ({
				field: error.path === prefix ? 'type' : error.path.slice(prefix.length + 1),
				message: error.message
			}));
	}

	const problemsFor = (card: DeckCardDto, index: number): EditProblem[] => [
		...cardProblems(card),
		...serverProblemsFor(index)
	];

	const deckFieldProblem = (field: string): string | undefined =>
		attempted && draft
			? [
					...deckProblems(draft),
					...serverErrors
						.filter(
							(error) => error.path === `deck.${field}` || error.path.startsWith(`deck.${field}[`)
						)
						.map((error) => ({ field, message: error.message }))
				].find((problem) => problem.field === field)?.message
			: undefined;

	const matches = (card: DeckCardDto, needle: string) =>
		needle === '' ||
		card.id.toLowerCase().includes(needle) ||
		cardPreviewText(card).toLowerCase().includes(needle);

	const shownIds = $derived.by(() => {
		if (!draft) return new SvelteSet<string>();
		const needle = filter.trim().toLowerCase();
		const ids = new SvelteSet<string>();
		for (const card of draft.cards) {
			if (!matches(card, needle)) continue;
			if (ids.size >= limit) break;
			ids.add(card.id);
		}
		return ids;
	});
	const matchCount = $derived.by(() => {
		if (!draft) return 0;
		const needle = filter.trim().toLowerCase();
		return draft.cards.reduce((n, card) => n + (matches(card, needle) ? 1 : 0), 0);
	});

	function setField(index: number, field: string, value: unknown) {
		const card = draft?.cards[index];
		if (card) card[field] = value;
	}

	function setTags(text: string) {
		tagsText = text;
		if (draft) draft.deck.tags = text.split(',');
	}

	async function addCard() {
		if (!draft) return;
		if (draft.cards.length >= LIMITS.maxCards) return;
		const taken = new SvelteSet([...draft.cards, ...removed].map((card) => card.id));
		const card = blankCard(newType, newCardId(taken));
		draft.cards.push(card);
		filter = '';
		limit = Math.max(limit, draft.cards.length);
		open[card.id] = true;
		announcement = `Added a new ${TYPE_LABEL[newType].toLowerCase()} card, number ${draft.cards.length}.`;
		await tick();
		const field = document.getElementById(cardFieldElementId(card.id, FIRST_FIELD[newType]));
		field?.scrollIntoView({ block: 'center' });
		field?.focus();
	}

	function removeCard(index: number) {
		if (!draft) return;
		const [card] = draft.cards.splice(index, 1);
		if (!card) return;
		delete open[card.id];
		const existed = original?.cards.some((c) => c.id === card.id) ?? false;
		if (existed) removed.push(card);
		announcement = existed
			? 'Card removed. It is archived when you save, and you can put it back until then.'
			: 'New card discarded.';
	}

	function putBack(card: DeckCardDto) {
		if (!draft || !original) return;
		removed = removed.filter((c) => c.id !== card.id);
		// Back where it was: before the first card that used to come after it.
		const order = new SvelteMap(original.cards.map((c, i) => [c.id, i]));
		const mine = order.get(card.id) ?? Infinity;
		const at = draft.cards.findIndex((c) => (order.get(c.id) ?? -1) > mine);
		draft.cards.splice(at === -1 ? draft.cards.length : at, 0, card);
		announcement = 'Card put back.';
	}

	function showMore() {
		limit += PAGE_SIZE;
	}

	function clearOutcome() {
		saved = undefined;
	}

	async function focusFirstProblem() {
		if (!draft) return;
		await tick();
		const { deck, byCard } = collectProblems(draft);
		const firstDeck = deck[0];
		if (firstDeck) {
			const target = firstDeck.field === 'cards' ? 'add-card' : `deck-${firstDeck.field}`;
			document.getElementById(target)?.focus();
			return;
		}
		for (const card of draft.cards) {
			const first = byCard.get(card.id)?.[0];
			if (!first) continue;
			document.getElementById(cardFieldElementId(card.id, first.field))?.focus();
			return;
		}
	}

	function onSaveFailure(error: unknown) {
		plan = undefined;
		if (error instanceof ApiError && error.code === 'conflict') {
			conflict = true;
		} else if (error instanceof ApiError && error.fieldErrors.length > 0) {
			serverErrors = error.fieldErrors;
			failure = 'The server found problems the editor could not. They are marked beside each card.';
			if (draft) {
				for (const [index, card] of draft.cards.entries()) {
					if (serverProblemsFor(index).length > 0) open[card.id] = true;
				}
			}
		} else {
			failure =
				error instanceof ApiError
					? error.message
					: 'Something went wrong saving the deck. Try again.';
		}
	}

	async function review() {
		if (!draft || busy) return;
		attempted = true;
		serverErrors = [];
		failure = undefined;
		conflict = false;
		clearOutcome();

		const { deck, byCard } = collectProblems(draft);
		if (deck.length > 0 || byCard.size > 0) {
			// Every card with a problem opens, so each message is beside its field.
			for (const id of byCard.keys()) open[id] = true;
			plan = undefined;
			await focusFirstProblem();
			return;
		}

		busy = 'review';
		try {
			const response = await api.importDeck(JSON.stringify(tidyDeck(draft)), {
				dryRun: true,
				archiveMissing: true,
				expectedRevision: revision
			});
			if (response.dryRun) {
				plan = response.plan;
				planFor = draftJson;
				await tick();
				document.getElementById('save-panel')?.focus();
			}
		} catch (error) {
			onSaveFailure(error);
		} finally {
			busy = undefined;
		}
	}

	async function save() {
		if (!draft || busy || !plan || stale) return;
		busy = 'save';
		failure = undefined;
		try {
			const response = await api.importDeck(JSON.stringify(tidyDeck(draft)), {
				dryRun: false,
				archiveMissing: true,
				expectedRevision: revision
			});
			if (!response.dryRun) {
				const result = response.result;
				await load();
				saved = result;
				announcement = result.changed ? 'Saved.' : 'Nothing needed saving.';
			}
		} catch (error) {
			onSaveFailure(error);
		} finally {
			busy = undefined;
		}
	}

	function discard() {
		confirmingDiscard = false;
		void load();
	}

	async function exportDeck(format: 'json' | 'md') {
		busy = 'export';
		failure = undefined;
		try {
			const file = await fetchFile(
				`/api/decks/${encodeURIComponent(deckId)}/export?format=${format}`
			);
			saveBlob(file.blob, file.filename);
		} catch (error) {
			failure =
				error instanceof ApiError ? error.message : 'Something went wrong exporting the deck.';
		} finally {
			busy = undefined;
		}
	}

	const changeWords = $derived.by(() => {
		const parts: string[] = [];
		if (summary.changed > 0) parts.push(`${summary.changed} changed`);
		if (summary.added > 0) parts.push(`${summary.added} new`);
		if (summary.removed > 0) parts.push(`${summary.removed} removed`);
		if (summary.detailsChanged) parts.push('deck details changed');
		return parts.join(', ');
	});
</script>

<svelte:head>
	<title>{draft ? `Edit ${draft.deck.title}` : 'Edit deck'} · Tessera</title>
</svelte:head>

<div class="page stack">
	{#if view === 'loading'}
		<header><h1>Edit deck</h1></header>
		<p class="muted" role="status">Loading the deck…</p>
	{:else if view === 'missing'}
		<header><h1>Edit deck</h1></header>
		<div class="callout">
			<p>There is no deck <code>{deckId}</code>. It may have been moved to the Trash.</p>
			<p><a class="btn" href={resolve('/')}>All decks</a></p>
		</div>
	{:else if view === 'error'}
		<header><h1>Edit deck</h1></header>
		<div class="callout callout--error" role="alert">
			<p>{loadMessage}</p>
			<p><button type="button" class="btn" onclick={load}>Try again</button></p>
		</div>
	{:else if draft && original}
		<header class="head">
			<div>
				<p class="muted small"><a href={resolve('/')}>All decks</a></p>
				<h1>Edit deck</h1>
				<p class="muted small">
					<code>{draft.deck.id}</code> · {original.cards.length}
					{original.cards.length === 1 ? 'card' : 'cards'}
				</p>
			</div>
			<div class="head__actions">
				<a class="btn" href={resolve('/study/[[deckId]]', { deckId: draft.deck.id })}>Study</a>
				<button
					type="button"
					class="btn"
					disabled={busy === 'export'}
					onclick={() => exportDeck('json')}
				>
					Export JSON
				</button>
				<button
					type="button"
					class="btn"
					disabled={busy === 'export'}
					onclick={() => exportDeck('md')}
				>
					Export Markdown
				</button>
			</div>
		</header>

		<p class="sr-only" role="status" aria-live="polite">{announcement}</p>

		{#if saved}
			<div class="callout callout--ok" role="status">
				<p>
					{#if saved.changed}
						<strong>Saved.</strong>
						{saved.counts.updated + saved.counts.typeChanged + saved.counts.restored} changed, {saved
							.counts.new} new, {saved.counts.archivedMissing} removed. Everything you studied on the
						cards you kept is still there.
					{:else}
						<strong>Nothing needed saving.</strong> The deck already matches what you had on screen.
					{/if}
				</p>
			</div>
		{/if}

		{#if conflict}
			<div class="callout callout--error" role="alert">
				<p>
					<strong>This deck changed somewhere else.</strong> It was edited in another tab or imported
					again after you opened it, so saving now could undo that. Nothing was saved.
				</p>
				<p class="muted small">
					Your edits are still on screen below if you want to copy any text out before reloading.
				</p>
				<p class="actions">
					<button type="button" class="btn btn--primary" onclick={load}>
						Reload the deck (loses my edits)
					</button>
				</p>
			</div>
		{/if}

		{#if failure}
			<div class="callout callout--error" role="alert"><p>{failure}</p></div>
		{:else if attempted && !plan && !busy && !conflict}
			{@const found = collectProblems(draft)}
			{#if found.deck.length > 0 || found.byCard.size > 0}
				<div class="callout callout--error" role="alert">
					<p>
						Fix {found.deck.length + found.byCard.size}
						{found.deck.length + found.byCard.size === 1 ? 'thing' : 'things'} before saving. They are
						marked below.
					</p>
				</div>
			{/if}
		{/if}

		<section class="stack" aria-labelledby="details-heading">
			<h2 id="details-heading">Deck details</h2>
			<div class="stack">
				<label for="deck-title">Title</label>
				<input
					id="deck-title"
					class="field field--text"
					type="text"
					bind:value={draft.deck.title}
					maxlength={LIMITS.maxTitleLength}
					autocomplete="off"
					aria-invalid={deckFieldProblem('title') ? 'true' : undefined}
					aria-describedby={deckFieldProblem('title') ? 'deck-title-problem' : undefined}
				/>
				{#if deckFieldProblem('title')}
					<p id="deck-title-problem" class="problem">{deckFieldProblem('title')}</p>
				{/if}
			</div>
			<div class="stack">
				<label for="deck-description">Description <span class="muted">(optional)</span></label>
				<textarea
					id="deck-description"
					class="field field--text"
					rows="2"
					bind:value={draft.deck.description}
					maxlength={LIMITS.maxDescriptionLength}
					aria-invalid={deckFieldProblem('description') ? 'true' : undefined}
					aria-describedby={deckFieldProblem('description')
						? 'deck-description-problem'
						: undefined}></textarea>
				{#if deckFieldProblem('description')}
					<p id="deck-description-problem" class="problem">{deckFieldProblem('description')}</p>
				{/if}
			</div>
			<div class="stack">
				<label for="deck-tags"
					>Tags <span class="muted">(optional, separated by commas)</span></label
				>
				<input
					id="deck-tags"
					class="field field--text"
					type="text"
					value={tagsText}
					oninput={(event) => setTags(event.currentTarget.value)}
					autocomplete="off"
					aria-invalid={deckFieldProblem('tags') ? 'true' : undefined}
					aria-describedby={deckFieldProblem('tags') ? 'deck-tags-problem' : undefined}
				/>
				{#if deckFieldProblem('tags')}
					<p id="deck-tags-problem" class="problem">{deckFieldProblem('tags')}</p>
				{/if}
			</div>
		</section>

		<section class="stack" aria-labelledby="cards-heading">
			<div class="cards-head">
				<h2 id="cards-heading">Cards ({draft.cards.length})</h2>
				<div class="add">
					<label for="new-type" class="sr-only">Type of card to add</label>
					<select id="new-type" class="field field--text field--select" bind:value={newType}>
						{#each CARD_TYPES as type (type)}
							<option value={type}>{TYPE_LABEL[type]}</option>
						{/each}
					</select>
					<button
						id="add-card"
						type="button"
						class="btn btn--primary"
						disabled={draft.cards.length >= LIMITS.maxCards}
						onclick={addCard}
					>
						Add a card
					</button>
				</div>
			</div>
			{#if deckFieldProblem('cards')}
				<p class="problem" role="alert">{deckFieldProblem('cards')}</p>
			{/if}

			{#if draft.cards.length > 8}
				<div class="stack">
					<label for="card-filter">Find a card</label>
					<input
						id="card-filter"
						class="field field--text"
						type="search"
						bind:value={filter}
						oninput={() => (limit = PAGE_SIZE)}
						autocomplete="off"
						placeholder="Search the question text or the card id"
					/>
					{#if filter.trim() !== ''}
						<p class="muted small" role="status">
							{matchCount}
							{matchCount === 1 ? 'card matches' : 'cards match'}.
						</p>
					{/if}
				</div>
			{/if}

			<ol class="cards">
				{#each draft.cards as card, index (card.id)}
					{#if shownIds.has(card.id)}
						{@const isNew = !original.cards.some((c) => c.id === card.id)}
						{@const problems = open[card.id] ? problemsFor(card, index) : []}
						<li class="card" class:card--open={open[card.id]}>
							<div class="card__head">
								<span class="card__number">{index + 1}</span>
								<div class="card__summary">
									<p class="card__text">{cardPreviewText(card)}</p>
									<p class="muted small">
										{TYPE_LABEL[card.type]}{#if isNew}<span class="badge">New</span>{/if}
									</p>
								</div>
								<div class="card__actions">
									<button
										type="button"
										class="btn"
										aria-expanded={open[card.id] ? 'true' : 'false'}
										aria-controls="card-body-{card.id}"
										aria-label="{open[card.id] ? 'Close' : 'Edit'} card {index + 1}"
										onclick={() => (open[card.id] = !open[card.id])}
									>
										{open[card.id] ? 'Done' : 'Edit'}
									</button>
									<button
										type="button"
										class="btn btn--quiet"
										aria-label="Remove card {index + 1}"
										onclick={() => removeCard(index)}
									>
										Remove
									</button>
								</div>
							</div>
							{#if open[card.id]}
								<div id="card-body-{card.id}" class="card__body">
									<CardEditor
										{card}
										onset={(field, value) => setField(index, field, value)}
										{problems}
										showProblems={attempted}
									/>
								</div>
							{/if}
						</li>
					{/if}
				{/each}
			</ol>

			{#if matchCount > shownIds.size}
				<p>
					<button type="button" class="btn" onclick={showMore}>
						Show {Math.min(PAGE_SIZE, matchCount - shownIds.size)} more
						<span class="muted">({matchCount - shownIds.size} not shown)</span>
					</button>
				</p>
			{/if}
		</section>

		{#if removed.length > 0}
			<section class="stack" aria-labelledby="removed-heading">
				<h2 id="removed-heading">Removed ({removed.length})</h2>
				<p class="muted small">
					These cards are archived when you save: kept with their history, but no longer studied.
					Put one back to keep it.
				</p>
				<ul class="removed">
					{#each removed as card (card.id)}
						<li>
							<span class="removed__text">{cardPreviewText(card)}</span>
							<button type="button" class="btn btn--quiet" onclick={() => putBack(card)}>
								Put back
							</button>
						</li>
					{/each}
				</ul>
			</section>
		{/if}

		{#if plan}
			<div id="save-panel" class="stack" tabindex="-1">
				<ImportPlan
					{plan}
					{stale}
					noun="deck"
					staleMessage="You changed the deck after this preview. Review the changes again to save."
				/>
			</div>
		{/if}

		<div class="savebar" role="region" aria-label="Save">
			<p class="savebar__text" aria-live="polite">
				{#if dirty}
					{changeWords}.
				{:else}
					No changes yet.
				{/if}
			</p>
			<div class="actions">
				{#if confirmingDiscard}
					<span class="muted">Throw away {changeWords}?</span>
					<button type="button" class="btn" onclick={discard}>Discard</button>
					<button type="button" class="btn btn--quiet" onclick={() => (confirmingDiscard = false)}>
						Keep editing
					</button>
				{:else}
					{#if dirty}
						<button type="button" class="btn btn--quiet" onclick={() => (confirmingDiscard = true)}>
							Discard changes
						</button>
					{/if}
					{#if plan && !stale}
						<button
							type="button"
							class="btn btn--primary"
							disabled={busy !== undefined}
							data-state={busy === 'save' ? 'loading' : undefined}
							onclick={save}
						>
							Save changes
						</button>
					{:else}
						<button
							type="button"
							class="btn btn--primary"
							disabled={!dirty || busy !== undefined}
							data-state={busy === 'review' ? 'loading' : undefined}
							onclick={review}
						>
							Review changes
						</button>
					{/if}
				{/if}
			</div>
		</div>
	{/if}
</div>

<style>
	.head {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		justify-content: space-between;
		gap: var(--space-4);
	}

	.head__actions,
	.actions,
	.add {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
		align-items: center;
		margin: 0;
	}

	.small {
		font-size: var(--text-sm);
	}

	.problem {
		color: var(--color-error);
		font-size: var(--text-sm);
	}

	.stack > :global(* + *) {
		margin-block-start: var(--space-3);
	}

	.page.stack > :global(* + *) {
		margin-block-start: var(--space-6);
	}

	.cards-head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
	}

	.field--select {
		width: auto;
		min-height: var(--hit);
	}

	.cards {
		margin: 0;
		padding: 0;
		list-style: none;
		border-block-start: 1px solid var(--color-rule-strong);
	}

	.card {
		border-block-end: 1px solid var(--color-rule);
	}

	.card__head {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		gap: var(--space-2) var(--space-4);
		align-items: center;
		padding-block: var(--space-3);
	}

	.card__number {
		min-width: 2ch;
		color: var(--color-muted);
		font-variant-numeric: tabular-nums;
		text-align: end;
	}

	.card__summary {
		min-width: 0;
	}

	.card__text {
		overflow-wrap: anywhere;
	}

	.card__actions {
		grid-column: 1 / -1;
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		justify-content: flex-end;
	}

	.card__body {
		padding: var(--space-2) 0 var(--space-5) 0;
	}

	.badge {
		margin-inline-start: var(--space-2);
		padding: 0 0.5em;
		border: 1px solid var(--color-accent);
		border-radius: var(--radius-sm);
		color: var(--color-accent);
		font-size: var(--text-sm);
	}

	.removed {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.removed li {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		padding-block: var(--space-2);
		border-block-end: 1px solid var(--color-rule);
	}

	.removed__text {
		min-width: 0;
		overflow-wrap: anywhere;
	}

	.savebar {
		position: sticky;
		inset-block-end: 0;
		z-index: 5;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		padding: var(--space-3) var(--space-4);
		border: 1px solid var(--color-rule-strong);
		border-radius: var(--radius);
		background: var(--color-surface);
	}

	#save-panel:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: 4px;
	}

	@media (min-width: 48rem) {
		.card__head {
			grid-template-columns: auto minmax(0, 1fr) auto;
		}

		.card__actions {
			grid-column: auto;
		}

		.card__body {
			padding-inline-start: calc(2ch + var(--space-4));
		}
	}
</style>
