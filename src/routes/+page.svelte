<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { resolve } from '$app/paths';
	import type {
		DeckSummaryDto,
		DecksResponse,
		FolderDto,
		QueueCounts
	} from '#lib/core/api-types.ts';
	import { examDateProblem, examIsSoon, examLabel, folderNameProblem } from '#lib/core/folder.ts';
	import { ApiError, api, failureMessage } from '#lib/ui/api.ts';
	import FolderStats from '#lib/ui/FolderStats.svelte';
	import { formatExamDate, formatPercent } from '#lib/ui/format.ts';
	import Icon from '#lib/ui/Icon.svelte';
	import { shell } from '#lib/ui/shell.svelte.ts';

	type View =
		| { kind: 'loading' }
		| { kind: 'error'; message: string }
		| { kind: 'ready'; data: DecksResponse };

	let view = $state<View>({ kind: 'loading' });
	// A line for screen readers about what the last action did.
	let announcement = $state('');
	// An error from an action on a folder (the list itself is still fine).
	let actionError = $state<string | undefined>();
	let busy = $state(false);

	// Folder state. `collapsed` and `statsOpen` are per folder id; collapsed is remembered between visits.
	let collapsed = $state<Record<number, boolean>>({});
	let statsOpen = $state<Record<number, boolean>>({});
	let creating = $state(false);
	let newName = $state('');
	let newProblem = $state<string | undefined>();
	let renaming = $state<number | undefined>();
	let renameValue = $state('');
	let examValue = $state('');
	let renameProblem = $state<string | undefined>();
	let deleting = $state<number | undefined>();

	// Moving decks: a mode with a checkbox on each deck and a bar to choose where the checked decks go.
	let organizing = $state(false);
	let selected = $state<string[]>([]);
	let target = $state('');

	const COLLAPSED_KEY = 'tessera-folders-collapsed-v2';

	// A folder with many decks starts collapsed, so a long course does not push everything else off the screen. What
	// the person chooses is remembered per folder.
	const COLLAPSE_AT = 6;

	function isCollapsed(folder: FolderDto): boolean {
		return collapsed[folder.id] ?? folder.deckCount > COLLAPSE_AT;
	}

	function loadCollapsed() {
		try {
			const stored = JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? '{}') as unknown;
			if (typeof stored === 'object' && stored !== null && !Array.isArray(stored)) {
				collapsed = Object.fromEntries(
					Object.entries(stored).filter(
						([id, closed]) => /^[0-9]+$/.test(id) && typeof closed === 'boolean'
					)
				) as Record<number, boolean>;
			}
		} catch {
			collapsed = {};
		}
	}

	function saveCollapsed() {
		try {
			localStorage.setItem(COLLAPSED_KEY, JSON.stringify(collapsed));
		} catch {
			// Storage can be blocked. The folders then use their default each visit, which is fine.
		}
	}

	function toggleCollapsed(folder: FolderDto) {
		collapsed[folder.id] = !isCollapsed(folder);
		saveCollapsed();
	}

	async function load() {
		view = { kind: 'loading' };
		try {
			const data = await api.decks();
			shell.openLeeches = data.openLeeches;
			view = { kind: 'ready', data };
		} catch (error) {
			view = {
				kind: 'error',
				message: failureMessage(error, 'Something went wrong loading your decks.')
			};
		}
	}

	// Reloads the lists after a change, without the loading screen. Folder counts come with it.
	async function refresh() {
		try {
			const data = await api.decks();
			shell.openLeeches = data.openLeeches;
			view = { kind: 'ready', data };
			selected = selected.filter((id) => data.decks.some((deck) => deck.id === id));
		} catch (error) {
			actionError = failureMessage(
				error,
				'The change was saved, but the list could not be reloaded.'
			);
		}
	}

	onMount(() => {
		loadCollapsed();
		void load();
	});

	const available = (counts: QueueCounts) => counts.new + counts.learning + counts.review;

	// The share of a bar each queue takes, as percentages. An empty queue takes none.
	function share(counts: QueueCounts) {
		const all = available(counts);
		const pct = (n: number) => (all === 0 ? 0 : (n / all) * 100);
		return { new: pct(counts.new), learning: pct(counts.learning), review: pct(counts.review) };
	}

	function decksIn(data: DecksResponse, folderId: number): DeckSummaryDto[] {
		return data.decks.filter((deck) => deck.folderId === folderId);
	}

	// Decks in no folder. A deck whose folder is unknown (the server clears it, so this should not happen) is treated
	// as ungrouped so a deck is never hidden.
	function ungrouped(data: DecksResponse): DeckSummaryDto[] {
		const known = new Set(data.folders.map((folder) => folder.id));
		return data.decks.filter((deck) => deck.folderId === null || !known.has(deck.folderId));
	}

	function pluralDecks(n: number): string {
		return `${n} ${n === 1 ? 'deck' : 'decks'}`;
	}

	function problemOf(error: unknown, fallback: string): string {
		if (error instanceof ApiError) {
			return error.fieldErrors.find((entry) => entry.path === 'name')?.message ?? error.message;
		}
		return fallback;
	}

	// ----- folders: create, rename, delete -----

	async function openCreate() {
		creating = true;
		newName = '';
		newProblem = undefined;
		await tick();
		document.getElementById('new-folder-name')?.focus();
	}

	async function closeCreate() {
		creating = false;
		await tick();
		document.getElementById('new-folder-button')?.focus();
	}

	async function create(event: SubmitEvent) {
		event.preventDefault();
		const problem = folderNameProblem(newName);
		if (problem) {
			newProblem = problem.message;
			document.getElementById('new-folder-name')?.focus();
			return;
		}
		busy = true;
		actionError = undefined;
		try {
			const { folder } = await api.createFolder(newName);
			announcement = `Folder ${folder.name} created.`;
			creating = false;
			await refresh();
			await tick();
			document.getElementById('new-folder-button')?.focus();
		} catch (error) {
			newProblem = problemOf(error, 'The folder could not be created.');
			document.getElementById('new-folder-name')?.focus();
		} finally {
			busy = false;
		}
	}

	async function startRename(folder: FolderDto) {
		renaming = folder.id;
		renameValue = folder.name;
		examValue = folder.examDate ?? '';
		renameProblem = undefined;
		deleting = undefined;
		await tick();
		document.getElementById(`rename-${folder.id}`)?.focus();
	}

	async function stopRename(folderId: number) {
		renaming = undefined;
		await tick();
		document.getElementById(`rename-button-${folderId}`)?.focus();
	}

	async function rename(event: SubmitEvent, folder: FolderDto) {
		event.preventDefault();
		const problem = folderNameProblem(renameValue);
		if (problem) {
			renameProblem = problem.message;
			document.getElementById(`rename-${folder.id}`)?.focus();
			return;
		}
		const dateProblem = examValue.trim() === '' ? undefined : examDateProblem(examValue.trim());
		if (dateProblem) {
			renameProblem = dateProblem.message;
			document.getElementById(`exam-${folder.id}`)?.focus();
			return;
		}
		busy = true;
		try {
			const date = examValue.trim();
			const { folder: changed } = await api.updateFolder(folder.id, {
				name: renameValue,
				examDate: date === '' ? null : date
			});
			announcement = `Folder ${changed.name} saved.`;
			renaming = undefined;
			await refresh();
			await tick();
			document.getElementById(`rename-button-${folder.id}`)?.focus();
		} catch (error) {
			renameProblem = problemOf(error, 'The folder could not be saved.');
			document.getElementById(`rename-${folder.id}`)?.focus();
		} finally {
			busy = false;
		}
	}

	async function askDelete(folder: FolderDto) {
		deleting = folder.id;
		renaming = undefined;
		await tick();
		document.getElementById(`delete-cancel-${folder.id}`)?.focus();
	}

	async function cancelDelete(folderId: number) {
		deleting = undefined;
		await tick();
		document.getElementById(`delete-button-${folderId}`)?.focus();
	}

	async function remove(folder: FolderDto) {
		busy = true;
		actionError = undefined;
		try {
			const { deleted } = await api.deleteFolder(folder.id);
			announcement =
				deleted.decks > 0
					? `Folder ${deleted.name} deleted. ${pluralDecks(deleted.decks)} moved to ungrouped.`
					: `Folder ${deleted.name} deleted.`;
			deleting = undefined;
			delete collapsed[folder.id];
			delete statsOpen[folder.id];
			saveCollapsed();
			await refresh();
			await tick();
			document.getElementById('new-folder-button')?.focus();
		} catch (error) {
			actionError = failureMessage(error, 'The folder could not be deleted.');
		} finally {
			busy = false;
		}
	}

	// ----- moving decks -----

	function toggleOrganizing() {
		organizing = !organizing;
		selected = [];
		target = '';
		actionError = undefined;
	}

	function toggleSelected(deckId: string) {
		selected = selected.includes(deckId)
			? selected.filter((id) => id !== deckId)
			: [...selected, deckId];
	}

	function allSelected(decks: DeckSummaryDto[]): boolean {
		return decks.length > 0 && decks.every((deck) => selected.includes(deck.id));
	}

	function toggleGroup(decks: DeckSummaryDto[]) {
		const ids = decks.map((deck) => deck.id);
		selected = allSelected(decks)
			? selected.filter((id) => !ids.includes(id))
			: [...new Set([...selected, ...ids])];
	}

	async function move(folders: FolderDto[]) {
		if (selected.length === 0 || target === '') return;
		const folderId = target === 'none' ? null : Number(target);
		busy = true;
		actionError = undefined;
		try {
			const result = await api.assignDecks({ deckIds: selected, folderId });
			const name = folders.find((folder) => folder.id === folderId)?.name;
			announcement = `${pluralDecks(result.moved)} moved to ${name ? `folder ${name}` : 'ungrouped'}.`;
			selected = [];
			target = '';
			await refresh();
		} catch (error) {
			actionError = failureMessage(error, 'The decks could not be moved.');
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head>
	<title>Decks · Tessera</title>
</svelte:head>

{#snippet head(actions: boolean)}
	<header class="head">
		<div class="page-head">
			<p class="eyebrow">Your library</p>
			<h1>Decks</h1>
		</div>
		{#if actions}
			<div class="head__actions">
				{#if view.kind === 'ready' && view.data.decks.length > 0}
					<button
						type="button"
						class="btn"
						aria-pressed={organizing}
						onclick={toggleOrganizing}
						id="organize-button"
					>
						<Icon name="folder" />
						{organizing ? 'Done moving' : 'Move decks'}
					</button>
				{/if}
				<button
					type="button"
					class="btn"
					id="new-folder-button"
					aria-expanded={creating}
					aria-controls="new-folder-form"
					onclick={openCreate}
				>
					<Icon name="folder-plus" /> New folder
				</button>
				<a class="btn" href={resolve('/decks/new')}><Icon name="plus" /> New deck</a>
			</div>
		{/if}
	</header>
{/snippet}

<!-- One deck as a tile. `level` is the heading level, one below the folder heading above it. -->
{#snippet deckTile(deck: DeckSummaryDto, level: 'h2' | 'h3')}
	{@const n = available(deck.counts)}
	{@const bar = share(deck.counts)}
	<li class="row" class:row--due={n > 0} class:row--picked={selected.includes(deck.id)}>
		<div class="row__main">
			<svelte:element this={level} class="row__title">{deck.title}</svelte:element>
			<p class="muted row__meta">
				{deck.cardCount}
				{deck.cardCount === 1 ? 'card' : 'cards'}{#if deck.tags.length > 0}<span
						class="row__sep"
						aria-hidden="true">·</span
					>{deck.tags.join(', ')}{/if}
			</p>
			{#if deck.description}
				<p class="row__description">{deck.description}</p>
			{/if}
		</div>

		{#if organizing}
			<label class="pick">
				<input
					type="checkbox"
					checked={selected.includes(deck.id)}
					onchange={() => toggleSelected(deck.id)}
				/>
				<span class="sr-only">Select {deck.title}</span>
			</label>
		{/if}

		<dl class="counts">
			<div class="count count--new">
				<dt>New</dt>
				<dd>{deck.counts.new}</dd>
			</div>
			<div class="count count--learning">
				<dt>Learning</dt>
				<dd>{deck.counts.learning}</dd>
			</div>
			<div class="count count--review">
				<dt>Review</dt>
				<dd>{deck.counts.review}</dd>
			</div>
		</dl>

		<div class="row__bar" aria-hidden="true">
			<span class="seg seg--new" style:width="{bar.new}%"></span>
			<span class="seg seg--learning" style:width="{bar.learning}%"></span>
			<span class="seg seg--review" style:width="{bar.review}%"></span>
		</div>

		<div class="row__action">
			{#if n > 0}
				<a class="btn btn--primary" href={resolve('/study/[[deckId]]', { deckId: deck.id })}>
					<Icon name="play" /> Study
				</a>
			{:else if deck.cardCount === 0}
				<span class="state muted">No cards yet</span>
			{:else}
				<span class="state state--done"><Icon name="check" /> Done for now</span>
			{/if}
			{#if deck.cardCount > 0}
				<a
					class="btn btn--quiet"
					href="{resolve('/practice')}?deck={encodeURIComponent(deck.id)}"
					aria-label="Practice {deck.title} again"
				>
					<Icon name="repeat" /> Practice again
				</a>
			{/if}
			<a
				class="btn btn--quiet"
				href={resolve('/decks/[id]/edit', { id: deck.id })}
				aria-label="Edit {deck.title}"
			>
				<Icon name="pencil" /> Edit
			</a>
		</div>
	</li>
{/snippet}

<!-- A folder: its name and numbers, the actions on it, the statistics when opened, and its decks. -->
{#snippet folderSection(folder: FolderDto, decks: DeckSummaryDto[])}
	{@const due = available(folder.counts)}
	{@const closed = isCollapsed(folder) && !organizing}
	<section class="folder" aria-labelledby="folder-title-{folder.id}">
		<header class="folder__head">
			<div class="folder__title">
				{#if renaming === folder.id}
					<!-- The heading stays while the name is edited, so the headings below it keep their order. -->
					<h2 class="sr-only" id="folder-title-{folder.id}">{folder.name}</h2>
					<form class="inline-form" onsubmit={(event) => rename(event, folder)}>
						<label for="rename-{folder.id}" class="sr-only">Folder name</label>
						<input
							id="rename-{folder.id}"
							class="field field--text"
							bind:value={renameValue}
							maxlength="120"
							autocomplete="off"
							aria-invalid={renameProblem ? 'true' : undefined}
							aria-describedby={renameProblem ? `rename-problem-${folder.id}` : undefined}
						/>
						<label for="exam-{folder.id}" class="exam-label">Exam date (optional)</label>
						<input
							id="exam-{folder.id}"
							class="field field--text exam-input"
							type="date"
							bind:value={examValue}
							min="2000-01-01"
							max="2200-12-31"
							autocomplete="off"
						/>
						{#if examValue !== ''}
							<button
								type="button"
								class="btn btn--quiet"
								disabled={busy}
								onclick={() => (examValue = '')}>Clear date</button
							>
						{/if}
						<button type="submit" class="btn btn--primary" disabled={busy}>Save</button>
						<button
							type="button"
							class="btn btn--quiet"
							disabled={busy}
							onclick={() => stopRename(folder.id)}>Cancel</button
						>
					</form>
					{#if renameProblem}
						<p class="problem" id="rename-problem-{folder.id}" role="alert">{renameProblem}</p>
					{/if}
				{:else}
					<h2 class="folder__name" id="folder-title-{folder.id}">
						<button
							type="button"
							class="folder__toggle"
							aria-expanded={!closed}
							aria-controls="folder-body-{folder.id}"
							onclick={() => toggleCollapsed(folder)}
						>
							<span class="folder__chevron" class:folder__chevron--open={!closed}>
								<Icon name="chevron" />
							</span>
							<span class="folder__text">{folder.name}</span>
						</button>
					</h2>
				{/if}
				<p class="muted folder__meta">
					{pluralDecks(folder.deckCount)}, {folder.cardCount}
					{folder.cardCount === 1 ? 'card' : 'cards'}.
					{folder.reviewsToday}
					{folder.reviewsToday === 1 ? 'review' : 'reviews'} today.
					{#if folder.retention !== null}{formatPercent(folder.retention)} recalled over 30 days.{/if}
				</p>
				{#if folder.daysToExam !== null && folder.examDate !== null}
					<p class="exam" class:exam--soon={examIsSoon(folder.daysToExam)}>
						<Icon name="calendar" size="1.1em" />
						<strong>{examLabel(folder.daysToExam)}</strong>
						<span class="muted">({formatExamDate(folder.examDate)})</span>
						{#if examIsSoon(folder.daysToExam) && folder.cardCount > 0}
							<a href="{resolve('/practice')}?folder={folder.id}">Practice the folder</a>
						{/if}
					</p>
				{/if}
			</div>

			<dl class="counts folder__counts">
				<div class="count count--new">
					<dt>New</dt>
					<dd>{folder.counts.new}</dd>
				</div>
				<div class="count count--learning">
					<dt>Learning</dt>
					<dd>{folder.counts.learning}</dd>
				</div>
				<div class="count count--review">
					<dt>Review</dt>
					<dd>{folder.counts.review}</dd>
				</div>
			</dl>

			<div class="folder__actions">
				{#if due > 0}
					<a
						class="btn btn--primary"
						href="{resolve('/study/[[deckId]]', {})}?folder={folder.id}"
						aria-label="Study folder {folder.name}"
					>
						<Icon name="play" /> Study folder
					</a>
				{:else if folder.cardCount === 0}
					<span class="state muted">No cards yet</span>
				{:else}
					<span class="state state--done"><Icon name="check" /> Done for now</span>
				{/if}
				{#if folder.cardCount > 0}
					<a
						class="btn"
						href="{resolve('/practice')}?folder={folder.id}"
						aria-label="Practice folder {folder.name}"
					>
						<Icon name="repeat" /> Practice folder
					</a>
				{/if}
				<button
					type="button"
					class="btn"
					aria-expanded={statsOpen[folder.id] === true}
					aria-controls="folder-stats-{folder.id}"
					aria-label="Statistics for {folder.name}"
					onclick={() => (statsOpen[folder.id] = !statsOpen[folder.id])}
				>
					<Icon name="chart" /> Stats
				</button>
				<button
					type="button"
					class="btn btn--quiet"
					id="rename-button-{folder.id}"
					aria-label="Edit folder {folder.name}"
					onclick={() => startRename(folder)}
				>
					<Icon name="pencil" /> Edit
				</button>
				<button
					type="button"
					class="btn btn--quiet"
					id="delete-button-{folder.id}"
					aria-label="Delete folder {folder.name}"
					onclick={() => askDelete(folder)}
				>
					<Icon name="trash" /> Delete
				</button>
			</div>
		</header>

		{#if deleting === folder.id}
			<div class="panel confirm" role="group" aria-label="Delete folder {folder.name}">
				<p>
					Delete the folder <strong>{folder.name}</strong>?
					{#if folder.deckCount > 0}
						Its {pluralDecks(folder.deckCount)} will go back to the ungrouped list.
					{/if}
					No deck, card, or review is deleted.
				</p>
				<p class="confirm__actions">
					<button
						type="button"
						class="btn btn--danger"
						disabled={busy}
						onclick={() => remove(folder)}>Delete folder</button
					>
					<button
						type="button"
						class="btn"
						id="delete-cancel-{folder.id}"
						disabled={busy}
						onclick={() => cancelDelete(folder.id)}>Keep folder</button
					>
				</p>
			</div>
		{/if}

		{#if statsOpen[folder.id]}
			<div id="folder-stats-{folder.id}">
				<!-- Keyed by what the folder holds, so the numbers load again after decks are moved in or out. -->
				{#key `${folder.deckCount}:${folder.cardCount}:${folder.reviewsToday}`}
					<FolderStats folderId={folder.id} name={folder.name} />
				{/key}
			</div>
		{/if}

		<div id="folder-body-{folder.id}" hidden={closed}>
			{#if decks.length === 0}
				<p class="muted folder__empty">
					No decks in this folder yet. Choose Move decks, tick some decks, and move them here.
				</p>
			{:else}
				{#if organizing}
					<p class="select-all">
						<button type="button" class="btn btn--quiet" onclick={() => toggleGroup(decks)}>
							{allSelected(decks) ? 'Clear these' : 'Select all in this folder'}
						</button>
					</p>
				{/if}
				<ul class="ledger decks">
					{#each decks as deck (deck.id)}
						{@render deckTile(deck, 'h3')}
					{/each}
				</ul>
			{/if}
		</div>
	</section>
{/snippet}

<div class="page">
	{#if view.kind === 'ready' && (view.data.decks.length > 0 || view.data.folders.length > 0)}
		{@const data = view.data}
		{@const totals = data.totals}
		{@const due = available(totals)}
		{@const bars = share(totals)}
		{@const loose = ungrouped(data)}
		{@const grouped = data.folders.length > 0}
		{@render head(true)}

		<p class="sr-only" role="status" aria-live="polite">{announcement}</p>

		{#if creating}
			<form class="panel new-folder" id="new-folder-form" onsubmit={create}>
				<label for="new-folder-name">New folder</label>
				<p class="muted new-folder__help">
					A folder groups decks, for example one course. It only organizes: no deck, card, or review
					changes.
				</p>
				<div class="inline-form">
					<input
						id="new-folder-name"
						class="field field--text"
						bind:value={newName}
						maxlength="120"
						autocomplete="off"
						placeholder="CCNA 200-301"
						aria-invalid={newProblem ? 'true' : undefined}
						aria-describedby={newProblem ? 'new-folder-problem' : undefined}
					/>
					<button type="submit" class="btn btn--primary" disabled={busy}>Create folder</button>
					<button type="button" class="btn btn--quiet" disabled={busy} onclick={closeCreate}>
						Cancel
					</button>
				</div>
				{#if newProblem}
					<p class="problem" id="new-folder-problem" role="alert">{newProblem}</p>
				{/if}
			</form>
		{/if}

		{#if actionError}
			<div class="callout callout--error" role="alert">
				<p>{actionError}</p>
			</div>
		{/if}

		{#if data.decks.length > 0}
			<section class="today" class:today--clear={due === 0} aria-label="Today">
				<svg class="today__motif" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
					<rect x="2" y="2" width="20" height="20" rx="5" />
					<rect x="26" y="2" width="20" height="20" rx="5" />
					<rect x="2" y="26" width="20" height="20" rx="5" />
					<rect x="26" y="26" width="20" height="20" rx="5" class="today__motif-line" />
				</svg>
				<div class="today__main">
					<p class="today__label">{due === 0 ? 'All caught up' : 'Due today'}</p>
					<p class="today__number" aria-hidden="true">{due === 0 ? '0' : due}</p>
					<p class="today__summary" class:sr-only={due > 0} aria-live="polite">
						{#if due === 0}
							Nothing to study right now.
						{:else}
							<strong>{due}</strong> to study today:
							{totals.new} new, {totals.learning} learning, {totals.review} to review.
						{/if}
					</p>
				</div>
				<div class="today__side">
					{#if due > 0}
						<div class="today__bar" aria-hidden="true">
							<span class="seg seg--new" style:width="{bars.new}%"></span>
							<span class="seg seg--learning" style:width="{bars.learning}%"></span>
							<span class="seg seg--review" style:width="{bars.review}%"></span>
						</div>
						<ul class="today__legend" aria-hidden="true">
							<li><span class="dot dot--new"></span>New {totals.new}</li>
							<li><span class="dot dot--learning"></span>Learning {totals.learning}</li>
							<li><span class="dot dot--review"></span>Review {totals.review}</li>
						</ul>
						<a class="btn btn--light btn--lg" href={resolve('/study/[[deckId]]', {})}>
							<Icon name="play" /> Study all decks
						</a>
					{/if}
				</div>
			</section>
		{/if}

		{#each data.folders as folder (folder.id)}
			{@render folderSection(folder, decksIn(data, folder.id))}
		{/each}

		{#if loose.length > 0}
			<section class="loose" aria-labelledby="ungrouped-title">
				{#if grouped}
					<h2 class="loose__title" id="ungrouped-title">
						Ungrouped decks <span class="muted loose__count">{loose.length}</span>
					</h2>
				{/if}
				{#if organizing}
					<p class="select-all">
						<button type="button" class="btn btn--quiet" onclick={() => toggleGroup(loose)}>
							{allSelected(loose) ? 'Clear these' : 'Select all ungrouped decks'}
						</button>
					</p>
				{/if}
				<ul class="ledger decks">
					{#each loose as deck (deck.id)}
						{@render deckTile(deck, grouped ? 'h3' : 'h2')}
					{/each}
				</ul>
			</section>
		{/if}

		{#if organizing}
			<div class="movebar" role="region" aria-label="Move the selected decks">
				<p class="movebar__count" aria-live="polite">
					<strong>{selected.length}</strong>
					{selected.length === 1 ? 'deck' : 'decks'} selected
				</p>
				<label class="sr-only" for="move-target">Move the selected decks to</label>
				<select id="move-target" class="field field--text" bind:value={target}>
					<option value="" disabled>Move to…</option>
					<option value="none">No folder (ungrouped)</option>
					{#each data.folders as folder (folder.id)}
						<option value={String(folder.id)}>{folder.name}</option>
					{/each}
				</select>
				<button
					type="button"
					class="btn btn--primary"
					disabled={busy || selected.length === 0 || target === ''}
					onclick={() => move(data.folders)}
				>
					Move
				</button>
				<button type="button" class="btn btn--quiet" onclick={toggleOrganizing}>Done</button>
			</div>
		{/if}
	{:else if view.kind === 'ready'}
		{@render head(false)}
		<section class="empty">
			<svg class="empty__motif" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
				<rect x="2" y="2" width="20" height="20" rx="5" />
				<rect x="26" y="2" width="20" height="20" rx="5" class="empty__accent" />
				<rect x="2" y="26" width="20" height="20" rx="5" />
				<rect x="26" y="26" width="20" height="20" rx="5" class="empty__line" />
			</svg>
			<h2>No decks yet</h2>
			<p>
				Ask Claude to write a deck in the Tessera format, then import it here. The format is
				described by a <a href={resolve('/api/schema')}>JSON Schema</a> you can give to Claude.
			</p>
			<p class="empty__actions">
				<a class="btn btn--primary" href={resolve('/import')}>
					<Icon name="import" /> Import a deck
				</a>
				<a class="btn" href={resolve('/decks/new')}><Icon name="plus" /> New deck</a>
			</p>
		</section>
	{:else if view.kind === 'error'}
		{@render head(false)}
		<div class="callout callout--error" role="alert">
			<p>{view.message}</p>
			<p class="retry"><button type="button" class="btn" onclick={load}>Try again</button></p>
		</div>
	{:else}
		{@render head(false)}
		<p class="sr-only" role="status">Loading decks…</p>
		<div class="skeletons" aria-hidden="true">
			<div class="skeleton skeleton--hero"></div>
			<div class="skeleton"></div>
			<div class="skeleton"></div>
			<div class="skeleton"></div>
		</div>
	{/if}
</div>

<style>
	.head {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: var(--space-4);
		margin-block-end: var(--space-5);
	}

	.head__actions {
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: var(--space-2);
	}

	.inline-form {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		align-items: center;
	}

	.inline-form .field {
		flex: 1 1 14rem;
		width: auto;
		min-width: 0;
	}

	.new-folder {
		display: grid;
		gap: var(--space-3);
		margin-block-end: var(--space-5);
	}

	.new-folder__help {
		margin: 0;
		font-size: var(--text-sm);
	}

	/* A folder: a heading row with numbers and actions, then its decks. */
	.folder {
		display: grid;
		gap: var(--space-4);
		margin-block-end: var(--space-6);
		padding: var(--space-5);
		border: 1px solid var(--color-rule);
		border-radius: var(--radius-xl);
		background: var(--color-paper);
		box-shadow: var(--shadow-1);
	}

	.folder__head {
		display: grid;
		gap: var(--space-4);
	}

	.folder__title {
		min-width: 0;
	}

	.folder__name {
		margin: 0;
		font-size: var(--text-lg);
	}

	.folder__toggle {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		min-height: var(--hit);
		max-width: 100%;
		padding: 0;
		border: 0;
		background: none;
		color: inherit;
		font: inherit;
		text-align: start;
		cursor: pointer;
	}

	.folder__toggle:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: 2px;
		border-radius: var(--radius);
	}

	.folder__text {
		overflow-wrap: anywhere;
	}

	.folder__chevron {
		display: inline-flex;
		transition: transform var(--dur-fast) var(--ease-out);
	}

	.folder__chevron--open {
		transform: rotate(90deg);
	}

	.folder__meta {
		margin-block-start: var(--space-1);
		font-size: var(--text-sm);
	}

	.folder__counts {
		max-width: 24rem;
	}

	.exam {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
		margin: var(--space-1) 0 0;
		font-size: var(--text-sm);
	}

	.exam--soon strong {
		color: var(--color-accent-deep);
	}

	.exam-label {
		flex-basis: 100%;
		font-size: var(--text-sm);
		color: var(--color-muted);
	}

	.inline-form .exam-input {
		flex: 0 1 12rem;
	}

	.folder__actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		align-items: center;
	}

	.folder__empty {
		margin: 0;
	}

	.confirm {
		display: grid;
		gap: var(--space-3);
	}

	.confirm p {
		margin: 0;
	}

	.confirm__actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}

	.loose__title {
		margin-block: 0 var(--space-4);
		font-size: var(--text-lg);
	}

	.loose__count {
		font-size: var(--text-base);
		font-weight: 400;
	}

	.select-all {
		margin-block: 0 var(--space-3);
	}

	/* The checkbox sits at the top corner of a deck tile while decks are being moved. */
	.decks > .row {
		position: relative;
	}

	.pick {
		position: absolute;
		inset-block-start: var(--space-3);
		inset-inline-end: var(--space-3);
		display: grid;
		place-items: center;
		width: var(--hit);
		height: var(--hit);
		cursor: pointer;
	}

	.row--picked {
		border-color: var(--color-accent);
		box-shadow: 0 0 0 1px var(--color-accent);
	}

	.row:has(.pick) .row__main {
		padding-inline-end: var(--hit);
	}

	.movebar {
		position: sticky;
		inset-block-end: var(--space-4);
		z-index: 5;
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
		align-items: center;
		margin-block-start: var(--space-5);
		padding: var(--space-3) var(--space-4);
		border: 1px solid var(--color-rule-strong);
		border-radius: var(--radius-lg);
		background: var(--color-raised);
		box-shadow: var(--shadow-3);
	}

	.movebar__count {
		margin: 0;
		flex: 1 1 8rem;
	}

	.movebar .field {
		flex: 1 1 12rem;
		width: auto;
		min-width: 0;
	}

	@media (min-width: 48rem) {
		.folder__head {
			grid-template-columns: minmax(0, 1fr) minmax(0, 18rem);
			align-items: start;
		}

		.folder__actions {
			grid-column: 1 / -1;
		}
	}

	/* Today: one calm card that says what is waiting. It is the only gradient in the app. */
	.today {
		position: relative;
		display: grid;
		gap: var(--space-5);
		margin-block-end: var(--space-6);
		padding: var(--space-5);
		overflow: hidden;
		border-radius: var(--radius-xl);
		background: linear-gradient(135deg, var(--color-accent-deep), var(--color-accent));
		color: var(--color-accent-ink);
		box-shadow:
			var(--shadow-3),
			0 24px 48px -24px color-mix(in oklch, var(--color-accent) 60%, transparent);
	}

	.today--clear {
		background: linear-gradient(135deg, var(--color-accent-soft), var(--color-surface));
		color: var(--color-ink);
		border: 1px solid var(--color-rule);
	}

	.today__motif {
		position: absolute;
		inset-block-start: -1rem;
		inset-inline-end: -1rem;
		width: 11rem;
		height: 11rem;
		fill: currentColor;
		opacity: 0.12;
		transform: rotate(8deg);
		pointer-events: none;
	}

	.today__motif-line {
		fill: none;
		stroke: currentColor;
		stroke-width: 2.5;
	}

	.today--clear .today__motif {
		color: var(--color-accent);
		opacity: 0.2;
	}

	.today__main,
	.today__side {
		position: relative;
		display: grid;
		gap: var(--space-3);
		align-content: end;
	}

	.today__label {
		margin: 0;
		font-size: var(--text-xs);
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		opacity: 0.9;
	}

	.today__number {
		margin: 0;
		font-family: var(--font-display);
		font-size: var(--text-hero);
		font-weight: 500;
		line-height: 0.95;
		letter-spacing: -0.03em;
	}

	.today__summary strong {
		font-weight: 700;
	}

	.today__bar,
	.row__bar {
		display: flex;
		height: 0.5rem;
		overflow: hidden;
		border-radius: 999px;
		background: oklch(100% 0 0 / 0.2);
	}

	.row__bar {
		background: var(--color-sunken);
	}

	.seg {
		display: block;
		height: 100%;
		transition: width var(--dur-slow) var(--ease-out);
	}

	/* On the green card the bar uses light tints so each queue stays apart from the background. */
	.today__bar .seg--new {
		background: var(--color-tint-new);
	}

	.today__bar .seg--learning {
		background: var(--color-tint-learning);
	}

	.today__bar .seg--review {
		background: var(--color-tint-review);
	}

	.row__bar .seg--new {
		background: var(--color-new);
	}

	.row__bar .seg--learning {
		background: var(--color-learning);
	}

	.row__bar .seg--review {
		background: var(--color-review);
	}

	.today__legend {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1) var(--space-4);
		margin: 0;
		padding: 0;
		list-style: none;
		font-size: var(--text-sm);
	}

	.dot {
		display: inline-block;
		width: 0.55rem;
		height: 0.55rem;
		margin-inline-end: 0.4em;
		border-radius: 2px;
	}

	.dot--new {
		background: var(--color-tint-new);
	}

	.dot--learning {
		background: var(--color-tint-learning);
	}

	.dot--review {
		background: var(--color-tint-review);
	}

	/* A light button for use on the green card. */
	.btn--light {
		border-color: transparent;
		background: var(--color-button-light);
		color: var(--color-button-light-ink);
		box-shadow: 0 8px 20px -8px var(--shadow-color);
		font-weight: 600;
	}

	.btn--light:hover {
		border-color: transparent;
		background: var(--color-raised);
		color: var(--color-button-light-ink);
	}

	.btn--lg {
		min-height: 3.25rem;
		padding-inline: var(--space-5);
		font-size: 1.0625rem;
	}

	/* The decks: tiles on a grid. A tile is one deck, with what is waiting and how to start. */
	.decks {
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 21rem), 1fr));
		gap: var(--space-4);
	}

	.decks > .row {
		display: grid;
		grid-template-rows: auto auto auto auto;
		align-content: start;
		gap: var(--space-4);
		padding: var(--space-5);
	}

	.decks > .row:hover {
		border-color: var(--color-rule-strong);
		box-shadow: var(--shadow-2);
	}

	.row__main {
		min-width: 0;
	}

	.row__title {
		font-size: var(--text-md);
	}

	.row__sep {
		margin-inline: 0.5ch;
	}

	.row__meta {
		margin-block-start: var(--space-1);
		font-size: var(--text-sm);
		overflow-wrap: anywhere;
	}

	.row__description {
		margin-block-start: var(--space-2);
		color: var(--color-muted);
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	.counts {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: var(--space-3);
		margin: 0;
	}

	.count {
		min-width: 0;
		padding-block-start: var(--space-2);
		border-block-start: 3px solid var(--color-rule);
	}

	.count--new {
		border-block-start-color: var(--color-new);
	}

	.count--learning {
		border-block-start-color: var(--color-learning);
	}

	.count--review {
		border-block-start-color: var(--color-review);
	}

	.counts dt {
		color: var(--color-muted);
		font-size: var(--text-sm);
	}

	.counts dd {
		margin: 0;
		font-family: var(--font-display);
		font-size: var(--text-lg);
		font-weight: 600;
		line-height: 1.2;
	}

	.row__action {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		align-items: center;
	}

	.row__action .btn--primary {
		flex: 1 1 8rem;
	}

	.row__action .state {
		flex: 1 1 8rem;
	}

	.state {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		min-height: var(--hit);
	}

	.state--done {
		color: var(--color-accent);
		font-weight: 500;
	}

	.empty {
		display: grid;
		justify-items: start;
		gap: var(--space-4);
		max-width: 38rem;
		padding: var(--space-6);
		border: 1px solid var(--color-rule);
		border-radius: var(--radius-xl);
		background: var(--color-surface);
		box-shadow: var(--shadow-2);
	}

	.empty__motif {
		width: 4.5rem;
		height: 4.5rem;
		fill: var(--color-rule-strong);
	}

	.empty__accent {
		fill: var(--color-accent);
	}

	.empty__line {
		fill: none;
		stroke: var(--color-ink);
		stroke-width: 2.5;
	}

	.empty__actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
	}

	.retry {
		margin-block-start: var(--space-3);
	}

	.skeletons {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 21rem), 1fr));
		gap: var(--space-4);
	}

	.skeleton {
		height: 12rem;
		border-radius: var(--radius-lg);
		background: linear-gradient(
			100deg,
			var(--color-sunken) 30%,
			var(--color-surface) 50%,
			var(--color-sunken) 70%
		);
		background-size: 200% 100%;
		animation: shimmer 1.4s linear infinite;
	}

	.skeleton--hero {
		grid-column: 1 / -1;
		height: 10rem;
		border-radius: var(--radius-xl);
	}

	@keyframes shimmer {
		to {
			background-position: -200% 0;
		}
	}

	@media (min-width: 48rem) {
		.today {
			grid-template-columns: minmax(0, 1fr) minmax(0, 22rem);
			align-items: end;
			padding: var(--space-6);
		}
	}
</style>
