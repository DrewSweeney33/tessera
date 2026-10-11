<script lang="ts">
	import { resolve } from '$app/paths';
	import type {
		FieldErrorDto,
		ImportCommitDto,
		ImportCountsDto,
		ImportPlanSummary
	} from '#lib/core/api-types.ts';
	import { buildFixRequest } from '#lib/core/fix-request.ts';
	import { detectFormat } from '#lib/core/parse/detect.ts';
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
	// JSON or Markdown, worked out from the text, so nobody has to say which they pasted.
	const format = $derived(detectFormat(text, filename));

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

	const FIELD_LABEL: Record<string, string> = {
		type: 'Type',
		front: 'Question',
		back: 'Answer',
		text: 'Text',
		answer: 'Answer',
		accept: 'Also accepted',
		choices: 'Choices',
		correct: 'Right choice (number)',
		extra: 'Extra',
		explanation: 'Explanation',
		hint: 'Hint',
		tags: 'Tags',
		source: 'Source'
	};

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
					accept=".json,.md,.markdown,.txt,application/json,text/markdown"
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
								<div class="change-head">
									<code>{card.key}</code>
									<span class="muted">
										{ACTION_LABEL[card.action] ?? card.action}{card.changedFields.length > 0
											? `: ${card.changedFields.join(', ')}`
											: ''}
									</span>
								</div>
								{#if card.action === 'type_changed'}
									<p class="retype">
										<strong>Progress starts over.</strong>
										{#if card.progressLost > 0}
											{card.progressLost} review {card.progressLost === 1 ? 'item' : 'items'} with history
											will be erased.
										{:else}
											This card has not been studied yet, so nothing is lost.
										{/if}
									</p>
								{/if}
								{#if card.changes && card.changes.length > 0}
									<details class="diffs">
										<summary>Show what changes</summary>
										{#each card.changes as change (change.field)}
											<div class="diff">
												<h4>{FIELD_LABEL[change.field] ?? change.field}</h4>
												<p class="diff__side diff__side--before">
													<span class="diff__tag">Before</span>
													<span class="diff__text"
														>{change.before ?? '(empty)'}{change.cut ? '…' : ''}</span
													>
												</p>
												<p class="diff__side diff__side--after">
													<span class="diff__tag">After</span>
													<span class="diff__text"
														>{change.after ?? '(empty)'}{change.cut ? '…' : ''}</span
													>
												</p>
											</div>
										{/each}
									</details>
								{/if}
							</li>
						{/each}
					</ul>
					{#if plan.cards.length > 50}
						<p class="muted small">…and {plan.cards.length - 50} more.</p>
					{/if}
				{/if}

				{#if plan.counts.absent > 0}
					<h3>Not in this file ({plan.counts.absent})</h3>
					<p class="muted small">
						{#if plan.archiveMissing}
							These cards will be archived: kept with their history, but no longer studied.
						{:else}
							These cards stay exactly as they are. To archive them, tick “Archive cards that are
							not in this file” and preview again.
						{/if}
					</p>
					<ul class="changes">
						{#each plan.absent.slice(0, 20) as card (card.key)}
							<li>
								<div class="change-head">
									<code>{card.key}</code>
									{#if card.archived}<span class="muted">already archived</span>{/if}
								</div>
							</li>
						{/each}
					</ul>
					{#if plan.counts.absent > 20}
						<p class="muted small">…and {plan.counts.absent - 20} more.</p>
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
					<li>Ask Claude for a deck in the Tessera format, as JSON or Markdown.</li>
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
		padding-block: var(--space-2);
		border-block-end: 1px solid var(--color-rule);
	}

	.change-head {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1) var(--space-3);
	}

	.retype {
		margin-block-start: var(--space-2);
		color: var(--color-hard);
	}

	.diffs {
		margin-block-start: var(--space-2);
	}

	.diffs summary {
		cursor: pointer;
		min-height: var(--hit);
		display: inline-flex;
		align-items: center;
		color: var(--color-accent);
	}

	.diff h4 {
		margin: var(--space-3) 0 var(--space-1);
		font-size: var(--text-sm);
		color: var(--color-muted);
	}

	.diff__side {
		display: grid;
		grid-template-columns: 4.5rem minmax(0, 1fr);
		gap: var(--space-3);
		margin: 0;
		padding: var(--space-1) var(--space-3);
		border-inline-start: 3px solid var(--color-rule-strong);
		background: var(--color-sunken);
	}

	.diff__side + .diff__side {
		margin-block-start: var(--space-1);
	}

	.diff__side--before {
		border-inline-start-color: var(--color-again);
	}

	.diff__side--after {
		border-inline-start-color: var(--color-accent);
	}

	.diff__tag {
		color: var(--color-muted);
		font-size: var(--text-sm);
	}

	.diff__text {
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		max-height: 10rem;
		overflow-y: auto;
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
