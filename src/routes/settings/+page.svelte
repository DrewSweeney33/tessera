<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { resolve } from '$app/paths';
	import type { SettingsDto, SettingsResponse } from '#lib/core/api-types.ts';
	import { settingProblems, type SettingKey, type SettingProblem } from '#lib/core/settings.ts';
	import { ApiError, api, failureMessage } from '#lib/ui/api.ts';
	import Icon from '#lib/ui/Icon.svelte';

	type View =
		| { kind: 'loading' }
		| { kind: 'error'; message: string }
		| { kind: 'ready'; data: SettingsResponse };

	let view = $state<View>({ kind: 'loading' });

	// The form holds what was typed, as text, so a half-typed number is not changed under the cursor. Retention is
	// shown as a percent, and stored as a fraction.
	let form = $state({
		newPerDay: '',
		reviewsPerDay: '',
		targetRetention: '',
		rolloverHour: '0',
		leechThreshold: '',
		interleave: false
	});
	let problems = $state<SettingProblem[]>([]);
	let failure = $state<string | undefined>();
	let saved = $state(false);
	let busy = $state(false);

	const percentOf = (fraction: number) => String(Math.round(fraction * 10_000) / 100);

	function fill(settings: SettingsDto) {
		form = {
			newPerDay: String(settings.newPerDay),
			reviewsPerDay: String(settings.reviewsPerDay),
			targetRetention: percentOf(settings.targetRetention),
			rolloverHour: String(settings.rolloverHour),
			leechThreshold: String(settings.leechThreshold),
			interleave: settings.interleave
		};
	}

	async function load() {
		try {
			const data = await api.settings();
			view = { kind: 'ready', data };
			fill(data.settings);
		} catch (error) {
			view = {
				kind: 'error',
				message: failureMessage(error, 'Something went wrong loading the settings.')
			};
		}
	}

	onMount(load);

	const number = (text: string) => (text.trim() === '' ? Number.NaN : Number(text));

	// What the form says, in the shape the server wants.
	const candidate = $derived({
		newPerDay: number(form.newPerDay),
		reviewsPerDay: number(form.reviewsPerDay),
		targetRetention: Math.round(number(form.targetRetention) * 100) / 10_000,
		rolloverHour: number(form.rolloverHour),
		leechThreshold: number(form.leechThreshold),
		interleave: form.interleave
	});

	const changed = $derived.by(() => {
		if (view.kind !== 'ready') return {};
		const current = view.data.settings;
		const out: Partial<SettingsDto> = {};
		for (const key of Object.keys(candidate) as SettingKey[]) {
			if (!Object.is(candidate[key], current[key]))
				(out as Record<string, unknown>)[key] = candidate[key];
		}
		return out;
	});
	const dirty = $derived(Object.keys(changed).length > 0);

	const problemFor = (key: SettingKey) => problems.find((problem) => problem.path === key)?.message;
	const idOf = (key: SettingKey) => `setting-${key}`;
	// A field is described by its help text, and by its problem while it has one.
	const describedBy = (key: SettingKey) => `${key}-help${problemFor(key) ? ` ${key}-problem` : ''}`;

	async function save(event: SubmitEvent) {
		event.preventDefault();
		if (busy || view.kind !== 'ready') return;
		saved = false;
		failure = undefined;
		// The same check the server makes, so a mistake is shown beside its field without a trip.
		problems = settingProblems(changed);
		if (problems.length > 0) {
			await tick();
			const first = problems[0]?.path;
			if (first) document.getElementById(idOf(first as SettingKey))?.focus();
			return;
		}
		busy = true;
		try {
			const data = await api.saveSettings(changed);
			view = { kind: 'ready', data };
			fill(data.settings);
			saved = true;
		} catch (error) {
			if (error instanceof ApiError && error.fieldErrors.length > 0) {
				problems = error.fieldErrors.map((e) => ({
					path: e.path,
					code: 'out_of_range',
					message: e.message
				}));
			} else {
				failure = failureMessage(error, 'Something went wrong saving. Nothing was changed.');
			}
		} finally {
			busy = false;
		}
	}

	function useDefaults() {
		if (view.kind !== 'ready') return;
		fill(view.data.defaults);
		problems = [];
		saved = false;
	}

	function discard() {
		if (view.kind !== 'ready') return;
		fill(view.data.settings);
		problems = [];
		saved = false;
	}

	const hours = Array.from({ length: 24 }, (_, hour) => hour);
	// "12:00 AM" for midnight, "1:00 PM" for 13, and so on.
	function hourLabel(hour: number): string {
		const onClock = hour % 12 === 0 ? 12 : hour % 12;
		return `${onClock}:00 ${hour < 12 ? 'AM' : 'PM'}`;
	}
</script>

{#snippet problem(key: SettingKey)}
	{#if problemFor(key)}
		<p id="{key}-problem" class="problem">{problemFor(key)}</p>
	{/if}
{/snippet}

<svelte:head>
	<title>Settings · Tessera</title>
</svelte:head>

<div class="page narrow stack">
	<header class="page-head">
		<a class="crumb" href={resolve('/')}><Icon name="back" size="1em" /> All decks</a>
		<h1>Settings</h1>
		<p class="lead">How many cards Tessera gives you, and when. Changes apply at once.</p>
	</header>

	{#if view.kind === 'loading'}
		<p class="muted" role="status">Loading the settings…</p>
	{:else if view.kind === 'error'}
		<div class="callout callout--error" role="alert">
			<p>{view.message}</p>
			<p><button type="button" class="btn" onclick={load}>Try again</button></p>
		</div>
	{:else}
		{@const defaults = view.data.defaults}
		{#if failure}
			<div class="callout callout--error" role="alert"><p>{failure}</p></div>
		{:else if problems.length > 0}
			<div class="callout callout--error" role="alert">
				<p>Nothing was saved. Fix the marked settings and save again.</p>
			</div>
		{/if}
		{#if saved}
			<div class="callout callout--ok" role="status"><p><strong>Saved.</strong></p></div>
		{/if}

		<form class="stack" onsubmit={save} novalidate>
			<fieldset class="group stack">
				<legend>How much to study</legend>

				<div class="stack">
					<label for={idOf('newPerDay')}>New cards per day, for each deck</label>
					<input
						id={idOf('newPerDay')}
						class="field field--text field--short"
						type="number"
						inputmode="numeric"
						min="0"
						max="1000"
						step="1"
						value={form.newPerDay}
						oninput={(event) => (form.newPerDay = event.currentTarget.value)}
						aria-invalid={problemFor('newPerDay') ? 'true' : undefined}
						aria-describedby={describedBy('newPerDay')}
					/>
					<p id="newPerDay-help" class="muted small">
						How many cards you have never seen are introduced each study day. Each deck gets this
						many. Default {defaults.newPerDay}.
					</p>
					{@render problem('newPerDay')}
				</div>

				<div class="stack">
					<label for={idOf('reviewsPerDay')}>Reviews per day</label>
					<input
						id={idOf('reviewsPerDay')}
						class="field field--text field--short"
						type="number"
						inputmode="numeric"
						min="0"
						max="10000"
						step="1"
						value={form.reviewsPerDay}
						oninput={(event) => (form.reviewsPerDay = event.currentTarget.value)}
						aria-invalid={problemFor('reviewsPerDay') ? 'true' : undefined}
						aria-describedby={describedBy('reviewsPerDay')}
					/>
					<p id="reviewsPerDay-help" class="muted small">
						The most due cards you are shown in a day, across all decks. Cards you are still
						learning do not count. Default {defaults.reviewsPerDay}.
					</p>
					{@render problem('reviewsPerDay')}
				</div>

				<div class="stack">
					<label class="check" for={idOf('interleave')}>
						<input id={idOf('interleave')} type="checkbox" bind:checked={form.interleave} />
						<span>Mix new and due cards</span>
					</label>
					<p class="muted small">
						Off: due cards come first, then new ones. On: they are mixed in proportion to how many
						of each are waiting (three due cards and two new ones: three in five are due cards), in
						a random order. Cards you are in the middle of learning always come first.
					</p>
				</div>
			</fieldset>

			<fieldset class="group stack">
				<legend>How it is scheduled</legend>

				<div class="stack">
					<label for={idOf('targetRetention')}>Target retention, in percent</label>
					<input
						id={idOf('targetRetention')}
						class="field field--text field--short"
						type="number"
						inputmode="decimal"
						min="70"
						max="99"
						step="1"
						value={form.targetRetention}
						oninput={(event) => (form.targetRetention = event.currentTarget.value)}
						aria-invalid={problemFor('targetRetention') ? 'true' : undefined}
						aria-describedby={describedBy('targetRetention')}
					/>
					<p id="targetRetention-help" class="muted small">
						How likely you want to be to remember a card when it comes back, from 70 to 99. Higher
						means more reviews. It changes the next gap after each review you do from now on, not
						the dates already set. Default {percentOf(defaults.targetRetention)}.
					</p>
					{@render problem('targetRetention')}
				</div>

				<div class="stack">
					<label for={idOf('rolloverHour')}>The study day starts at</label>
					<select
						id={idOf('rolloverHour')}
						class="field field--text field--short"
						bind:value={form.rolloverHour}
						aria-invalid={problemFor('rolloverHour') ? 'true' : undefined}
						aria-describedby={describedBy('rolloverHour')}
					>
						{#each hours as hour (hour)}
							<option value={String(hour)}>{hourLabel(hour)}</option>
						{/each}
					</select>
					<p id="rolloverHour-help" class="muted small">
						The new-card and review counts start again at this hour, so a late night of studying
						still counts for the same day. It uses the server's time zone, <strong
							>{view.data.timeZone}</strong
						>, which is set where Tessera runs (<code>TZ</code> in <code>compose.yaml</code>), not
						here. Changing the hour moves the line at once: what counts as today, and so what is
						left for today, can change straight away. Default {hourLabel(defaults.rolloverHour)}.
					</p>
					{@render problem('rolloverHour')}
				</div>

				<div class="stack">
					<label for={idOf('leechThreshold')}>Leech threshold</label>
					<input
						id={idOf('leechThreshold')}
						class="field field--text field--short"
						type="number"
						inputmode="numeric"
						min="2"
						max="100"
						step="1"
						value={form.leechThreshold}
						oninput={(event) => (form.leechThreshold = event.currentTarget.value)}
						aria-invalid={problemFor('leechThreshold') ? 'true' : undefined}
						aria-describedby={describedBy('leechThreshold')}
					/>
					<p id="leechThreshold-help" class="muted small">
						A card is flagged as a leech once you have forgotten it this many times. It applies to
						future lapses: cards already flagged stay flagged, and lowering it does not flag cards
						that have already lapsed fewer times. Default {defaults.leechThreshold}. See
						<a href={resolve('/leeches')}>Leeches</a>.
					</p>
					{@render problem('leechThreshold')}
				</div>
			</fieldset>

			<p class="actions">
				<button
					type="submit"
					class="btn btn--primary"
					disabled={!dirty || busy}
					data-state={busy ? 'loading' : undefined}
				>
					Save settings
				</button>
				<button type="button" class="btn" disabled={!dirty || busy} onclick={discard}>
					Discard changes
				</button>
				<button type="button" class="btn btn--quiet" disabled={busy} onclick={useDefaults}>
					Fill in the defaults
				</button>
			</p>
		</form>

		<section class="housekeeping" aria-labelledby="housekeeping-heading">
			<h2 id="housekeeping-heading">Housekeeping</h2>
			<a class="housekeeping__link" href={resolve('/trash')}>
				<Icon name="trash" />
				<span>Trash</span>
				<Icon name="chevron" size="1em" />
			</a>
			<a class="housekeeping__link" href={resolve('/backups')}>
				<Icon name="backups" />
				<span>Backups</span>
				<Icon name="chevron" size="1em" />
			</a>
		</section>
	{/if}
</div>

<style>
	.narrow {
		max-width: 42rem;
	}

	.small {
		font-size: var(--text-sm);
	}

	.problem {
		font-size: var(--text-sm);
	}

	.page.stack > :global(* + *) {
		margin-block-start: var(--space-5);
	}

	.stack > :global(* + *) {
		margin-block-start: var(--space-2);
	}

	form.stack > :global(* + *) {
		margin-block-start: var(--space-5);
	}

	.group {
		margin: 0;
		padding: var(--space-5);
		border: 1px solid var(--color-rule);
		border-radius: var(--radius-xl);
		background: var(--color-surface);
		box-shadow: var(--shadow-2);
		min-width: 0;
	}

	.group legend {
		float: left;
		width: 100%;
		padding: 0;
		margin-block-end: var(--space-4);
		font-family: var(--font-display);
		font-size: var(--text-md);
		font-weight: 600;
	}

	.group legend + :global(*) {
		clear: both;
	}

	.group > :global(div + div) {
		margin-block-start: var(--space-5);
		padding-block-start: var(--space-5);
		border-block-start: 1px solid var(--color-rule);
	}

	.field--short {
		max-width: 12rem;
	}

	.check {
		display: inline-flex;
		align-items: center;
		gap: var(--space-3);
		min-height: var(--hit);
		font-weight: 500;
		cursor: pointer;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
		align-items: center;
		margin: 0;
	}

	/* Trash and Backups have no tab on a phone, so they are one tap from here. */
	.housekeeping {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--space-2);
	}

	.housekeeping h2 {
		margin-block-end: var(--space-1);
		font-size: var(--text-md);
	}

	.housekeeping__link {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) auto;
		gap: var(--space-3);
		align-items: center;
		min-height: 3.25rem;
		padding-inline: var(--space-4);
		border: 1px solid var(--color-rule);
		border-radius: var(--radius-lg);
		background: var(--color-surface);
		box-shadow: var(--shadow-1);
		color: var(--color-ink);
		text-decoration: none;
	}

	.housekeeping__link:hover {
		border-color: var(--color-rule-strong);
		color: var(--color-ink);
	}

	@media (min-width: 64rem) {
		.housekeeping {
			display: none;
		}
	}
</style>
