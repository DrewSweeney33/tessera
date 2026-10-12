<script lang="ts">
	import type { ImportCountsDto, ImportPlanSummary } from '#lib/core/api-types.ts';

	// What an import (or a save from the editor) would do, as the server's preview reports it. Shared by the import
	// page and the editor so both say it the same way.
	let {
		plan,
		stale = false,
		staleMessage = 'You changed the deck after this preview. Preview again to import it.',
		noun = 'file'
	}: {
		plan: ImportPlanSummary;
		stale?: boolean;
		staleMessage?: string;
		// What the cards that are not mentioned are "not in": "file" on the import page, "deck" in the editor.
		noun?: string;
	} = $props();

	const COUNT_LABELS: [keyof ImportCountsDto, string][] = $derived([
		['new', 'New'],
		['updated', 'Updated'],
		['typeChanged', 'Type changed'],
		['restored', 'Restored'],
		['unchanged', 'Unchanged'],
		['absent', `Not in this ${noun}`],
		['archivedMissing', 'To archive']
	]);

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

<section
	class="callout panel preview"
	class:preview--stale={stale}
	aria-labelledby="preview-heading"
>
	<h2 id="preview-heading">
		{plan.deck.action === 'created' ? 'New deck' : 'Updating deck'}: {plan.deck.title}
	</h2>
	{#if stale}
		<p class="muted">{staleMessage}</p>
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
								{card.progressLost} review {card.progressLost === 1 ? 'item' : 'items'} with history will
								be erased.
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
		<h3>Not in this {noun} ({plan.counts.absent})</h3>
		<p class="muted small">
			{#if plan.archiveMissing}
				These cards will be archived: kept with their history, but no longer studied.
			{:else}
				These cards stay exactly as they are. To archive them, tick “Archive cards that are not in
				this file” and preview again.
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

<style>
	.small {
		font-size: var(--text-sm);
	}

	.preview > :global(* + *) {
		margin-block-start: var(--space-4);
	}

	.preview--stale {
		border-style: dashed;
	}

	.tally {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(6.5rem, 1fr));
		gap: var(--space-3);
		margin: 0;
	}

	.tally > div {
		padding: var(--space-3) var(--space-4);
		border-radius: var(--radius);
		background: var(--color-sunken);
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
		background: var(--color-hard-soft);
	}

	.changes {
		margin: 0;
		padding: 0 var(--space-3);
		list-style: none;
		max-height: 18rem;
		overflow-y: auto;
		border: 1px solid var(--color-rule);
		border-radius: var(--radius);
		background: var(--color-paper);
	}

	.changes li {
		padding-block: var(--space-3);
		border-block-end: 1px solid var(--color-rule);
	}

	.changes li:last-child {
		border-block-end: 0;
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
		border-radius: var(--radius-sm);
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
</style>
