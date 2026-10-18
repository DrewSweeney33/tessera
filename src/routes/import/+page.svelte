<script lang="ts">
	import { resolve } from '$app/paths';
	import type { FieldErrorDto, ImportCommitDto, ImportPlanSummary } from '#lib/core/api-types.ts';
	import { buildFixRequest } from '#lib/core/fix-request.ts';
	import { detectFormat } from '#lib/core/parse/detect.ts';
	import { ApiError, api, failureMessage } from '#lib/ui/api.ts';
	import { copyText } from '#lib/ui/clipboard.ts';
	import Icon from '#lib/ui/Icon.svelte';
	import {
		MAX_FILE_BYTES,
		dedupeFiles,
		findDuplicateDeckIds,
		isDeckFile,
		tallyBatch,
		type BulkItem,
		type BulkStatus
	} from '#lib/ui/bulk-import.ts';
	import ImportPlan from '#lib/ui/ImportPlan.svelte';

	const MAX_BYTES = MAX_FILE_BYTES;
	const STATUS_LABEL: Record<BulkStatus, string> = {
		queued: 'Not previewed',
		previewing: 'Previewing',
		ready: 'Ready',
		importing: 'Importing',
		imported: 'Imported',
		unchanged: 'No changes',
		problem: 'Problem'
	};

	let text = $state('');
	let archiveMissing = $state(false);
	let filename = $state<string | undefined>();
	let busy = $state<'preview' | 'import' | undefined>();
	let plan = $state<ImportPlanSummary | undefined>();
	let result = $state<ImportCommitDto | undefined>();
	let errors = $state<FieldErrorDto[]>([]);
	let failure = $state<string | undefined>();
	let previewedWith = $state('');
	let dragging = $state(false);
	let copyState = $state<'idle' | 'copied' | 'manual'>('idle');
	// Several files at once. Empty means the single deck above is in use.
	let batch = $state<BulkItem[]>([]);
	let batchBusy = $state<'preview' | 'import' | undefined>();
	let skipped = $state<string[]>([]);
	let nextId = 0;
	const inBatch = $derived(batch.length > 0);
	const tally = $derived(tallyBatch(batch));
	const canPreviewBatch = $derived(
		batchBusy === undefined && batch.some((item) => item.status === 'queued')
	);
	const canImportBatch = $derived(
		batchBusy === undefined &&
			tally.ready > 0 &&
			!batch.some((item) => item.status === 'queued' || item.status === 'previewing')
	);

	const signature = $derived(`${archiveMissing}\n${text}`);
	const stale = $derived(plan !== undefined && previewedWith !== signature);
	const tooLarge = $derived(new Blob([text]).size > MAX_BYTES);
	const canPreview = $derived(text.trim().length > 0 && !tooLarge && busy === undefined);
	const canImport = $derived(plan !== undefined && !stale && busy === undefined && !result);
	// JSON or Markdown, worked out from the text, so nobody has to say which they pasted.
	const format = $derived(detectFormat(text, filename));
	const fixRequest = $derived(buildFixRequest(errors, location.origin, format));

	function clearOutcome() {
		plan = undefined;
		result = undefined;
		errors = [];
		failure = undefined;
		copyState = 'idle';
	}

	async function run(dryRun: boolean) {
		busy = dryRun ? 'preview' : 'import';
		errors = [];
		failure = undefined;
		copyState = 'idle';
		try {
			const response = await api.importDeck(text, { dryRun, archiveMissing, filename, format });
			if (response.dryRun) {
				plan = response.plan;
				result = undefined;
				previewedWith = signature;
			} else {
				result = response.result;
			}
		} catch (error) {
			plan = dryRun ? undefined : plan;
			if (error instanceof ApiError && error.fieldErrors.length > 0) {
				errors = error.fieldErrors;
			} else {
				failure = failureMessage(error, 'Something went wrong importing the deck.');
			}
		} finally {
			busy = undefined;
		}
	}

	async function readFile(file: File | undefined) {
		if (!file) return;
		clearOutcome();
		filename = file.name;
		text = await file.text();
	}

	// Several files make a batch, each its own deck. One file keeps the paste box, so it can still be looked over.
	async function addFiles(chosen: File[]) {
		const files = dedupeFiles(chosen);
		const decks = files.filter(isDeckFile);
		skipped = files.filter((file) => !isDeckFile(file)).map((file) => file.name);
		if (decks.length === 0) return;
		if (decks.length === 1 && batch.length === 0) {
			await readFile(decks[0]);
			return;
		}

		clearOutcome();
		text = '';
		filename = undefined;
		const added: BulkItem[] = await Promise.all(
			decks.map(async (file) => {
				const tooBig = file.size > MAX_BYTES;
				const body = tooBig ? '' : await file.text();
				return {
					id: nextId++,
					name: file.name,
					text: body,
					format: detectFormat(body, file.name),
					status: tooBig ? 'problem' : 'queued',
					errors: [],
					message: tooBig
						? 'This is larger than the 5 MB limit. Split it into several decks.'
						: undefined
				} satisfies BulkItem;
			})
		);
		// A file picked again replaces the earlier copy of the same name, so a fixed file can be added back.
		const names = new Set(added.map((item) => item.name));
		batch = [...batch.filter((item) => !names.has(item.name)), ...added];
		refreshDuplicates();
	}

	function onDrop(event: DragEvent) {
		event.preventDefault();
		dragging = false;
		void addFiles([...(event.dataTransfer?.files ?? [])]);
	}

	function onPick(input: HTMLInputElement) {
		const files = [...(input.files ?? [])];
		// So that choosing the same file again still fires a change.
		input.value = '';
		void addFiles(files);
	}

	// Marks later files that repeat an earlier file's deck id, and clears the mark when that is no longer true.
	function refreshDuplicates() {
		for (const item of batch) {
			if (item.duplicate) {
				item.duplicate = false;
				item.message = undefined;
				item.status = 'ready';
			}
		}
		for (const [id, message] of findDuplicateDeckIds(batch)) {
			const item = batch.find((candidate) => candidate.id === id);
			if (!item) continue;
			item.duplicate = true;
			item.message = message;
			item.status = 'problem';
		}
	}

	function problemOf(item: BulkItem, error: unknown, fallback: string) {
		item.status = 'problem';
		if (error instanceof ApiError && error.fieldErrors.length > 0) {
			item.errors = error.fieldErrors;
			item.message = undefined;
		} else {
			item.errors = [];
			item.message = failureMessage(error, fallback);
		}
	}

	async function previewBatch() {
		batchBusy = 'preview';
		for (const item of batch) {
			if (item.status !== 'queued') continue;
			item.status = 'previewing';
			try {
				const response = await api.importDeck(item.text, {
					dryRun: true,
					archiveMissing,
					filename: item.name,
					format: item.format
				});
				if (response.dryRun) {
					item.plan = response.plan;
					item.errors = [];
					item.message = undefined;
					item.status = 'ready';
				}
			} catch (error) {
				problemOf(item, error, 'Something went wrong previewing this deck.');
			}
		}
		refreshDuplicates();
		batchBusy = undefined;
	}

	async function importBatch() {
		batchBusy = 'import';
		for (const item of batch) {
			if (item.status !== 'ready') continue;
			item.status = 'importing';
			try {
				const response = await api.importDeck(item.text, {
					dryRun: false,
					archiveMissing,
					filename: item.name,
					format: item.format
				});
				if (!response.dryRun) {
					item.result = response.result;
					item.status = response.result.changed ? 'imported' : 'unchanged';
				}
			} catch (error) {
				problemOf(item, error, 'Something went wrong importing this deck.');
			}
		}
		batchBusy = undefined;
	}

	function removeItem(id: number) {
		batch = batch.filter((item) => item.id !== id);
		refreshDuplicates();
	}

	function clearBatch() {
		batch = [];
		skipped = [];
	}

	// "Archive cards that are not in this file" changes every plan, so every earlier preview is out of date.
	function onArchiveChange() {
		for (const item of batch) {
			if (item.status === 'imported' || item.status === 'unchanged') continue;
			// A file that was too large to read stays a problem: previewing again would not change that.
			if (item.text === '') continue;
			item.status = 'queued';
			item.plan = undefined;
			item.errors = [];
			item.message = undefined;
			item.duplicate = false;
		}
	}

	async function copyFix() {
		copyState = (await copyText(fixRequest)) ? 'copied' : 'manual';
	}
</script>

<svelte:head>
	<title>Import a deck · Tessera</title>
</svelte:head>

<div class="page layout">
	<div class="input-side stack">
		<header class="page-head">
			<p class="eyebrow">Add cards</p>
			<h1>Import a deck</h1>
			<p class="lead">
				Paste a deck from Claude, or choose one or more files. Nothing is saved until you press
				Import.
			</p>
		</header>

		{#if inBatch}
			<div
				class="stack batch"
				class:batch--drag={dragging}
				role="group"
				aria-labelledby="batch-heading"
				ondragover={(event) => {
					event.preventDefault();
					dragging = true;
				}}
				ondragleave={() => (dragging = false)}
				ondrop={onDrop}
			>
				<div class="batch__head">
					<h2 id="batch-heading">{batch.length} files</h2>
					<button
						type="button"
						class="btn btn--quiet"
						disabled={batchBusy !== undefined}
						onclick={clearBatch}
					>
						Clear all
					</button>
				</div>
				<ul class="batch__list">
					{#each batch as item (item.id)}
						<li class="batch__item">
							<div class="batch__row">
								<div class="batch__name">
									<code>{item.name}</code>
									{#if item.plan}
										<span class="muted small">{item.plan.deck.title}</span>
									{/if}
								</div>
								<span class="badge badge--{item.status}">{STATUS_LABEL[item.status]}</span>
								<button
									type="button"
									class="btn btn--quiet batch__remove"
									aria-label="Remove {item.name}"
									disabled={batchBusy !== undefined}
									onclick={() => removeItem(item.id)}
								>
									<Icon name="x" />
								</button>
							</div>
							{#if item.message}
								<p class="problem small">{item.message}</p>
							{/if}
							{#if item.errors.length > 0}
								<ol class="problems small">
									{#each item.errors.slice(0, 5) as error, index (index)}
										<li>
											<code class="where">
												{error.line !== undefined ? `line ${error.line}` : error.path}
											</code>
											<span>{error.message}</span>
										</li>
									{/each}
								</ol>
								{#if item.errors.length > 5}
									<p class="muted small">…and {item.errors.length - 5} more.</p>
								{/if}
							{/if}
							{#if item.result}
								<p class="muted small">
									{item.result.changed
										? `${item.result.counts.new} new, ${item.result.counts.updated + item.result.counts.typeChanged + item.result.counts.restored} updated, ${item.result.counts.unchanged} unchanged.`
										: 'The deck already matches this file.'}
									<a href={resolve('/study/[[deckId]]', { deckId: item.result.deckId })}>Study</a>
								</p>
							{:else if item.plan && item.status !== 'problem'}
								<details class="batch__plan">
									<summary>Show preview</summary>
									<ImportPlan plan={item.plan} />
								</details>
							{/if}
						</li>
					{/each}
				</ul>
				{#if tally.total > 0 && (tally.ready > 0 || tally.imported + tally.unchanged > 0)}
					<p class="muted small">
						{tally.cards.new} new, {tally.cards.updated} updated, {tally.cards.unchanged} unchanged cards
						across {tally.ready + tally.imported + tally.unchanged} decks.
					</p>
				{/if}
			</div>
		{:else}
			<div class="stack">
				<label for="deck-text">Deck (JSON or Markdown)</label>
				<textarea
					id="deck-text"
					class="field"
					class:field--drag={dragging}
					rows="14"
					spellcheck="false"
					autocomplete="off"
					placeholder={'{ "tessera": 1, "deck": { "id": "my-deck", "title": "My deck" }, "cards": [ ... ] }'}
					bind:value={text}
					oninput={clearOutcome}
					ondragover={(event) => {
						event.preventDefault();
						dragging = true;
					}}
					ondragleave={() => (dragging = false)}
					ondrop={onDrop}></textarea>
				{#if tooLarge}
					<p class="problem">This is larger than the 5 MB limit. Split it into several decks.</p>
				{/if}
				{#if filename}
					<p class="muted small">From file <code>{filename}</code></p>
				{/if}
				{#if text.trim().length > 0}
					<p class="muted small">Reading this as {format === 'markdown' ? 'Markdown' : 'JSON'}.</p>
				{/if}
			</div>
		{/if}

		{#if skipped.length > 0}
			<p class="problem small" role="status">
				Skipped {skipped.length === 1 ? 'a file' : `${skipped.length} files`} that
				{skipped.length === 1 ? 'is' : 'are'} not JSON or Markdown: {skipped.join(', ')}.
			</p>
		{/if}

		<div class="options">
			<label class="check">
				<input type="checkbox" bind:checked={archiveMissing} onchange={onArchiveChange} />
				<span>Archive cards that are not in {inBatch ? 'their' : 'this'} file</span>
			</label>
		</div>

		<div class="actions">
			<label class="btn file">
				<input
					type="file"
					class="sr-only"
					multiple
					accept=".json,.md,.markdown,.txt,application/json,text/markdown"
					onchange={(event) => onPick(event.currentTarget)}
				/>
				<Icon name="file" />
				{inBatch ? 'Add more files' : 'Choose files'}
			</label>
			{#if inBatch}
				<button
					type="button"
					class="btn"
					disabled={!canPreviewBatch}
					data-state={batchBusy === 'preview' ? 'loading' : undefined}
					aria-busy={batchBusy === 'preview'}
					onclick={previewBatch}
				>
					Preview all
				</button>
				<button
					type="button"
					class="btn btn--primary"
					disabled={!canImportBatch}
					data-state={batchBusy === 'import' ? 'loading' : undefined}
					aria-busy={batchBusy === 'import'}
					onclick={importBatch}
				>
					Import {tally.ready === 1 ? '1 deck' : `${tally.ready} decks`}
				</button>
			{:else}
				<button
					type="button"
					class="btn"
					disabled={!canPreview}
					data-state={busy === 'preview' ? 'loading' : undefined}
					aria-busy={busy === 'preview'}
					onclick={() => run(true)}
				>
					Preview
				</button>
				<button
					type="button"
					class="btn btn--primary"
					disabled={!canImport}
					data-state={busy === 'import' ? 'loading' : undefined}
					aria-busy={busy === 'import'}
					onclick={() => run(false)}
				>
					Import
				</button>
			{/if}
		</div>
	</div>

	<div class="output-side stack" aria-live="polite">
		{#if failure}
			<div class="callout callout--error" role="alert">
				<p>{failure}</p>
			</div>
		{/if}

		{#if errors.length > 0}
			<section class="callout callout--error" role="alert" aria-labelledby="errors-heading">
				<h2 id="errors-heading">
					{errors.length === 1 ? '1 problem' : `${errors.length} problems`} to fix
				</h2>
				<ol class="problems">
					{#each errors as error, index (index)}
						<li>
							<code class="where">
								{error.line !== undefined
									? `line ${error.line}${error.column !== undefined ? `, column ${error.column}` : ''}`
									: error.path}
							</code>
							<span>{error.message}</span>
						</li>
					{/each}
				</ol>
				<div class="fix">
					<button type="button" class="btn" onclick={copyFix}>
						{copyState === 'copied' ? 'Copied' : 'Copy errors for Claude'}
					</button>
					<p class="muted small">
						Paste this into your chat with Claude. It asks for the corrected deck and tells it to
						keep every card id.
					</p>
					{#if copyState === 'manual'}
						<label for="fix-text" class="small"
							>Your browser blocked copying. Select and copy this text:</label
						>
						<textarea
							id="fix-text"
							class="field"
							rows="8"
							readonly
							value={fixRequest}
							onfocus={(event) => event.currentTarget.select()}></textarea>
					{/if}
				</div>
			</section>
		{/if}

		{#if plan}
			<ImportPlan {plan} {stale} />
		{/if}

		{#if result}
			<section class="callout callout--ok" aria-labelledby="done-heading">
				<h2 id="done-heading">
					{result.changed ? 'Imported' : 'Nothing changed'}
				</h2>
				<p>
					{#if result.changed}
						{result.counts.new} new, {result.counts.updated +
							result.counts.typeChanged +
							result.counts.restored} updated,
						{result.counts.unchanged} unchanged.
					{:else}
						The deck already matches this file, so no review progress was touched.
					{/if}
				</p>
				<p class="done-actions">
					<a
						class="btn btn--primary"
						href={resolve('/study/[[deckId]]', { deckId: result.deckId })}
					>
						Study this deck
					</a>
					<a class="btn" href={resolve('/')}>All decks</a>
				</p>
			</section>
		{/if}

		{#if !plan && !result && errors.length === 0 && !failure}
			<aside class="how panel">
				<h2>How it works</h2>
				<ol>
					<li>Ask Claude for a deck in the Tessera format, as JSON or Markdown.</li>
					<li>
						Paste it here, or choose several files at once, and press Preview to see exactly what
						will change.
					</li>
					<li>Press Import. Importing the same deck again never loses your progress.</li>
				</ol>
			</aside>
		{/if}
	</div>
</div>

<style>
	.layout {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--space-6);
		align-items: start;
	}

	@media (min-width: 64rem) {
		.layout {
			grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr);
			gap: var(--space-7);
		}

		.output-side {
			position: sticky;
			inset-block-start: var(--space-6);
		}
	}

	.small {
		font-size: var(--text-sm);
	}

	/* The text box is also the drop zone: a dashed edge says so, and it lights up when a file is over it. */
	#deck-text {
		min-height: 14rem;
		border-style: dashed;
		border-width: 1.5px;
		border-radius: var(--radius-lg);
	}

	/* On a phone the box is shorter, so Preview and Import are on the first screen instead of under the tab bar. The
	 * corner still resizes it. */
	@media (max-width: 39.99rem) {
		#deck-text {
			height: 10rem;
			min-height: 10rem;
		}
	}

	.field--drag {
		border-style: solid;
		border-color: var(--color-accent);
		background: var(--color-accent-soft);
		outline: 2px solid var(--color-accent);
		outline-offset: 2px;
	}

	.problem {
		color: var(--color-error);
	}

	/* A batch of files: one line per deck, with its own status, so a bad file never hides a good one. */
	.batch--drag {
		outline: 2px solid var(--color-accent);
		outline-offset: 4px;
		border-radius: var(--radius-lg);
	}

	.batch__head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
	}

	.batch__head h2 {
		font-size: var(--text-md);
	}

	.batch__list {
		margin: 0;
		padding: 0 var(--space-3);
		list-style: none;
		max-height: 28rem;
		overflow-y: auto;
		border: 1px solid var(--color-rule);
		border-radius: var(--radius);
		background: var(--color-paper);
	}

	.batch__item {
		padding-block: var(--space-3);
		border-block-end: 1px solid var(--color-rule);
	}

	.batch__item:last-child {
		border-block-end: 0;
	}

	.batch__row {
		display: flex;
		align-items: center;
		gap: var(--space-3);
	}

	.batch__name {
		display: grid;
		flex: 1;
		min-width: 0;
		overflow-wrap: anywhere;
	}

	.batch__remove {
		flex: none;
	}

	.batch__item > :global(* + *) {
		margin-block-start: var(--space-2);
	}

	.batch__plan > :global(section) {
		margin-block-start: var(--space-3);
	}

	.badge--ready,
	.badge--imported {
		border-color: var(--color-accent);
		background: var(--color-accent-soft);
		color: var(--color-accent);
	}

	.badge--problem {
		border-color: var(--color-error);
		color: var(--color-error);
	}

	.badge--queued,
	.badge--unchanged {
		color: var(--color-muted);
	}

	.check {
		display: inline-flex;
		align-items: center;
		gap: var(--space-3);
		min-height: var(--hit);
		font-weight: 400;
		cursor: pointer;
	}

	.actions {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: var(--space-3);
	}

	.actions .file {
		grid-column: 1 / -1;
	}

	@media (min-width: 40rem) {
		.actions {
			display: flex;
			flex-wrap: wrap;
		}
	}

	.file:has(:focus-visible) {
		outline: 2px solid var(--color-focus);
		outline-offset: 2px;
	}

	.problems {
		margin: var(--space-3) 0 0;
		padding-inline-start: 1.4em;
	}

	.problems li {
		padding-block: var(--space-1);
	}

	.where {
		display: inline-block;
		margin-inline-end: var(--space-2);
		padding: 0 0.4em;
		border-radius: var(--radius-sm);
		background: var(--color-sunken);
		color: var(--color-ink);
	}

	.fix {
		margin-block-start: var(--space-4);
	}

	.fix > * + * {
		margin-block-start: var(--space-3);
	}

	.done-actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
		margin-block-start: var(--space-4);
	}

	.how h2 {
		font-size: var(--text-md);
	}

	.how ol {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--space-4);
		margin: var(--space-4) 0 0;
		padding: 0;
		list-style: none;
		counter-reset: step;
	}

	.how li {
		display: grid;
		grid-template-columns: 2rem minmax(0, 1fr);
		gap: var(--space-3);
		align-items: start;
		counter-increment: step;
		color: var(--color-muted);
	}

	.how li::before {
		content: counter(step);
		display: grid;
		place-items: center;
		width: 2rem;
		height: 2rem;
		border-radius: var(--radius-sm);
		background: var(--color-accent-soft);
		color: var(--color-accent);
		font-family: var(--font-display);
		font-weight: 600;
	}
</style>
