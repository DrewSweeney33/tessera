<script lang="ts">
	import { untrack } from 'svelte';
	import type { DeckCardDto } from '#lib/core/api-types.ts';
	import { listClozeOrdinals } from '#lib/core/cloze.ts';
	import { LIMITS } from '#lib/core/schema/limits.ts';
	import type { EditProblem } from '#lib/core/deck-edit.ts';
	import { baseField, cardFieldElementId } from './card-fields.ts';
	import { cardSides } from './card-sides.ts';
	import Markdown from './Markdown.svelte';

	// The fields of one card, with a live preview of how it will look when studied. The card's type is fixed: changing
	// a card's type would erase its history, so the page offers "remove and add" instead.
	let {
		card,
		onset,
		problems = [],
		showProblems = false
	}: {
		card: DeckCardDto;
		// Asked to change a field. The page owns the deck being edited, so it makes the change.
		onset: (field: string, value: unknown) => void;
		problems?: EditProblem[];
		// True once a save has been tried, so every problem shows, not only those on fields already visited.
		showProblems?: boolean;
	} = $props();

	let touched = $state<Record<string, boolean>>({});
	const touch = (field: string) => (touched[field] = true);

	const MAX_PREVIEWS = 4;

	const idOf = (field: string) => cardFieldElementId(card.id, field);
	const text = (field: string) => (typeof card[field] === 'string' ? (card[field] as string) : '');
	const set = (field: string, value: unknown) => onset(field, value);

	// A problem shows once its field has been visited (or a save was tried), never on a card nobody has touched.
	const shown = (field: string): EditProblem | undefined =>
		problems.find(
			(problem) =>
				problem.field === field &&
				(showProblems ||
					touched[baseField(problem.field)] ||
					(problem.field === 'correct' && touched['choices']))
		);

	const choices = $derived(Array.isArray(card['choices']) ? (card['choices'] as string[]) : []);
	const correct = $derived(typeof card['correct'] === 'number' ? card['correct'] : -1);
	const acceptText = $derived(
		Array.isArray(card['accept']) ? (card['accept'] as string[]).join('\n') : ''
	);
	// Kept as typed. Rebuilding it from the tags on every keystroke would move the cursor while typing a comma.
	let tagsText = $state(
		untrack(() => (Array.isArray(card['tags']) ? (card['tags'] as string[]).join(', ') : ''))
	);

	const setChoice = (index: number, value: string) => {
		const next = [...choices];
		next[index] = value;
		set('choices', next);
	};
	const addChoice = () => {
		set('choices', [...choices, '']);
		touch('choices');
	};
	const removeChoice = (index: number) => {
		set(
			'choices',
			choices.filter((_, i) => i !== index)
		);
		// The right answer keeps pointing at the same choice, or at the one before it if that one was removed.
		if (correct > index) set('correct', correct - 1);
		else if (correct === index) set('correct', 0);
		touch('choices');
	};

	const previews = $derived.by(() => {
		const ordinals = card.type === 'cloze' ? listClozeOrdinals(text('text')) : [1];
		return {
			total: ordinals.length,
			items: ordinals.slice(0, MAX_PREVIEWS).map((ordinal) => ({
				ordinal,
				sides: cardSides({ type: card.type, content: card, ordinal })
			}))
		};
	});

	const describedBy = (field: string, ...extra: string[]) =>
		[...extra, shown(field) ? `${idOf(field)}-problem` : undefined].filter(Boolean).join(' ') ||
		undefined;
</script>

{#snippet problem(field: string)}
	{#if shown(field)}
		<p id="{idOf(field)}-problem" class="problem">{shown(field)?.message}</p>
	{/if}
{/snippet}

<!-- A text field of the card, with its label, a note beside the label, and its problem. -->
{#snippet textField(field: string, label: string, note: string, rows: number)}
	<div class="stack">
		<label for={idOf(field)}>{label} <span class="muted">({note})</span></label>
		<textarea
			id={idOf(field)}
			class="field field--text"
			{rows}
			value={text(field)}
			oninput={(event) => set(field, event.currentTarget.value)}
			onblur={() => touch(field)}
			aria-invalid={shown(field) ? 'true' : undefined}
			aria-describedby={describedBy(field)}></textarea>
		{@render problem(field)}
	</div>
{/snippet}

<div class="editor stack">
	{#if card.type === 'basic'}
		{@render textField('front', 'Front', 'Markdown', 3)}
		{@render textField('back', 'Back', 'Markdown', 3)}
	{:else if card.type === 'cloze'}
		<div class="stack">
			<label for={idOf('text')}>Text with blanks <span class="muted">(Markdown)</span></label>
			<textarea
				id={idOf('text')}
				class="field field--text"
				rows="4"
				value={text('text')}
				oninput={(event) => set('text', event.currentTarget.value)}
				onblur={() => touch('text')}
				aria-invalid={shown('text') ? 'true' : undefined}
				aria-describedby={describedBy('text', `${idOf('text')}-help`)}></textarea>
			<p id="{idOf('text')}-help" class="muted small">
				Wrap each blank like <code>{'{{c1::answer}}'}</code>. A hint goes after a second
				<code>::</code>. Each number is studied on its own.
			</p>
			{@render problem('text')}
		</div>
		{@render textField('extra', 'Extra', 'optional, shown after the answer', 2)}
	{:else if card.type === 'typed'}
		{@render textField('front', 'Question', 'Markdown', 3)}
		<div class="stack">
			<label for={idOf('answer')}>Answer to type</label>
			<input
				id={idOf('answer')}
				class="field field--text"
				type="text"
				value={text('answer')}
				oninput={(event) => set('answer', event.currentTarget.value)}
				onblur={() => touch('answer')}
				autocomplete="off"
				aria-invalid={shown('answer') ? 'true' : undefined}
				aria-describedby={describedBy('answer')}
			/>
			{@render problem('answer')}
		</div>
		<div class="stack">
			<label for={idOf('accept')}
				>Also accepted <span class="muted">(optional, one per line)</span></label
			>
			<textarea
				id={idOf('accept')}
				class="field field--text"
				rows="2"
				value={acceptText}
				oninput={(event) => set('accept', event.currentTarget.value.split('\n'))}
				onblur={() => touch('accept')}
				aria-invalid={shown('accept') ? 'true' : undefined}
				aria-describedby={describedBy('accept')}></textarea>
			{@render problem('accept')}
		</div>
	{:else if card.type === 'choice'}
		{@render textField('front', 'Question', 'Markdown', 3)}

		<fieldset class="choices stack">
			<legend>Choices <span class="muted">(select the correct one)</span></legend>
			{#each choices as choice, index (index)}
				<div class="choice">
					<input
						id="card-{card.id}-correct-{index}"
						type="radio"
						name="correct-{card.id}"
						checked={correct === index}
						onchange={() => {
							set('correct', index);
							touch('correct');
						}}
						aria-label="Choice {index + 1} is correct"
					/>
					<input
						id={idOf(`choices[${index}]`)}
						class="field field--text"
						type="text"
						value={choice}
						oninput={(event) => setChoice(index, event.currentTarget.value)}
						onblur={() => touch('choices')}
						autocomplete="off"
						aria-label="Choice {index + 1}"
						aria-invalid={shown(`choices[${index}]`) ? 'true' : undefined}
						aria-describedby={describedBy(`choices[${index}]`)}
					/>
					<button
						type="button"
						class="btn btn--quiet"
						disabled={choices.length <= LIMITS.minChoices}
						onclick={() => removeChoice(index)}
						aria-label="Remove choice {index + 1}"
					>
						Remove
					</button>
					{@render problem(`choices[${index}]`)}
				</div>
			{/each}
			{@render problem('choices')}
			{@render problem('correct')}
			<p>
				<button
					type="button"
					class="btn"
					disabled={choices.length >= LIMITS.maxChoices}
					onclick={addChoice}
				>
					Add a choice
				</button>
			</p>
		</fieldset>

		{@render textField('explanation', 'Explanation', 'optional, shown after answering', 2)}
	{/if}

	<div class="stack">
		<label for={idOf('hint')}>Hint <span class="muted">(optional)</span></label>
		<input
			id={idOf('hint')}
			class="field field--text"
			type="text"
			value={text('hint')}
			oninput={(event) => set('hint', event.currentTarget.value)}
			onblur={() => touch('hint')}
			autocomplete="off"
			aria-invalid={shown('hint') ? 'true' : undefined}
			aria-describedby={describedBy('hint')}
		/>
		{@render problem('hint')}
	</div>

	<div class="stack">
		<label for={idOf('tags')}>Tags <span class="muted">(optional, separated by commas)</span></label
		>
		<input
			id={idOf('tags')}
			class="field field--text"
			type="text"
			value={tagsText}
			oninput={(event) => {
				tagsText = event.currentTarget.value;
				set('tags', tagsText.split(','));
			}}
			onblur={() => touch('tags')}
			autocomplete="off"
			aria-invalid={shown('tags') ? 'true' : undefined}
			aria-describedby={describedBy('tags')}
		/>
		{@render problem('tags')}
	</div>

	<div class="preview">
		<h3 class="preview__title">How it will look</h3>
		{#if previews.items.length === 0}
			<p class="muted small">Add a blank like <code>{'{{c1::answer}}'}</code> to see the card.</p>
		{/if}
		{#each previews.items as item (item.ordinal)}
			<div class="preview__card">
				{#if card.type === 'cloze' && previews.total > 1}
					<p class="muted small">Blank {item.ordinal}</p>
				{/if}
				<div class="preview__side">
					<span class="preview__tag">Question</span>
					<div class="preview__body"><Markdown source={item.sides.front} /></div>
				</div>
				{#if card.type === 'choice'}
					<ol class="preview__choices">
						{#each choices as choice, index (index)}
							<li class:preview__right={index === correct}>
								<Markdown source={choice} inline />
								{#if index === correct}<span class="muted small"> (correct)</span>{/if}
							</li>
						{/each}
					</ol>
				{/if}
				{#if item.sides.back.trim() !== ''}
					<div class="preview__side">
						<span class="preview__tag">Answer</span>
						<div class="preview__body"><Markdown source={item.sides.back} /></div>
					</div>
				{/if}
			</div>
		{/each}
		{#if previews.total > MAX_PREVIEWS}
			<p class="muted small">…and {previews.total - MAX_PREVIEWS} more blanks.</p>
		{/if}
	</div>
</div>

<style>
	.small {
		font-size: var(--text-sm);
	}

	.problem {
		color: var(--color-error);
		font-size: var(--text-sm);
	}

	.stack > :global(* + *) {
		margin-block-start: var(--space-2);
	}

	.editor > :global(* + *) {
		margin-block-start: var(--space-4);
	}

	.choices {
		margin: 0;
		padding: 0;
		border: 0;
		min-width: 0;
	}

	.choices legend {
		padding: 0;
		font-weight: 500;
	}

	.choice {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) auto;
		gap: var(--space-2) var(--space-3);
		align-items: center;
	}

	.choice > :global(.problem) {
		grid-column: 2 / -1;
	}

	.preview {
		padding: var(--space-4);
		border: 1px dashed var(--color-rule-strong);
		border-radius: var(--radius-lg);
		background: var(--color-sunken);
	}

	.preview__title {
		margin: 0 0 var(--space-3);
		font-size: var(--text-sm);
		color: var(--color-muted);
		font-weight: 500;
	}

	.preview__card + .preview__card {
		margin-block-start: var(--space-4);
		padding-block-start: var(--space-4);
		border-block-start: 1px solid var(--color-rule);
	}

	.preview__side {
		display: grid;
		grid-template-columns: 5rem minmax(0, 1fr);
		gap: var(--space-3);
	}

	.preview__side + .preview__side,
	.preview__choices {
		margin-block-start: var(--space-3);
	}

	.preview__tag {
		color: var(--color-muted);
		font-size: var(--text-sm);
	}

	.preview__body {
		min-width: 0;
		overflow-wrap: anywhere;
	}

	.preview__choices {
		margin-inline: 0;
		padding-inline-start: 1.6em;
	}

	.preview__right {
		font-weight: 600;
	}
</style>
