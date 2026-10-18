<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import type { PracticeItemDto } from '#lib/core/api-types.ts';
	import {
		answerPractice,
		currentItem,
		missedItems,
		progress as progressOf,
		skipPractice,
		startPractice,
		summarize,
		type PracticeOrder,
		type PracticeState
	} from '#lib/core/practice.ts';
	import { TAG_PATTERN } from '#lib/core/schema/limits.ts';
	import { ApiError, api, failureMessage, type PracticeScope } from '#lib/ui/api.ts';
	import { cardSides } from '#lib/ui/card-sides.ts';
	import Icon from '#lib/ui/Icon.svelte';
	import { newId } from '#lib/ui/id.ts';
	import Markdown from '#lib/ui/Markdown.svelte';
	import {
		clearSession,
		loadQuizSeed,
		loadSession,
		saveQuizSeed,
		saveSession,
		scopeKey
	} from '#lib/ui/practice-session.ts';
	import {
		checkChoice,
		checkTyped,
		choiceView,
		typedAnswers,
		type Outcome
	} from '#lib/ui/study-card.ts';

	// Practice again (ADR-017): go through a deck or a folder again without touching the schedule. The server picks
	// the items; this page keeps the session (core/practice.ts) and shows one card at a time. A missed card comes
	// back until it has been answered right once.

	type Phase =
		'loading' | 'setup' | 'starting' | 'front' | 'back' | 'submitting' | 'done' | 'error';

	const COUNT_CHOICES = [20, 50, 100];

	// The scope comes from the address: /practice?deck=<id>, /practice?folder=<id>, or /practice?tag=<tag>. Exactly one.
	const scope = $derived.by((): PracticeScope | undefined => {
		const deck = page.url.searchParams.get('deck');
		const folder = page.url.searchParams.get('folder');
		const tag = page.url.searchParams.get('tag');
		const named = [deck, folder, tag].filter((value) => value !== null).length;
		if (named !== 1) return undefined;
		if (deck !== null && /^[a-z0-9][a-z0-9-]{0,63}$/.test(deck)) return { deckId: deck };
		if (folder !== null && /^[1-9][0-9]{0,8}$/.test(folder)) return { folderId: Number(folder) };
		if (tag !== null && tag.length <= 40 && TAG_PATTERN.test(tag)) return { tag };
		return undefined;
	});
	const key = $derived(scope ? scopeKey(scope) : '');

	let phase = $state<Phase>('loading');
	let label = $state('');
	let poolTotal = $state(0);
	let unstudied = $state(0);
	let countChoice = $state<number | 'all'>('all');
	let orderChoice = $state<PracticeOrder>('shuffle');
	// Quiz me (ADR-020): show basic and typed cards as multiple choice. The seed fixes the session's questions.
	let quizOn = $state(false);
	let quizSeed = $state<string | undefined>();
	let resumable = $state<PracticeState | undefined>();
	let session = $state<PracticeState | undefined>();
	let item = $state<PracticeItemDto | undefined>();
	let errorMessage = $state<string | undefined>();
	let notice = $state<string | undefined>();
	let showHint = $state(false);
	// The answer that can still be taken back (ADR-019): the last one saved, with the session as it was before it.
	let lastAnswer = $state<{ reviewId: string; before: PracticeState } | undefined>();
	let undoing = $state(false);

	// A new id for every card shown. Retrying a failed save reuses it, so an answer is never recorded twice.
	let reviewId = '';
	let shownAt = 0;
	let pending: { right: boolean; request: Parameters<typeof api.practiceGrade>[0] } | undefined;

	let typedInput = $state('');
	let outcome = $state<Outcome | undefined>();

	let cardEl = $state<HTMLElement>();
	let typedEl = $state<HTMLInputElement>();
	let answersEl = $state<HTMLElement>();
	let startEl = $state<HTMLButtonElement>();

	const sides = $derived(item ? cardSides(item) : undefined);
	const choices = $derived(item?.type === 'choice' ? choiceView(item) : undefined);
	const typed = $derived(item?.type === 'typed' ? typedAnswers(item) : undefined);
	// Got it unless an attempt at a typed or choice card was wrong.
	const suggestedRight = $derived(outcome === undefined ? true : outcome.correct);
	const summary = $derived(session ? summarize(session) : undefined);
	const progress = $derived(session ? progressOf(session) : 0);
	const left = $derived(session ? session.queue.length : 0);
	const countOptions = $derived<(number | 'all')[]>([
		...COUNT_CHOICES.filter((count) => count < poolTotal),
		'all'
	]);

	async function init() {
		phase = 'loading';
		errorMessage = undefined;
		if (!scope) {
			errorMessage =
				'Choose a deck, a folder, or a tag to practice. Decks and folders are on the decks screen, and tags are on Statistics and Leeches.';
			phase = 'error';
			return;
		}
		resumable = loadSession(key);
		try {
			const pool = await api.practicePool(scope);
			label = pool.label;
			poolTotal = pool.total;
			unstudied = pool.unstudied;
			countChoice = 'all';
			phase = 'setup';
			await tick();
			startEl?.focus();
		} catch (error) {
			errorMessage = failureMessage(error, 'Something went wrong loading this deck.');
			phase = 'error';
		}
	}

	async function start() {
		if (!scope || phase !== 'setup') return;
		phase = 'starting';
		errorMessage = undefined;
		try {
			const started = await api.practiceStart({
				...(scope.tag !== undefined
					? { tag: scope.tag }
					: scope.folderId !== undefined
						? { folderId: scope.folderId }
						: { deckId: scope.deckId }),
				count: countChoice,
				order: orderChoice,
				...(quizOn ? { quiz: true } : {})
			});
			quizSeed = started.quizSeed;
			poolTotal = started.poolSize;
			if (started.items.length === 0) {
				phase = 'setup';
				return;
			}
			clearSession(key);
			resumable = undefined;
			await begin(startPractice(started.items));
		} catch (error) {
			errorMessage = failureMessage(error, 'The practice session could not be started.');
			phase = 'error';
		}
	}

	async function begin(state: PracticeState) {
		session = state;
		notice = undefined;
		saveSession(key, state);
		saveQuizSeed(key, quizSeed);
		await showCurrent();
	}

	function resume() {
		quizSeed = loadQuizSeed(key);
		if (resumable) void begin(resumable);
	}

	function discardResume() {
		clearSession(key);
		resumable = undefined;
	}

	// Loads the card on top of the queue, or ends the session when the queue is empty.
	async function showCurrent() {
		if (!session) return;
		const current = currentItem(session);
		if (!current) {
			clearSession(key);
			phase = 'done';
			return;
		}
		phase = 'loading';
		try {
			const response = await api.practiceItem(current.cardPk, current.ordinal, quizSeed);
			item = response.item;
			reviewId = newId();
			shownAt = performance.now();
			showHint = false;
			typedInput = '';
			outcome = undefined;
			phase = 'front';
			await tick();
			if (item.type === 'typed') typedEl?.focus();
			else cardEl?.focus();
		} catch (error) {
			if (error instanceof ApiError && error.status === 404) {
				await skipCurrent();
				return;
			}
			errorMessage = failureMessage(error, 'Something went wrong loading the next card.');
			phase = 'error';
		}
	}

	// The card was removed or set aside since the session started: leave it out and go on.
	async function skipCurrent() {
		if (!session) return;
		session = skipPractice(session);
		saveSession(key, session);
		lastAnswer = undefined;
		pending = undefined;
		notice = 'A card was removed since this session began, so it was skipped.';
		await showCurrent();
	}

	function unattempted(card: PracticeItemDto): Outcome | undefined {
		if (card.type === 'typed') return checkTyped(card, typedInput);
		return choices ? checkChoice(choices, undefined) : undefined;
	}

	async function reveal(attempt?: Outcome) {
		if (phase !== 'front' || !item) return;
		outcome = attempt ?? unattempted(item);
		phase = 'back';
		await tick();
		answersEl
			?.querySelector<HTMLButtonElement>(suggestedRight ? '.answer--got' : '.answer--missed')
			?.focus();
	}

	function checkAnswer() {
		if (item?.type === 'typed') void reveal(checkTyped(item, typedInput));
	}

	function pick(position: number) {
		if (phase !== 'front' || !choices) return;
		void reveal(checkChoice(choices, position));
	}

	async function submit(right: boolean, request: Parameters<typeof api.practiceGrade>[0]) {
		if (!session) return;
		phase = 'submitting';
		pending = { right, request };
		try {
			await api.practiceGrade(request);
			pending = undefined;
			notice = undefined;
			lastAnswer = { reviewId: request.reviewId, before: session };
			session = answerPractice(session, right);
			saveSession(key, session);
			await showCurrent();
		} catch (error) {
			if (error instanceof ApiError && error.status === 404) {
				await skipCurrent();
				return;
			}
			errorMessage = failureMessage(error, 'Your answer could not be saved.');
			phase = 'error';
		}
	}

	function answer(right: boolean) {
		if (phase !== 'back' || !item) return;
		void submit(right, {
			reviewId,
			cardPk: item.cardPk,
			ordinal: item.ordinal,
			right,
			durationMs: Math.min(3_600_000, Math.round(performance.now() - shownAt)),
			...(outcome?.typed ? { typedAnswer: outcome.typed.slice(0, 2000) } : {})
		});
	}

	// Takes the last practice answer back and shows that card again (ADR-019). Practice never changed a schedule, so
	// the server only removes the answer; the session goes back to how it was before it.
	async function undo() {
		if (!lastAnswer || undoing || (phase !== 'front' && phase !== 'done')) return;
		undoing = true;
		const taken = lastAnswer;
		try {
			await api.practiceUndo({ reviewId: taken.reviewId });
			lastAnswer = undefined;
			notice = 'Took back your last answer. Here is the card again.';
			session = taken.before;
			saveSession(key, session);
			await showCurrent();
		} catch (error) {
			lastAnswer = undefined;
			if (error instanceof ApiError && (error.status === 409 || error.status === 404)) {
				notice = 'That answer can no longer be taken back.';
			} else {
				errorMessage = failureMessage(error, 'The answer could not be taken back.');
				phase = 'error';
			}
		} finally {
			undoing = false;
		}
	}

	function retry() {
		if (pending) void submit(pending.right, pending.request);
		else if (session) void showCurrent();
		else void init();
	}

	function again(items: ReturnType<typeof missedItems>) {
		if (items.length > 0) void begin(startPractice(items));
	}

	function onKey(event: KeyboardEvent) {
		// Ctrl or Cmd with Z takes the last answer back, but not inside a text box, where it undoes typing.
		if (
			(event.metaKey || event.ctrlKey) &&
			!event.shiftKey &&
			!event.altKey &&
			event.key.toLowerCase() === 'z'
		) {
			const inField = (event.target as HTMLElement | null)?.closest(
				'input, textarea, select, [contenteditable="true"]'
			);
			if (!inField && lastAnswer) {
				event.preventDefault();
				void undo();
			}
			return;
		}
		if (event.defaultPrevented || event.repeat || event.metaKey || event.ctrlKey || event.altKey)
			return;
		const target = event.target as HTMLElement | null;
		if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
		const onControl = Boolean(target?.closest('button, a'));

		if (event.key.toLowerCase() === 'u' && lastAnswer && (phase === 'front' || phase === 'done')) {
			event.preventDefault();
			void undo();
			return;
		}

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
			if (event.key === '1' || event.key === '3') {
				event.preventDefault();
				answer(event.key === '3');
			} else if ((event.key === ' ' || event.key === 'Enter') && !onControl) {
				event.preventDefault();
				answer(suggestedRight);
			}
		}
	}

	onMount(() => {
		void init();
	});
</script>

<svelte:head>
	<title>Practice again · Tessera</title>
</svelte:head>

<svelte:window onkeydown={onKey} />

<div class="page practice">
	<header class="top">
		<a class="back" href={resolve('/')}><Icon name="back" size="1.1em" /> Decks</a>
		<p class="deck">{label}</p>
		{#if session && phase !== 'setup' && phase !== 'done'}
			<p class="counts" aria-label="Cards left in this practice session">
				<span class="counts__item counts__item--current">
					Left <strong>{left}</strong>
				</span>
				<span class="counts__item">
					Of <strong>{session.total}</strong>
				</span>
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
		{/if}
	</header>

	{#if phase !== 'done' && phase !== 'setup'}
		<h1 class="sr-only">Practicing: {label}</h1>
	{/if}

	{#if notice}
		<p class="callout" role="status">{notice}</p>
	{/if}

	{#if phase === 'loading' || phase === 'starting'}
		<p class="sr-only" role="status">
			{phase === 'starting' ? 'Starting your practice session…' : 'Loading…'}
		</p>
		<div class="sheet sheet--loading" aria-hidden="true">
			<div class="skeleton-line skeleton-line--short"></div>
			<div class="skeleton-line"></div>
			<div class="skeleton-line"></div>
		</div>
	{:else if phase === 'error'}
		<!-- Arriving with no deck or folder chosen is not a failure: say what to do, without the error colour. -->
		<div class={scope ? 'callout callout--error' : 'callout'} role={scope ? 'alert' : 'status'}>
			<p>{errorMessage}</p>
			<p class="retry">
				{#if scope}
					<button type="button" class="btn" onclick={retry}>Try again</button>
				{/if}
				<a class="btn" href={resolve('/')}>All decks</a>
			</p>
		</div>
	{:else if phase === 'setup'}
		<section class="setup" aria-labelledby="setup-heading">
			<h1 id="setup-heading">Practice again</h1>
			<p class="muted setup__lead">
				{label}: go through everything again. Your schedule does not change, and these answers are
				not counted in your study numbers.
			</p>

			{#if resumable}
				<div class="panel resume" role="group" aria-label="Resume the last session">
					<p>
						You have a session in progress: <strong>{resumable.queue.length}</strong>
						{resumable.queue.length === 1 ? 'card' : 'cards'} left of {resumable.total}.
					</p>
					<p class="resume__actions">
						<button type="button" class="btn btn--primary" onclick={resume}>Resume</button>
						<button type="button" class="btn" onclick={discardResume}>Discard it</button>
					</p>
				</div>
			{/if}

			{#if poolTotal === 0}
				<p class="callout">
					There is nothing to practice here yet. Cards that are set aside, removed, or in the Trash
					are left out.
				</p>
				<p><a class="btn" href={resolve('/')}>All decks</a></p>
			{:else}
				<form
					class="setup__form"
					onsubmit={(event) => {
						event.preventDefault();
						void start();
					}}
				>
					<fieldset class="options">
						<legend>How many cards?</legend>
						{#each countOptions as option (option)}
							<label class="option">
								<input type="radio" name="count" value={option} bind:group={countChoice} />
								<span>{option === 'all' ? `All ${poolTotal}` : option}</span>
							</label>
						{/each}
					</fieldset>

					<fieldset class="options">
						<legend>In what order?</legend>
						<label class="option">
							<input type="radio" name="order" value="shuffle" bind:group={orderChoice} />
							<span>Shuffled</span>
						</label>
						<label class="option">
							<input type="radio" name="order" value="weakest" bind:group={orderChoice} />
							<span>Weakest first</span>
						</label>
						{#if orderChoice === 'weakest'}
							<p class="muted option__note">
								The cards you are least likely to remember come first.
								{#if unstudied > 0}
									{unstudied} you have never studied come last.
								{/if}
							</p>
						{/if}
					</fieldset>

					<fieldset class="options">
						<legend>How should cards be shown?</legend>
						<label class="option">
							<input type="checkbox" bind:checked={quizOn} />
							<span>Quiz me: show cards as multiple choice</span>
						</label>
						{#if quizOn}
							<p class="muted option__note">
								Basic and typed cards become a question with four options; the three wrong ones are
								other answers from your decks. A card that cannot be made into a question is shown
								as usual. Your schedule still does not change.
							</p>
						{/if}
					</fieldset>

					<p class="setup__actions">
						<button type="submit" class="btn btn--primary btn--lg" bind:this={startEl}>
							<Icon name="repeat" /> Start practice
						</button>
						<a class="btn" href={resolve('/')}>Cancel</a>
					</p>
				</form>
			{/if}
		</section>
	{:else if phase === 'done' && summary}
		<section class="done" aria-labelledby="done-heading">
			<span class="done__seal" aria-hidden="true">
				<Icon name="check" size="2.25rem" />
			</span>
			<h1 id="done-heading">Practice complete</h1>
			<ul class="done__tally" aria-hidden="true">
				<li class="done__tile done__tile--3">
					<strong>{summary.rightFirstTime}</strong>
					<span>Right first time</span>
				</li>
				<li class="done__tile done__tile--1">
					<strong>{summary.needMoreRounds}</strong>
					<span>Needed more rounds</span>
				</li>
				<li class="done__tile">
					<strong>{summary.answers}</strong>
					<span>Answers</span>
				</li>
			</ul>
			<p class="done__text">
				You went through <strong>{summary.total}</strong>
				{summary.total === 1 ? 'card' : 'cards'} in {summary.answers}
				{summary.answers === 1 ? 'answer' : 'answers'}.
				{summary.rightFirstTime} of them {summary.rightFirstTime === 1 ? 'was' : 'were'} right the first
				time. Your schedule did not change.
			</p>
			<p class="done__actions">
				{#if lastAnswer}
					<button type="button" class="btn" onclick={undo} disabled={undoing}>
						<Icon name="undo" /> Take back the last answer <kbd>U</kbd>
					</button>
				{/if}
				{#if session && session.missed.length > 0}
					<button
						type="button"
						class="btn btn--primary"
						onclick={() => session && again(missedItems(session))}
					>
						<Icon name="repeat" /> Practice the {session.missed.length}
						{session.missed.length === 1 ? 'miss' : 'misses'} again
					</button>
				{/if}
				<button type="button" class="btn" onclick={init}>Practice again</button>
				<a class="btn" href={resolve('/')}>All decks</a>
			</p>
		</section>
	{:else if item && sides}
		<section class="card sheet" bind:this={cardEl} tabindex="-1" aria-label="Flashcard">
			<p class="card__meta">
				<span class="card__kind">{sides.kind}</span>
				<span class="card__category card__category--practice">{item.deckTitle}</span>
			</p>

			<div class="card__front">
				<Markdown source={sides.front} />
			</div>

			{#if typed && phase === 'front'}
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
			{#if phase === 'front' && lastAnswer}
				<button
					type="button"
					class="btn btn--quiet undo"
					onclick={undo}
					disabled={undoing}
					aria-label="Take back your last answer"
				>
					<Icon name="undo" /> Undo <kbd>U</kbd>
				</button>
			{/if}
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
						Suggested: <strong>{suggestedRight ? 'Got it' : 'Missed it'}</strong>. {outcome.correct
							? 'It was right.'
							: 'It was not right.'} You can pick either.
					</p>
				{/if}
				<div class="answers" role="group" aria-label="How did you do?" bind:this={answersEl}>
					<button
						type="button"
						class="btn answer answer--missed"
						class:answer--suggested={outcome !== undefined && !suggestedRight}
						disabled={phase === 'submitting'}
						onclick={() => answer(false)}
					>
						<kbd>1</kbd>
						<span class="answer__name">Missed it</span>
						<span class="answer__note">Comes back</span>
					</button>
					<button
						type="button"
						class="btn answer answer--got"
						class:answer--suggested={outcome !== undefined && suggestedRight}
						disabled={phase === 'submitting'}
						onclick={() => answer(true)}
					>
						<kbd>3</kbd>
						<span class="answer__name">Got it</span>
						<span class="answer__note">Done for now</span>
					</button>
				</div>
				<p class="muted keys">
					Press <kbd>1</kbd> for Missed it, <kbd>3</kbd> for Got it, or <kbd>Space</kbd> for {suggestedRight
						? 'Got it'
						: 'Missed it'}.
				</p>
			{/if}
		</div>
	{/if}
</div>

<style>
	.undo {
		align-self: center;
	}

	.practice {
		display: flex;
		flex-direction: column;
		width: min(100% - 2 * var(--gutter), 46rem);
		min-height: 100dvh;
		padding-block: var(--space-3) 0;
	}

	@media (min-width: 64rem) {
		.practice {
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

	.keys {
		display: none;
		margin-block-start: var(--space-3);
		font-size: var(--text-sm);
	}

	@media (hover: hover) and (pointer: fine) {
		.keys {
			display: block;
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

	.done__tile--3 {
		background: var(--color-accent-soft);
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

	.done__tally {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 7rem));
		gap: var(--space-2);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.setup {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--space-4);
		margin-block: auto;
		padding-block: var(--space-5);
	}

	.setup h1 {
		margin: 0;
	}

	.setup__lead {
		max-width: var(--measure);
		margin: 0;
	}

	.setup__form {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--space-5);
	}

	.options {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		margin: 0;
		padding: 0;
		border: 0;
	}

	.options legend {
		margin-block-end: var(--space-2);
		padding: 0;
		font-weight: 600;
	}

	.option {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		min-height: var(--hit);
		padding-inline: var(--space-3);
		border: 1px solid var(--color-rule);
		border-radius: var(--radius-lg);
		background: var(--color-surface);
		cursor: pointer;
	}

	.option:has(input:checked) {
		border-color: var(--color-accent);
		background: var(--color-accent-soft);
		box-shadow: inset 0 0 0 1px var(--color-accent);
	}

	.option:has(input:focus-visible) {
		outline: 2px solid var(--color-accent);
		outline-offset: 2px;
	}

	.option input {
		accent-color: var(--color-accent-deep);
	}

	.option__note {
		flex-basis: 100%;
		margin: var(--space-1) 0 0;
	}

	.setup__actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
		margin: 0;
	}

	.resume {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--space-2);
	}

	.resume p {
		margin: 0;
	}

	.resume__actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
	}

	.card__category--practice {
		background: var(--color-sunken);
		color: var(--color-muted);
	}

	.answers {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: var(--space-2);
	}

	.answer {
		position: relative;
		flex-direction: column;
		justify-content: center;
		gap: 2px;
		min-height: 4rem;
		padding: var(--space-2);
		overflow: hidden;
		border-radius: var(--radius-lg);
		line-height: 1.2;
	}

	/* The coloured edge, as on the study grades: the name is always there too, so colour is never alone. */
	.answer::after {
		content: '';
		position: absolute;
		inset-inline: 0;
		inset-block-end: 0;
		height: 4px;
		background: var(--answer-colour, var(--color-muted));
	}

	.answer--missed {
		--answer-colour: var(--color-again);
		background: var(--color-again-soft);
	}

	.answer--got {
		--answer-colour: var(--color-good);
		background: var(--color-accent-soft);
	}

	.answer:hover:not(:disabled) {
		background: var(--color-raised);
	}

	.answer--suggested {
		border-color: var(--answer-colour);
		box-shadow:
			0 0 0 2px var(--answer-colour),
			var(--shadow-2);
	}

	.answer__name {
		font-weight: 600;
	}

	.answer__note {
		color: var(--color-muted);
		font-size: var(--text-sm);
	}

	.answer kbd {
		display: none;
	}

	@media (hover: hover) and (pointer: fine) {
		.answer kbd {
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
</style>
