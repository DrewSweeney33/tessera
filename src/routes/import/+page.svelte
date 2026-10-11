<script lang="ts">
	import { resolve } from '$app/paths';
	import type {
		FieldErrorDto,
		ImportCommitDto,
		ImportCountsDto,
		ImportPlanSummary
	} from '#lib/core/api-types.ts';
	import { buildFixRequest } from '#lib/core/fix-request.ts';
	import { ApiError, api } from '#lib/ui/api.ts';
	import { copyText } from '#lib/ui/clipboard.ts';

	const MAX_BYTES = 5 * 1024 * 1024;

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

	const signature = $derived(`${archiveMissing}\n${text}`);
	const stale = $derived(plan !== undefined && previewedWith !== signature);
	const tooLarge = $derived(new Blob([text]).size > MAX_BYTES);
	const canPreview = $derived(text.trim().length > 0 && !tooLarge && busy === undefined);
	const canImport = $derived(plan !== undefined && !stale && busy === undefined && !result);
	const fixRequest = $derived(buildFixRequest(errors, location.origin));

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
			const response = await api.importDeck(text, { dryRun, archiveMissing, filename });
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
				failure =
					error instanceof ApiError ? error.message : 'Something went wrong importing the deck.';
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

	function onDrop(event: DragEvent) {
		event.preventDefault();
		dragging = false;
		void readFile(event.dataTransfer?.files[0]);
	}

	async function copyFix() {
		copyState = (await copyText(fixRequest)) ? 'copied' : 'manual';
	}

	const COUNT_LABELS: [keyof ImportCountsDto, string][] = [
		['new', 'New'],
		['updated', 'Updated'],
		['typeChanged', 'Type changed'],
		['restored', 'Restored'],
		['unchanged', 'Unchanged'],
		['absent', 'Not in this file'],
		['archivedMissing', 'To archive']
	];

	const ACTION_LABEL: Record<string, string> = {
		new: 'new',
		updated: 'updated',
		type_changed: 'type changed, progress resets',
		restored: 'restored'
	};
</script>

<svelte:head>
	<title>Import a deck · Tessera</title>
</svelte:head>

<div class="page layout">
	<div class="input-side stack">
		<header>
			<h1>Import a deck</h1>
			<p class="muted lead">
				Paste a deck from Claude, or choose a file. Nothing is saved until you press Import.
			</p>
		</header>

		<div class="stack">
			<label for="deck-text">Deck (JSON)</label>
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
		</div>

		<div class="options">
			<label class="check">
				<input type="checkbox" bind:checked={archiveMissing} />
				<span>Archive cards that are not in this file</span>
			</label>
		</div>

		<div class="actions">
			<label class="btn file">
				<input
					type="file"
					class="sr-only"
					accept=".json,application/json,.txt"
					onchange={(event) => readFile(event.currentTarget.files?.[0])}
				/>
				Choose a file
			</label>
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
			<section
				class="callout preview"
				class:preview--stale={stale}
				aria-labelledby="preview-heading"
			>
				<h2 id="preview-heading">
					{plan.deck.action === 'created' ? 'New deck' : 'Updating deck'}: {plan.deck.title}
				</h2>
				{#if stale}
					<p class="muted">You changed the deck after this preview. Preview again to import it.</p>
				{/if}
				<dl class="tally">
					{#each COUNT_LABELS as [key, label] (key)}
						{#if plan.counts[key] > 0 || key === 'new' || key === 'unchanged'}
							<div>
								<dt>{label}</dt>
								<dd>{plan.counts[key]}</dd>
							</div>
						{/if}
					{/each}
				</dl>

				{#each plan.warnings as warning (warning.code)}
					<p class="warning">
						<strong>Note.</strong>
						{warning.message}
					</p>
				{/each}

				{#if plan.cards.length > 0}
					<h3>Cards that change</h3>
					<ul class="changes">
						{#each plan.cards.slice(0, 50) as card (card.key)}
							<li>
								<code>{card.key}</code>
								<span class="muted">
									{ACTION_LABEL[card.action] ?? card.action}{card.changedFields.length > 0
										? `: ${card.changedFields.join(', ')}`
										: ''}
								</span>
							</li>
						{/each}
					</ul>
					{#if plan.cards.length > 50}
						<p class="muted small">…and {plan.cards.length - 50} more.</p>
					{/if}
				{/if}
			</section>
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
			<aside class="hint muted">
				<h2>How it works</h2>
				<ol>
					<li>Ask Claude for a deck in the Tessera format.</li>
					<li>Paste it here and press Preview to see exactly what will change.</li>
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

	@media (min-width: 60rem) {
		.layout {
			grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr);
			gap: var(--space-7);
		}
	}

	.lead {
		margin-block-start: var(--space-2);
		max-width: var(--measure);
	}

	.small {
		font-size: var(--text-sm);
	}

	.field--drag {
		border-color: var(--color-accent);
		outline: 2px dashed var(--color-accent);
		outline-offset: 2px;
	}

	.problem {
		color: var(--color-error);
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
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
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

	.preview > * + * {
		margin-block-start: var(--space-4);
	}

	.preview--stale {
		border-style: dashed;
	}

	.tally {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(7rem, 1fr));
		gap: var(--space-4);
		margin: 0;
	}

	.tally dt {
		color: var(--color-muted);
		font-size: var(--text-sm);
	}

	.tally dd {
		margin: 0;
		font-family: var(--font-display);
		font-size: var(--text-lg);
		font-weight: 600;
	}

	.warning {
		padding: var(--space-3) var(--space-4);
		border: 1px solid var(--color-hard);
		border-radius: var(--radius);
	}

	.changes {
		margin: 0;
		padding: 0;
		list-style: none;
		max-height: 18rem;
		overflow-y: auto;
	}

	.changes li {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1) var(--space-3);
		padding-block: var(--space-1);
		border-block-end: 1px solid var(--color-rule);
	}

	.done-actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
		margin-block-start: var(--space-4);
	}

	.hint ol {
		margin: var(--space-3) 0 0;
		padding-inline-start: 1.4em;
	}

	.hint li + li {
		margin-block-start: var(--space-2);
	}
</style>
