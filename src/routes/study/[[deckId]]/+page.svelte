<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import type {
		NextResponse,
		QueueCounts,
		ReviewRequest,
		StudyItemDto
	} from '#lib/core/api-types.ts';
	import type { Grade } from '#lib/core/scheduler/types.ts';
	import { ApiError, api } from '#lib/ui/api.ts';
	import { cardSides } from '#lib/ui/card-sides.ts';
	import { newId } from '#lib/ui/id.ts';
	import Markdown from '#lib/ui/Markdown.svelte';
	import {
		checkChoice,
		checkTyped,
		choiceView,
		typedAnswers,
		type Outcome
	} from '#lib/ui/study-card.ts';

	type Phase = 'loading' | 'front' | 'back' | 'submitting' | 'done' | 'error';

	const GRADE_INFO: { grade: Grade; name: string; key: string }[] = [
		{ grade: 1, name: 'Again', key: '1' },
		{ grade: 2, name: 'Hard', key: '2' },
		{ grade: 3, name: 'Good', key: '3' },
		{ grade: 4, name: 'Easy', key: '4' }
	];
	const CATEGORY_LABEL = { new: 'New', learning: 'Learning', review: 'Review' } as const;

	const deckId = $derived(page.params.deckId);

	let phase = $state<Phase>('loading');
	let item = $state<StudyItemDto | undefined>();
	let counts = $state<QueueCounts>({ learning: 0, review: 0, new: 0 });
	let waitingUntil = $state<string | null>(null);
	let errorMessage = $state<string | undefined>();
	let notice = $state<string | undefined>();
	let showHint = $state(false);
	let answered = $state<Record<Grade, number>>({ 1: 0, 2: 0, 3: 0, 4: 0 });

	// A new id for every card shown. Retrying a failed submission reuses it, so a grade is never
	// recorded twice (the server replays the stored result).
	let reviewId = '';
	let shownAt = 0;
	let pending: ReviewRequest | undefined;

	// A typed card's answer box, and what an attempt at a typed or choice card turned out to be.
	let typedInput = $state('');
	let outcome = $state<Outcome | undefined>();

	let cardEl = $state<HTMLElement>();
	let typedEl = $state<HTMLInputElement>();
	let gradesEl = $state<HTMLElement>();

	const sides = $derived(item ? cardSides(item) : undefined);
	const choices = $derived(item?.type === 'choice' ? choiceView(item) : undefined);
	const typed = $derived(item?.type === 'typed' ? typedAnswers(item) : undefined);
	// The grade Space and Enter give: the suggestion after an attempt, otherwise Good.
	const defaultGrade = $derived<Grade>(outcome?.suggestedGrade ?? 3);
	const defaultName = $derived(GRADE_INFO.find((info) => info.grade === defaultGrade)!.name);
	const total = $derived(answered[1] + answered[2] + answered[3] + answered[4]);
	const deckLabel = $derived(item?.deckTitle ?? 'All decks');

	async function apply(response: NextResponse) {
		counts = response.counts;
		if (response.done) {
			item = undefined;
			waitingUntil = response.waitingUntil;
			phase = 'done';
			return;
		}
		item = response.item;
		reviewId = newId();
		shownAt = performance.now();
		showHint = false;
		typedInput = '';
		outcome = undefined;
		phase = 'front';
		await tick();
		// A typed card starts in its answer box, so the learner can type straight away.
		if (item.type === 'typed') typedEl?.focus();
		else cardEl?.focus();
	}

	async function load() {
		phase = 'loading';
		errorMessage = undefined;
		try {
			await apply(await api.studyNext(deckId));
		} catch (error) {
			errorMessage =
				error instanceof ApiError ? error.message : 'Something went wrong loading the next card.';
			phase = 'error';
		}
	}

	// Shows the answer. For a typed or choice card that was not attempted, the result is "no answer given",
	// which suggests Again. The learner can still pick any grade.
	async function reveal(attempt?: Outcome) {
		if (phase !== 'front' || !item) return;
		outcome =
			attempt ??
			(item.type === 'typed'
				? checkTyped(item, typedInput)
				: choices
					? checkChoice(choices, undefined)
					: undefined);
		phase = 'back';
		await tick();
		gradesEl?.querySelector<HTMLButtonElement>(`.grade--${defaultGrade}`)?.focus();
	}

	function checkAnswer() {
		if (item?.type === 'typed') void reveal(checkTyped(item, typedInput));
	}

	function pick(position: number) {
		if (phase !== 'front' || !choices) return;
		void reveal(checkChoice(choices, position));
	}

	async function submit(request: ReviewRequest) {
		phase = 'submitting';
		pending = request;
		try {
			const response = await api.review(request);
			answered[request.grade] += 1;
			pending = undefined;
			notice = undefined;
			await apply(response.next);
		} catch (error) {
			if (error instanceof ApiError && error.code === 'stale_review') {
				pending = undefined;
				notice = 'That card was already answered somewhere else. Here is the next one.';
				await load();
				return;
			}
			errorMessage = error instanceof ApiError ? error.message : 'Your answer could not be saved.';
			phase = 'error';
		}
	}

	function grade(value: Grade) {
		if (phase !== 'back' || !item) return;
		void submit({
			reviewId,
			cardPk: item.cardPk,
			ordinal: item.ordinal,
			grade: value,
			servedAt: item.servedAt,
			durationMs: Math.min(3_600_000, Math.round(performance.now() - shownAt)),
			...(outcome?.typed ? { typedAnswer: outcome.typed.slice(0, 2000) } : {}),
			...(deckId ? { deckId } : {})
		});
	}

	function retry() {
		if (pending) void submit(pending);
		else void load();
	}

	function onKey(event: KeyboardEvent) {
		if (event.defaultPrevented || event.repeat || event.metaKey || event.ctrlKey || event.altKey)
			return;
		const target = event.target as HTMLElement | null;
		if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
		const onControl = Boolean(target?.closest('button, a'));

		if (phase === 'front') {
			const choiceKey = choices && /^[1-9]$/.test(event.key) ? Number(event.key) - 1 : -1;
			if (choiceKey >= 0 && choices && choiceKey < choices.shown.length) {
				event.preventDefault();
				pick(choiceKey);
			} else if ((event.key === ' ' || event.key === 'Enter') && !onControl) {
				event.preventDefault();
				void reveal();
			} else if (event.key.toLowerCase() === 'h' && sides?.hint) {
				showHint = !showHint;
			}
		} else if (phase === 'back') {
			const found = GRADE_INFO.find((info) => info.key === event.key);
			if (found) {
				event.preventDefault();
				grade(found.grade);
			} else if ((event.key === ' ' || event.key === 'Enter') && !onControl) {
				event.preventDefault();
				grade(defaultGrade);
			}
		}
	}

	function waitText(iso: string): string {
		const minutes = Math.max(1, Math.round((new Date(iso).getTime() - Date.now()) / 60_000));
		const at = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(
			new Date(iso)
		);
		return `The next card is due in about ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}, at ${at}.`;
	}

	onMount(load);
</script>

<svelte:head>
	<title>Study · Tessera</title>
</svelte:head>

<svelte:window onkeydown={onKey} />

<div class="page study">
	<header class="top">
		<a class="back muted" href={resolve('/')}>← Decks</a>
		<p class="deck muted">{deckLabel}</p>
		<p class="counts" aria-label="Items left to study">
			{#each [['new', 'New'], ['learning', 'Learning'], ['review', 'Review']] as const as [key, label] (key)}
				<span class="counts__item" class:counts__item--current={item?.category === key}>
					{label} <strong>{counts[key]}</strong>
				</span>
			{/each}
		</p>
	</header>

	<!-- The done screen has its own visible h1. Every other state needs one for heading navigation. -->
	{#if phase !== 'done'}
		<h1 class="sr-only">Studying: {deckLabel}</h1>
	{/if}

	{#if notice}
		<p class="callout" role="status">{notice}</p>
	{/if}

	{#if phase === 'loading'}
		<p class="muted" role="status">Loading your next card…</p>
	{:else if phase === 'error'}
		<div class="callout callout--error" role="alert">
			<p>{errorMessage}</p>
			<p><button type="button" class="btn" onclick={retry}>Try again</button></p>
		</div>
	{:else if phase === 'done'}
		<section class="done" aria-labelledby="done-heading">
			<h1 id="done-heading">{total > 0 ? 'Session complete' : 'Nothing to study right now'}</h1>
			{#if total > 0}
				<p>
					You answered <strong>{total}</strong>
					{total === 1 ? 'card' : 'cards'}: {answered[1]} Again, {answered[2]} Hard, {answered[3]} Good,
					{answered[4]}
					Easy.
				</p>
			{/if}
			{#if waitingUntil}
				<p class="muted">{waitText(waitingUntil)}</p>
			{/if}
			<p class="done__actions">
				{#if waitingUntil}
					<button type="button" class="btn btn--primary" onclick={load}>Check again</button>
				{/if}
				<a class="btn" href={resolve('/')}>All decks</a>
				<a class="btn" href={resolve('/import')}>Import a deck</a>
			</p>
		</section>
	{:else if item && sides}
		<section class="card" bind:this={cardEl} tabindex="-1" aria-label="Flashcard">
			<p class="card__meta">
				<span>{sides.kind}</span>
				<span class="card__category">{CATEGORY_LABEL[item.category]}</span>
			</p>

			<div class="card__front">
				<Markdown source={sides.front} />
			</div>

			{#if typed && (phase === 'front' || phase === 'back' || phase === 'submitting')}
				{#if phase === 'front'}
					<form
						class="typed"
						onsubmit={(event) => {
							event.preventDefault();
							checkAnswer();
						}}
					>
						<label for="typed-answer">Your answer</label>
						<input
							id="typed-answer"
							class="field"
							type="text"
							autocomplete="off"
							autocapitalize="off"
							spellcheck="false"
							bind:value={typedInput}
							bind:this={typedEl}
						/>
						<div class="typed__actions">
							<button type="submit" class="btn btn--primary">Check answer <kbd>Enter</kbd></button>
							<button type="button" class="btn" onclick={() => reveal()}> I don’t know </button>
						</div>
					</form>
				{/if}
			{/if}

			{#if choices}
				<ol class="choices" aria-label="Choices">
					{#each choices.shown as choice, position (position)}
						{@const chosen = outcome?.position === position}
						{@const right = phase !== 'front' && position === choices.correctPosition}
						<li>
							<button
								type="button"
								class="choice"
								class:choice--right={right}
								class:choice--wrong={phase !== 'front' && chosen && !right}
								disabled={phase !== 'front'}
								onclick={() => pick(position)}
							>
								<kbd>{position + 1}</kbd>
								<span class="choice__text"><Markdown source={choice.text} links={false} /></span>
								{#if right}
									<span class="choice__mark">✓ Right answer</span>
								{:else if phase !== 'front' && chosen}
									<span class="choice__mark">✗ Your answer</span>
								{/if}
							</button>
						</li>
					{/each}
				</ol>
			{/if}

			{#if sides.hint && phase === 'front'}
				{#if showHint}
					<p class="hint"><strong>Hint.</strong> {sides.hint}</p>
				{:else}
					<button
						type="button"
						class="btn btn--quiet hint-button"
						onclick={() => (showHint = true)}
					>
						Show hint <kbd>H</kbd>
					</button>
				{/if}
			{/if}

			{#if phase === 'back' || phase === 'submitting'}
				<div class="card__back" aria-live="polite">
					<hr />
					{#if outcome}
						<p class="result" class:result--right={outcome.correct}>
							<strong>{outcome.summary}</strong>
						</p>
					{/if}
					{#if outcome?.typed}
						<p class="yours">You typed: <code>{outcome.typed}</code></p>
					{/if}
					{#if sides.back}
						<Markdown source={sides.back} />
					{/if}
				</div>
			{/if}
		</section>

		{#if phase === 'front'}
			{#if !typed && !choices}
				<div class="reveal">
					<button type="button" class="btn btn--primary btn--wide" onclick={() => reveal()}>
						Show answer <kbd>Space</kbd>
					</button>
				</div>
			{:else if choices}
				<div class="reveal">
					<button type="button" class="btn" onclick={() => reveal()}>I don’t know</button>
					<p class="muted keys">
						Press <kbd>1</kbd> to <kbd>{choices.shown.length}</kbd> to choose.
					</p>
				</div>
			{/if}
		{:else}
			<div
				class="grades"
				role="group"
				aria-label="How well did you remember it?"
				bind:this={gradesEl}
			>
				{#each GRADE_INFO as info (info.grade)}
					<button
						type="button"
						class="btn grade grade--{info.grade}"
						class:grade--suggested={outcome !== undefined && info.grade === defaultGrade}
						disabled={phase === 'submitting'}
						onclick={() => grade(info.grade)}
					>
						<kbd>{info.key}</kbd>
						<span class="grade__tile" aria-hidden="true"></span>
						<span class="grade__name">{info.name}</span>
						<span class="grade__interval">{item.previews[info.grade].label}</span>
					</button>
				{/each}
			</div>
			{#if outcome}
				<p class="suggest">
					Suggested: <strong>{defaultName}</strong>. {outcome.correct
						? 'It was right.'
						: 'It was not right.'} You can pick any grade.
				</p>
			{/if}
			<p class="muted keys">
				Press <kbd>1</kbd> to <kbd>4</kbd> to answer, or <kbd>Space</kbd> for {defaultName}.
			</p>
		{/if}
	{/if}
</div>

<style>
	.study {
		max-width: 46rem;
	}

	.top {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		gap: var(--space-2) var(--space-4);
		align-items: baseline;
		margin-block-end: var(--space-5);
	}

	.back {
		text-decoration: none;
		white-space: nowrap;
	}

	.deck {
		margin: 0;
		overflow: hidden;
		text-align: end;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.counts {
		grid-column: 1 / -1;
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2) var(--space-5);
		margin: 0;
		font-size: var(--text-sm);
		color: var(--color-muted);
	}

	.counts__item strong {
		color: var(--color-ink);
	}

	.counts__item--current {
		color: var(--color-ink);
		box-shadow: inset 0 -2px 0 var(--color-accent);
	}

	.card {
		padding: var(--space-5);
		border: 1px solid var(--color-rule-strong);
		border-radius: var(--radius);
		background: var(--color-surface);
		font-family: var(--font-display);
		font-size: var(--text-card);
		line-height: 1.45;
	}

	@media (min-width: 40rem) {
		.card {
			padding: var(--space-6);
		}
	}

	.card:focus {
		outline: none;
	}

	.card:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: 3px;
	}

	.card__meta {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2) var(--space-4);
		margin: 0 0 var(--space-4);
		color: var(--color-muted);
		font-family: var(--font-body);
		font-size: var(--text-sm);
	}

	.card__category {
		padding-inline-start: var(--space-4);
		border-inline-start: 1px solid var(--color-rule-strong);
	}

	.card__front {
		min-height: 6rem;
	}

	.card__back hr {
		margin: var(--space-5) 0;
		border: 0;
		border-block-start: 1px solid var(--color-rule-strong);
	}

	.typed {
		display: grid;
		gap: var(--space-3);
		margin-block-start: var(--space-4);
		font-family: var(--font-body);
		font-size: var(--text-base);
	}

	.typed label {
		font-weight: 600;
	}

	.typed__actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
	}

	.choices {
		display: grid;
		gap: var(--space-3);
		margin: var(--space-4) 0 0;
		padding: 0;
		list-style: none;
		font-family: var(--font-body);
		font-size: var(--text-base);
	}

	.choice {
		display: flex;
		align-items: baseline;
		flex-wrap: wrap;
		gap: var(--space-2) var(--space-3);
		width: 100%;
		min-height: var(--hit);
		padding: var(--space-3) var(--space-4);
		border: 1px solid var(--color-rule-strong);
		border-radius: var(--radius);
		background: var(--color-paper);
		color: var(--color-ink);
		font: inherit;
		text-align: start;
		cursor: pointer;
	}

	.choice:hover:not(:disabled) {
		border-color: var(--color-accent);
	}

	.choice:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: 2px;
	}

	.choice:disabled {
		cursor: default;
		color: var(--color-ink);
		opacity: 1;
	}

	.choice__text {
		flex: 1 1 10rem;
		min-width: 0;
	}

	.choice--right {
		border-width: 2px;
		border-color: var(--color-accent);
		background: var(--color-accent-soft);
	}

	.choice--wrong {
		border-width: 2px;
		border-color: var(--color-again);
		background: var(--color-error-soft);
	}

	.choice__mark {
		margin-inline-start: auto;
		font-size: var(--text-sm);
		font-weight: 600;
	}

	.result {
		margin-block-end: var(--space-3);
		font-family: var(--font-body);
		font-size: var(--text-base);
	}

	.result--right strong {
		color: var(--color-accent);
	}

	.yours {
		margin-block-end: var(--space-3);
		color: var(--color-muted);
		font-family: var(--font-body);
		font-size: var(--text-base);
	}

	.suggest {
		margin-block-start: var(--space-3);
		font-size: var(--text-sm);
	}

	.grade--suggested {
		border-color: var(--color-accent);
		box-shadow: inset 0 0 0 1px var(--color-accent);
	}

	.hint {
		margin-block-start: var(--space-4);
		color: var(--color-muted);
		font-family: var(--font-body);
		font-size: var(--text-base);
	}

	.hint-button {
		margin-block-start: var(--space-3);
		margin-inline-start: calc(-1 * var(--space-3));
		color: var(--color-muted);
		font-size: var(--text-sm);
	}

	.reveal {
		margin-block-start: var(--space-5);
	}

	/* Full width on a phone so it is an easy thumb target, a compact button on larger screens. */
	.btn--wide {
		width: 100%;
		min-height: 3.25rem;
	}

	@media (min-width: 40rem) {
		.btn--wide {
			width: auto;
			min-width: 14rem;
		}
	}

	.grades {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: var(--space-3);
		margin-block-start: var(--space-5);
	}

	@media (min-width: 40rem) {
		.grades {
			grid-template-columns: repeat(4, minmax(0, 1fr));
		}
	}

	.grade {
		justify-content: flex-start;
		gap: var(--space-2);
		min-height: 3.25rem;
		padding-inline: var(--space-3);
	}

	.grade kbd {
		min-width: 1.5em;
	}

	.grade__tile {
		flex: none;
		width: 0.625rem;
		height: 0.625rem;
		border-radius: 2px;
		background: var(--color-muted);
	}

	.grade--1 .grade__tile {
		background: var(--color-again);
	}

	.grade--2 .grade__tile {
		background: var(--color-hard);
	}

	.grade--3 .grade__tile {
		background: var(--color-good);
	}

	.grade--4 .grade__tile {
		background: var(--color-easy);
	}

	.grade__name {
		min-width: 0;
	}

	.grade__interval {
		margin-inline-start: auto;
		color: var(--color-muted);
		font-variant-numeric: tabular-nums;
	}

	.keys {
		margin-block-start: var(--space-3);
		font-size: var(--text-sm);
	}

	.done > * + * {
		margin-block-start: var(--space-4);
	}

	.done__actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
	}
</style>
