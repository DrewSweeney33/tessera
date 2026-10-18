<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { safeNextPath } from '#lib/core/safe-next.ts';
	import { ApiError, api, failureMessage } from '#lib/ui/api.ts';

	// ADR-021. A password, a Sign in button, and a way back to the page that was asked for. Nothing else on the page
	// names an action: the tab bar is gone until the person is in.

	type View = { kind: 'loading' } | { kind: 'form' } | { kind: 'off' } | { kind: 'entering' };

	let view = $state<View>({ kind: 'loading' });
	let password = $state('');
	let shown = $state(false);
	let busy = $state(false);
	let slow = $state(false);
	let failure = $state<string | undefined>();
	let input = $state<HTMLInputElement | undefined>();

	// Only ever a path on this site. A crafted link cannot send a person elsewhere (safeNextPath).
	const next = $derived(safeNextPath(page.url.searchParams.get('next')));

	// A hard navigation: the page starts fresh with the cookie in place, and nothing from before sign-in lingers.
	function enter() {
		view = { kind: 'entering' };
		window.location.assign(next);
	}

	onMount(async () => {
		try {
			const status = await api.authStatus();
			if (!status.enabled) view = { kind: 'off' };
			else if (status.signedIn) enter();
			else view = { kind: 'form' };
		} catch (error) {
			failure = failureMessage(error, 'Something went wrong. Reload the page and try again.');
			view = { kind: 'form' };
		}
		await tick();
		input?.focus();
	});

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (busy) return;
		failure = undefined;
		busy = true;
		slow = false;
		// After a few wrong guesses the server makes each answer wait on purpose. Say so instead of looking stuck.
		const timer = setTimeout(() => (slow = true), 2500);
		try {
			await api.signIn(password);
			password = '';
			enter();
		} catch (error) {
			failure = failureMessage(error, 'Something went wrong. Nothing was signed in. Try again.');
			if (error instanceof ApiError && error.code === 'invalid_password') {
				await tick();
				input?.focus();
				input?.select();
			}
		} finally {
			clearTimeout(timer);
			slow = false;
			busy = false;
		}
	}
</script>

<svelte:head>
	<title>Sign in · Tessera</title>
</svelte:head>

<div class="page narrow">
	<header class="page-head">
		<h1>Sign in</h1>
		<p class="lead">Tessera asks for a password before it shows your decks.</p>
	</header>

	{#if view.kind === 'loading' || view.kind === 'entering'}
		<p class="muted" role="status">
			{view.kind === 'entering' ? 'Signed in. Opening…' : 'Loading…'}
		</p>
	{:else if view.kind === 'off'}
		<div class="callout" role="status">
			<p>Sign-in is not turned on, so there is nothing to sign in to.</p>
			<p><a class="btn btn--primary" href={resolve('/')}>Go to your decks</a></p>
		</div>
	{:else}
		<form class="form" onsubmit={submit} novalidate>
			<!-- Lets a password manager file the password under a name. Not shown, not read aloud, not tabbable. -->
			<input
				class="sr-only"
				type="text"
				name="username"
				autocomplete="username"
				value="tessera"
				readonly
				tabindex="-1"
				aria-hidden="true"
			/>

			<div class="row">
				<label for="password">Password</label>
				<div class="entry">
					<input
						id="password"
						bind:this={input}
						class="field field--text"
						type={shown ? 'text' : 'password'}
						name="password"
						autocomplete="current-password"
						autocapitalize="none"
						autocorrect="off"
						spellcheck="false"
						required
						bind:value={password}
						aria-invalid={failure ? 'true' : undefined}
						aria-describedby={failure ? 'sign-in-problem' : undefined}
					/>
					<button
						type="button"
						class="btn btn--quiet"
						aria-pressed={shown}
						onclick={() => (shown = !shown)}
					>
						{shown ? 'Hide password' : 'Show password'}
					</button>
				</div>
			</div>

			{#if failure}
				<p id="sign-in-problem" class="problem" role="alert">{failure}</p>
			{/if}
			{#if busy && slow}
				<p class="muted small" role="status">
					There were several wrong guesses, so each answer is delayed for a moment on purpose.
				</p>
			{/if}

			<p class="actions">
				<button
					type="submit"
					class="btn btn--primary"
					disabled={busy || password === ''}
					data-state={busy ? 'loading' : undefined}
				>
					Sign in
				</button>
			</p>
		</form>
	{/if}
</div>

<style>
	.narrow {
		max-width: 28rem;
	}

	.small {
		font-size: var(--text-sm);
	}

	.form {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--space-4);
		padding: var(--space-5);
		border: 1px solid var(--color-rule);
		border-radius: var(--radius-xl);
		background: var(--color-surface);
		box-shadow: var(--shadow-2);
	}

	.row {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--space-2);
	}

	.entry {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--space-2);
	}

	.problem {
		margin: 0;
		font-size: var(--text-sm);
	}

	.actions {
		margin: 0;
	}

	@media (min-width: 30rem) {
		.entry {
			grid-template-columns: minmax(0, 1fr) auto;
			align-items: center;
		}
	}
</style>
