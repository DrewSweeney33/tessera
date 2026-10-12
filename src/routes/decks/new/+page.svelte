<script lang="ts">
	import { tick } from 'svelte';
	import { resolve } from '$app/paths';
	import type { DeckSummaryDto, FieldErrorDto } from '#lib/core/api-types.ts';
	import { ID_PATTERN, LIMITS } from '#lib/core/schema/limits.ts';
	import { slugifyTitle } from '#lib/core/slug.ts';
	import { ApiError, api } from '#lib/ui/api.ts';
	import Icon from '#lib/ui/Icon.svelte';

	let title = $state('');
	let description = $state('');
	let tagsText = $state('');
	let idText = $state('');
	let busy = $state(false);
	let errors = $state<FieldErrorDto[]>([]);
	let failure = $state<string | undefined>();
	let created = $state<DeckSummaryDto | undefined>();

	// The id the server will make from the title, shown while typing. It is the same function the server uses.
	const suggestedId = $derived(slugifyTitle(title));
	const tags = $derived([
		...new Set(
			tagsText
				.split(',')
				.map((tag) => tag.trim())
				.filter((tag) => tag.length > 0)
		)
	]);
	const idHint = $derived(
		idText !== '' && !ID_PATTERN.test(idText)
			? `An id uses lowercase letters, digits, and hyphens, starts with a letter or digit, and has at most ${LIMITS.maxIdLength} characters.`
			: undefined
	);

	// Server errors name a path like "title" or "tags[0]". Each belongs to the field it starts with.
	const FIELDS = ['title', 'description', 'tags', 'id'] as const;
	type Field = (typeof FIELDS)[number];
	const fieldOf = (error: FieldErrorDto): Field | undefined =>
		FIELDS.find((field) => error.path === field || error.path.startsWith(`${field}[`));
	const messageFor = (field: Field) => {
		const own = errors.find((error) => fieldOf(error) === field)?.message;
		return own ?? (field === 'id' ? idHint : undefined);
	};
	const elementId = (field: Field) => `deck-${field}`;

	async function focusFirstProblem() {
		await tick();
		const first = FIELDS.find((field) => messageFor(field) !== undefined);
		if (first) document.getElementById(elementId(first))?.focus();
	}

	function reset() {
		title = '';
		description = '';
		tagsText = '';
		idText = '';
		errors = [];
		failure = undefined;
		created = undefined;
	}

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (busy) return;
		errors = [];
		failure = undefined;

		// The checks a person can make without asking the server. The server checks everything again.
		if (title.trim() === '') {
			errors = [{ path: 'title', code: 'blank', message: 'Give the deck a title.' }];
			await focusFirstProblem();
			return;
		}
		if (idHint) {
			errors = [{ path: 'id', code: 'invalid', message: idHint }];
			await focusFirstProblem();
			return;
		}

		busy = true;
		try {
			const response = await api.createDeck({
				title,
				...(idText !== '' ? { id: idText } : {}),
				...(description.trim() !== '' ? { description: description.trim() } : {}),
				...(tags.length > 0 ? { tags } : {})
			});
			created = response.deck;
		} catch (error) {
			if (error instanceof ApiError && error.fieldErrors.length > 0) {
				errors = error.fieldErrors;
			} else {
				failure =
					error instanceof ApiError
						? error.message
						: 'Something went wrong making the deck. Try again.';
			}
			await focusFirstProblem();
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head>
	<title>New deck · Tessera</title>
</svelte:head>

<div class="page narrow stack">
	{#if created}
		<section class="callout callout--ok stack success" aria-labelledby="done-heading">
			<span class="success__seal" aria-hidden="true"><Icon name="check" size="1.75rem" /></span>
			<h1 id="done-heading">Deck created</h1>
			<p>
				<strong>{created.title}</strong> has the id <code>{created.id}</code> and no cards yet.
			</p>
			<p class="muted">
				To add cards now, import a deck file whose deck id is <code>{created.id}</code>. Importing
				it keeps everything you have studied, and importing it again later is always safe.
			</p>
			<p class="actions">
				<a class="btn btn--primary" href={resolve('/import')}>Import cards</a>
				<a class="btn" href={resolve('/')}>All decks</a>
				<button type="button" class="btn" onclick={reset}>Make another deck</button>
			</p>
		</section>
	{:else}
		<header class="page-head">
			<a class="crumb" href={resolve('/')}><Icon name="back" size="1em" /> All decks</a>
			<h1>New deck</h1>
			<p class="lead">
				Make an empty deck by hand. Add cards to it afterwards by importing a file.
			</p>
		</header>

		{#if failure}
			<div class="callout callout--error" role="alert"><p>{failure}</p></div>
		{:else if errors.length > 0}
			<div class="callout callout--error" role="alert">
				<p>This deck could not be made yet:</p>
				<ul class="problems">
					{#each errors as error (error.path + error.message)}
						<li>{error.message}</li>
					{/each}
				</ul>
			</div>
		{/if}

		<form class="stack" onsubmit={submit} novalidate>
			<div class="stack">
				<label for={elementId('title')}>Title</label>
				<input
					id={elementId('title')}
					class="field field--text"
					type="text"
					bind:value={title}
					maxlength={LIMITS.maxTitleLength}
					autocomplete="off"
					aria-required="true"
					aria-invalid={messageFor('title') ? 'true' : undefined}
					aria-describedby={messageFor('title') ? 'deck-title-problem' : 'deck-id-preview'}
				/>
				{#if messageFor('title')}
					<p id="deck-title-problem" class="problem">{messageFor('title')}</p>
				{/if}
				<p id="deck-id-preview" class="muted small" data-testid="id-preview">
					{#if idHint}
						Fix the deck id below first.
					{:else}
						Its id will be <code>{idText !== '' ? idText : suggestedId}</code>
					{/if}
				</p>
			</div>

			<div class="stack">
				<label for={elementId('description')}
					>Description <span class="muted">(optional)</span></label
				>
				<textarea
					id={elementId('description')}
					class="field field--text"
					rows="3"
					bind:value={description}
					maxlength={LIMITS.maxDescriptionLength}
					aria-invalid={messageFor('description') ? 'true' : undefined}
					aria-describedby={messageFor('description') ? 'deck-description-problem' : undefined}
				></textarea>
				{#if messageFor('description')}
					<p id="deck-description-problem" class="problem">{messageFor('description')}</p>
				{/if}
			</div>

			<div class="stack">
				<label for={elementId('tags')}>Tags <span class="muted">(optional)</span></label>
				<input
					id={elementId('tags')}
					class="field field--text"
					type="text"
					bind:value={tagsText}
					autocomplete="off"
					aria-invalid={messageFor('tags') ? 'true' : undefined}
					aria-describedby="deck-tags-help{messageFor('tags') ? ' deck-tags-problem' : ''}"
				/>
				<p id="deck-tags-help" class="muted small">Separate tags with commas.</p>
				{#if messageFor('tags')}
					<p id="deck-tags-problem" class="problem">{messageFor('tags')}</p>
				{/if}
			</div>

			<div class="stack">
				<label for={elementId('id')}>Deck id <span class="muted">(optional)</span></label>
				<input
					id={elementId('id')}
					class="field field--text field--code"
					type="text"
					bind:value={idText}
					maxlength={LIMITS.maxIdLength}
					autocomplete="off"
					spellcheck="false"
					placeholder={suggestedId}
					aria-invalid={messageFor('id') ? 'true' : undefined}
					aria-describedby="deck-id-help{messageFor('id') ? ' deck-id-problem' : ''}"
				/>
				<p id="deck-id-help" class="muted small">
					The id names the deck when you import cards into it. Leave it empty to use the one made
					from the title.
				</p>
				{#if messageFor('id')}
					<p id="deck-id-problem" class="problem">{messageFor('id')}</p>
				{/if}
			</div>

			<p class="actions">
				<button type="submit" class="btn btn--primary" disabled={busy}>
					{busy ? 'Making the deck…' : 'Create deck'}
				</button>
				<a class="btn btn--quiet" href={resolve('/')}>Cancel</a>
			</p>
		</form>
	{/if}
</div>

<style>
	.narrow {
		max-width: 40rem;
	}

	.small {
		font-size: var(--text-sm);
	}

	.problem {
		font-size: var(--text-sm);
	}

	.problems {
		margin: var(--space-2) 0 0;
		padding-inline-start: var(--space-5);
	}

	.field--code {
		font-family: var(--font-code);
		font-size: var(--text-sm);
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
		align-items: center;
		margin: 0;
	}

	.stack > :global(* + *) {
		margin-block-start: var(--space-2);
	}

	form.stack {
		padding: var(--space-5);
		border: 1px solid var(--color-rule);
		border-radius: var(--radius-xl);
		background: var(--color-surface);
		box-shadow: var(--shadow-2);
	}

	form.stack > :global(* + *) {
		margin-block-start: var(--space-5);
	}

	.success {
		padding: var(--space-6);
		border-radius: var(--radius-xl);
	}

	.success__seal {
		display: grid;
		place-items: center;
		width: 3.5rem;
		height: 3.5rem;
		border-radius: 50%;
		background: var(--color-accent);
		color: var(--color-accent-ink);
		box-shadow: var(--shadow-2);
	}
</style>
