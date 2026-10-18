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
	import { ApiError, api, failureMessage } from '#lib/ui/api.ts';
	import { cardSides } from '#lib/ui/card-sides.ts';
	import Icon from '#lib/ui/Icon.svelte';
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
	// A session can also be limited to the decks in one folder: /study?folder=3.
	const folderId = $derived.by(() => {
		const text = page.url.searchParams.get('folder');
		return text !== null && /^[1-9][0-9]{0,8}$/.test(text) ? Number(text) : undefined;
	});
	let folderName = $state<string | undefined>();

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
	const deckLabel = $derived(
		folderId !== undefined
			? `${folderName ?? 'Folder'}${item ? ` · ${item.deckTitle}` : ''}`
			: (item?.deckTitle ?? 'All decks')
	);
	// How far through this session: answered so far, out of answered plus what is still waiting (the card on screen
	// counts as waiting). A lapse can put a card back, so the bar can step back a little, which is honest.
	const waiting = $derived(counts.new + counts.learning + counts.review);
	const progress = $derived(total + waiting === 0 ? 0 : total / (total + waiting));

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
			await apply(await api.studyNext({ deckId, folderId }));
		} catch (error) {
			errorMessage = failureMessage(error, 'Something went wrong loading the next card.');
			phase = 'error';
		}
	}

	// The result when the answer is shown without an attempt: a typed card is checked as it stands, a choice card
	// counts as no choice made, and any other card has none.
	function unattempted(card: StudyItemDto): Outcome | undefined {
		if (card.type === 'typed') return checkTyped(card, typedInput);
		return choices ? checkChoice(choices, undefined) : undefined;
	}

	// Shows the answer. For a typed or choice card that was not attempted, the result is "no answer given",
	// which suggests Again. The learner can still pick any grade.
	async function reveal(attempt?: Outcome) {
		if (phase !== 'front' || !item) return;
		outcome = attempt ?? unattempted(item);
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
			errorMessage = failureMessage(error, 'Your answer could not be saved.');
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
			...(deckId ? { deckId } : {}),
			...(folderId !== undefined ? { folderId } : {})
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

	// The name shown for a folder session. It is only a label, so a failure here is not worth an error.
	async function loadFolderName() {
		if (folderId === undefined) return;
		try {
			folderName = (await api.folders()).folders.find((folder) => folder.id === folderId)?.name;
		} catch {
			folderName = undefined;
		}
	}

	onMount(() => {
		void loadFolderName();
		void load();
	});
</script>

<svelte:head>
	<title>Study · Tessera</title>
</svelte:head>

<svelte:window onkeydown={onKey} />

<div class="page study">
	<header class="top">
		<a class="back" href={resolve('/')}><Icon name="back" size="1.1em" /> Decks</a>
		<p class="deck">{deckLabel}</p>
		<p class="counts" aria-label="Items left to study">
			{#each [['new', 'New'], ['learning', 'Learning'], ['review', 'Review']] as const as [key, label] (key)}
				<span class="counts__item" class:counts__item--current={item?.category === key}>
					{label} <strong>{counts[key]}</strong>
				</span>
			{/each}
		</p>
		<div
			class="progress"
			role="progressbar"
			aria-label="Session progress"
			aria-valuemin="0"
			aria-valuemax="100"
			aria-valuenow={Math.round(progress * 100)}
		>
			<span class="progress__fill" style:transform="scaleX({progress})"></span>
		</div>
	</header>

	<!-- The done screen has its own visible h1. Every other state needs one for heading navigation. -->
	{#if phase !== 'done'}
		<h1 class="sr-only">Studying: {deckLabel}</h1>
	{/if}

	{#if notice}
		<p class="callout" role="status">{notice}</p>
	{/if}

	{#if phase === 'loading'}
		<p class="sr-only" role="status">Loading your next card…</p>
		<div class="sheet sheet--loading" aria-hidden="true">
			<div class="skeleton-line skeleton-line--short"></div>
			<div class="skeleton-line"></div>
			<div class="skeleton-line"></div>
		</div>
	{:else if phase === 'error'}
		<div class="callout callout--error" role="alert">
			<p>{errorMessage}</p>
			<p class="retry"><button type="button" class="btn" onclick={retry}>Try again</button></p>
		</div>
	{:else if phase === 'done'}
		<section class="done" aria-labelledby="done-heading">
			<span class="done__seal" aria-hidden="true">
				<Icon name="check" size="2.25rem" />
			</span>
			<h1 id="done-heading">{total > 0 ? 'Session complete' : 'Nothing to study right now'}</h1>
			{#if total > 0}
				<ul class="done__tally" aria-hidden="true">
					{#each GRADE_INFO as info (info.grade)}
						<li class="done__tile done__tile--{info.grade}">
							<strong>{answered[info.grade]}</strong>
							<span>{info.name}</span>
						</li>
					{/each}
				</ul>
				<p class="done__text">
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
		<section class="card sheet" bind:this={cardEl} tabindex="-1" aria-label="Flashcard">
			<p class="card__meta">
				<span class="card__kind">{sides.kind}</span>
				<span class="card__category card__category--{item.category}"
					>{CATEGORY_LABEL[item.category]}</span
				>
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
							class="field typed__input"
							type="text"
							autocomplete="off"
							autocapitalize="off"
							spellcheck="false"
							enterkeyhint="done"
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
						<Icon name="hint" size="1.1em" /> Show hint <kbd>H</kbd>
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

		<div class="dock">
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
				{#if outcome}
					<p class="suggest">
						Suggested: <strong>{defaultName}</strong>. {outcome.correct
							? 'It was right.'
							: 'It was not right.'} You can pick any grade.
					</p>
				{/if}
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
				<p class="muted keys">
					Press <kbd>1</kbd> to <kbd>4</kbd> to answer, or <kbd>Space</kbd> for {defaultName}.
				</p>
			{/if}
		</div>
	{/if}
</div>

<style>
	.study {
		display: flex;
		flex-direction: column;
		width: min(100% - 2 * var(--gutter), 46rem);
		min-height: 100dvh;
		padding-block: var(--space-3) 0;
	}

	@media (min-width: 64rem) {
		.study {
			padding-block-start: var(--space-6);
		}
	}

	.top {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		gap: var(--space-2) var(--space-4);
		align-items: center;
		margin-block-end: var(--space-4);
	}

	.back {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		min-height: var(--hit);
		margin-inline-start: calc(-1 * var(--space-2));
		padding-inline: var(--space-2);
		border-radius: var(--radius);
		color: var(--color-muted);
		text-decoration: none;
		white-space: nowrap;
	}

	.back:hover {
		background: var(--color-sunken);
		color: var(--color-ink);
	}

	.deck {
		margin: 0;
		overflow: hidden;
		color: var(--color-muted);
		font-weight: 500;
		text-align: end;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.counts {
		grid-column: 1 / -1;
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		margin: 0;
		font-size: var(--text-sm);
		color: var(--color-muted);
	}

	.counts__item {
		padding: 0.1rem 0.7rem;
		border-radius: 999px;
		background: var(--color-sunken);
	}

	.counts__item strong {
		color: var(--color-ink);
	}

	.counts__item--current {
		background: var(--color-accent-soft);
		color: var(--color-ink);
		box-shadow: inset 0 0 0 1.5px var(--color-accent);
	}

	.progress {
		grid-column: 1 / -1;
		height: 0.375rem;
		overflow: hidden;
		border-radius: 999px;
		/* A track the eye can find in dark mode too: the plain sunken colour is nearly the page colour there. */
		background: color-mix(in oklch, var(--color-ink) 16%, var(--color-sunken));
	}

	.progress__fill {
		display: block;
		width: 100%;
		height: 100%;
		border-radius: 999px;
		background: linear-gradient(90deg, var(--color-accent-deep), var(--color-accent));
		transform-origin: left center;
		transition: transform var(--dur-slow) var(--ease-out);
	}

	.retry {
		margin-block-start: var(--space-3);
	}

	/* The card: a raised sheet of paper. The reading serif is for the words on it only. */
	.sheet {
		position: relative;
		padding: var(--space-5);
		border: 1px solid var(--color-rule);
		border-radius: var(--radius-xl);
		background: var(--color-surface);
		box-shadow: var(--shadow-3);
		font-family: var(--font-display);
		font-size: var(--text-card);
		line-height: 1.45;
		animation: card-in var(--dur-slow) var(--ease-out);
	}

	@keyframes card-in {
		from {
			transform: translateY(10px) scale(0.985);
		}
	}

	@media (min-width: 40rem) {
		.sheet {
			padding: var(--space-6);
		}
	}

	.sheet:focus {
		outline: none;
	}

	.sheet:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: 3px;
	}

	.sheet--loading {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--space-4);
		min-height: 14rem;
		animation: none;
	}

	.skeleton-line {
		height: 1.25rem;
		border-radius: var(--radius-sm);
		background: linear-gradient(
			100deg,
			var(--color-sunken) 30%,
			var(--color-raised) 50%,
			var(--color-sunken) 70%
		);
		background-size: 200% 100%;
		animation: shimmer 1.4s linear infinite;
	}

	.skeleton-line--short {
		width: 40%;
	}

	@keyframes shimmer {
		to {
			background-position: -200% 0;
		}
	}

	.card__meta {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		margin: 0 0 var(--space-4);
		font-family: var(--font-body);
		font-size: var(--text-xs);
		font-weight: 600;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}

	.card__kind,
	.card__category {
		padding: 0.15rem 0.7rem;
		border-radius: 999px;
		background: var(--color-sunken);
		color: var(--color-muted);
	}

	.card__category--new {
		background: var(--color-easy-soft);
		color: var(--color-new);
	}

	.card__category--learning {
		background: var(--color-hard-soft);
		color: var(--color-learning);
	}

	.card__category--review {
		background: var(--color-accent-soft);
		color: var(--color-review);
	}

	.card__front {
		min-height: 5rem;
	}

	.card__back {
		animation: reveal var(--dur-slow) var(--ease-out);
	}

	@keyframes reveal {
		from {
			transform: translateY(8px);
		}
	}

	.card__back hr {
		margin: var(--space-5) 0;
		border: 0;
		border-block-start: 2px dashed var(--color-rule);
	}

	.typed {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--space-3);
		margin-block-start: var(--space-4);
		font-family: var(--font-body);
		font-size: var(--text-base);
	}

	.typed label {
		font-weight: 600;
	}

	.typed__input {
		min-height: 3.25rem;
		font-family: var(--font-body);
		font-size: 1.0625rem;
	}

	.typed__actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
	}

	.choices {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--space-3);
		margin: var(--space-4) 0 0;
		padding: 0;
		list-style: none;
		font-family: var(--font-body);
		font-size: var(--text-base);
	}

	.choice {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: var(--space-2) var(--space-3);
		width: 100%;
		min-height: 3.25rem;
		padding: var(--space-3) var(--space-4);
		border: 1.5px solid var(--color-rule);
		border-radius: var(--radius);
		background: var(--color-raised);
		color: var(--color-ink);
		box-shadow: var(--shadow-1);
		font: inherit;
		text-align: start;
		cursor: pointer;
		touch-action: manipulation;
		transition:
			border-color var(--dur-fast) var(--ease-out),
			transform var(--dur-fast) var(--ease-out),
			background-color var(--dur-fast) var(--ease-out);
	}

	.choice:hover:not(:disabled) {
		border-color: var(--color-accent);
		background: var(--color-accent-soft);
	}

	.choice:active:not(:disabled) {
		transform: scale(0.99);
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
		border-color: var(--color-accent);
		background: var(--color-accent-soft);
		box-shadow: inset 0 0 0 1px var(--color-accent);
	}

	.choice--wrong {
		border-color: var(--color-again);
		background: var(--color-error-soft);
		box-shadow: inset 0 0 0 1px var(--color-again);
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

	.hint {
		margin-block-start: var(--space-4);
		padding: var(--space-3) var(--space-4);
		border: 1px solid color-mix(in oklch, var(--color-hard) 50%, transparent);
		border-radius: var(--radius);
		background: var(--color-hard-soft);
		font-family: var(--font-body);
		font-size: var(--text-base);
	}

	.hint-button {
		margin-block-start: var(--space-3);
		margin-inline-start: calc(-1 * var(--space-3));
		color: var(--color-muted);
		font-family: var(--font-body);
		font-size: var(--text-sm);
	}

	/* The dock holds the one thing to do next. On a phone it stays at the bottom, in reach of a thumb. */
	.dock {
		position: sticky;
		inset-block-end: 0;
		z-index: 10;
		margin-block-start: auto;
		padding-block: var(--space-5) calc(var(--space-3) + env(safe-area-inset-bottom));
		background: linear-gradient(to top, var(--color-paper) 72%, transparent);
	}

	.reveal {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-3);
	}

	/* Full width on a phone so it is an easy thumb target, a compact button on larger screens. */
	.btn--wide {
		width: 100%;
		min-height: 3.5rem;
		border-radius: var(--radius-lg);
		font-size: 1.0625rem;
	}

	@media (min-width: 40rem) {
		.btn--wide {
			width: auto;
			min-width: 16rem;
		}
	}

	.suggest {
		margin-block-end: var(--space-3);
		font-size: var(--text-sm);
	}

	.grades {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: var(--space-2);
	}

	.grade {
		position: relative;
		flex-direction: column;
		justify-content: center;
		gap: 2px;
		min-height: 4rem;
		padding: var(--space-2) 2px;
		overflow: hidden;
		border-radius: var(--radius-lg);
		line-height: 1.2;
	}

	/* The coloured edge: each grade has its colour, and also its name and interval, so colour is never alone. */
	.grade::after {
		content: '';
		position: absolute;
		inset-inline: 0;
		inset-block-end: 0;
		height: 4px;
		background: var(--grade-colour, var(--color-muted));
	}

	.grade--1 {
		--grade-colour: var(--color-again);
		background: var(--color-again-soft);
	}

	.grade--2 {
		--grade-colour: var(--color-hard);
		background: var(--color-hard-soft);
	}

	.grade--3 {
		--grade-colour: var(--color-good);
		background: var(--color-accent-soft);
	}

	.grade--4 {
		--grade-colour: var(--color-easy);
		background: var(--color-easy-soft);
	}

	.grade:hover:not(:disabled) {
		background: var(--color-raised);
	}

	.grade--suggested {
		border-color: var(--grade-colour);
		box-shadow:
			0 0 0 2px var(--grade-colour),
			var(--shadow-2);
	}

	/* Keys are for keyboards. A phone does not need to be told about them. */
	.grade kbd,
	.grade__tile {
		display: none;
	}

	.grade__name {
		min-width: 0;
		font-weight: 600;
	}

	.grade__interval {
		color: var(--color-muted);
		font-size: var(--text-sm);
		font-variant-numeric: tabular-nums;
	}

	.keys {
		display: none;
		margin-block-start: var(--space-3);
		font-size: var(--text-sm);
	}

	@media (hover: hover) and (pointer: fine) {
		.keys {
			display: block;
		}

		.grade kbd {
			display: inline-block;
			position: absolute;
			inset-block-start: 6px;
			inset-inline-start: 6px;
			min-width: 0;
			padding: 0 0.35em;
			font-size: 0.6875rem;
			line-height: 1.4;
		}
	}

	@media (max-width: 22rem) {
		.grade__interval {
			font-size: var(--text-xs);
		}
	}

	.done {
		display: grid;
		justify-items: center;
		gap: var(--space-4);
		margin-block: auto;
		padding-block: var(--space-6);
		text-align: center;
	}

	.done__seal {
		display: grid;
		place-items: center;
		width: 5rem;
		height: 5rem;
		border-radius: 50%;
		background: linear-gradient(135deg, var(--color-accent), var(--color-accent-deep));
		color: var(--color-accent-ink);
		box-shadow: var(--shadow-3);
		animation: seal var(--dur-slow) var(--ease-spring);
	}

	@keyframes seal {
		from {
			transform: scale(0.6);
		}
	}

	.done__tally {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 5.5rem));
		gap: var(--space-2);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.done__tile {
		display: grid;
		gap: 2px;
		padding: var(--space-3) var(--space-1);
		border-radius: var(--radius);
		background: var(--color-sunken);
		font-size: var(--text-sm);
	}

	.done__tile strong {
		font-family: var(--font-display);
		font-size: var(--text-lg);
		line-height: 1.1;
	}

	.done__tile--1 {
		background: var(--color-again-soft);
	}

	.done__tile--2 {
		background: var(--color-hard-soft);
	}

	.done__tile--3 {
		background: var(--color-accent-soft);
	}

	.done__tile--4 {
		background: var(--color-easy-soft);
	}

	.done__text {
		max-width: var(--measure);
		color: var(--color-muted);
	}

	.done__text strong {
		color: var(--color-ink);
	}

	.done__actions {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: var(--space-3);
	}
</style>
