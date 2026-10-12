<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { resolve } from '$app/paths';
	import type { SettingsDto, SettingsResponse } from '#lib/core/api-types.ts';
	import { settingProblems, type SettingKey, type SettingProblem } from '#lib/core/settings.ts';
	import { ApiError, api } from '#lib/ui/api.ts';

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
				message:
					error instanceof ApiError ? error.message : 'Something went wrong loading the settings.'
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
				failure =
					error instanceof ApiError
						? error.message
						: 'Something went wrong saving. Nothing was changed.';
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
	const hourLabel = (hour: number) =>
		`${hour === 0 ? 12 : hour > 12 ? hour - 12 : hour}:00 ${hour < 12 ? 'AM' : 'PM'}`;
</script>

<svelte:head>
	<title>Settings · Tessera</title>
</svelte:head>

<div class="page narrow stack">
	<header>
		<p class="muted small"><a href={resolve('/')}>All decks</a></p>
		<h1>Settings</h1>
		<p class="muted lead">How many cards Tessera gives you, and when. Changes apply at once.</p>
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
						aria-describedby="newPerDay-help{problemFor('newPerDay') ? ' newPerDay-problem' : ''}"
					/>
					<p id="newPerDay-help" class="muted small">
						How many cards you have never seen are introduced each study day. Each deck gets this
						many. Default {defaults.newPerDay}.
					</p>
					{#if problemFor('newPerDay')}
						<p id="newPerDay-problem" class="problem">{problemFor('newPerDay')}</p>
					{/if}
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
						aria-describedby="reviewsPerDay-help{problemFor('reviewsPerDay')
							? ' reviewsPerDay-problem'
							: ''}"
					/>
					<p id="reviewsPerDay-help" class="muted small">
						The most due cards you are shown in a day, across all decks. Cards you are still
						learning do not count. Default {defaults.reviewsPerDay}.
					</p>
					{#if problemFor('reviewsPerDay')}
						<p id="reviewsPerDay-problem" class="problem">{problemFor('reviewsPerDay')}</p>
					{/if}
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
						aria-describedby="targetRetention-help{problemFor('targetRetention')
							? ' targetRetention-problem'
							: ''}"
					/>
					<p id="targetRetention-help" class="muted small">
						How likely you want to be to remember a card when it comes back, from 70 to 99. Higher
						means more reviews. It changes the next gap after each review you do from now on, not
						the dates already set. Default {percentOf(defaults.targetRetention)}.
					</p>
					{#if problemFor('targetRetention')}
						<p id="targetRetention-problem" class="problem">{problemFor('targetRetention')}</p>
					{/if}
				</div>

				<div class="stack">
					<label for={idOf('rolloverHour')}>The study day starts at</label>
					<select
						id={idOf('rolloverHour')}
						class="field field--text field--short"
						bind:value={form.rolloverHour}
						aria-invalid={problemFor('rolloverHour') ? 'true' : undefined}
						aria-describedby="rolloverHour-help{problemFor('rolloverHour')
							? ' rolloverHour-problem'
							: ''}"
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
					{#if problemFor('rolloverHour')}
						<p id="rolloverHour-problem" class="problem">{problemFor('rolloverHour')}</p>
					{/if}
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
						aria-describedby="leechThreshold-help{problemFor('leechThreshold')
							? ' leechThreshold-problem'
							: ''}"
					/>
					<p id="leechThreshold-help" class="muted small">
						A card is flagged as a leech once you have forgotten it this many times. It applies to
						future lapses: cards already flagged stay flagged, and lowering it does not flag cards
						that have already lapsed fewer times. Default {defaults.leechThreshold}. See
						<a href={resolve('/leeches')}>Leeches</a>.
					</p>
					{#if problemFor('leechThreshold')}
						<p id="leechThreshold-problem" class="problem">{problemFor('leechThreshold')}</p>
					{/if}
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
	{/if}
</div>

<style>
	.narrow {
		max-width: 42rem;
	}

	.small {
		font-size: var(--text-sm);
	}

	.lead {
		margin-block-start: var(--space-2);
		max-width: var(--measure);
	}

	.problem {
		color: var(--color-error);
		font-size: var(--text-sm);
	}

	.page.stack > :global(* + *) {
		margin-block-start: var(--space-5);
	}

	.stack > :global(* + *) {
		margin-block-start: var(--space-2);
	}

	form.stack > :global(* + *) {
		margin-block-start: var(--space-6);
	}

	.group {
		margin: 0;
		padding: 0;
		border: 0;
		min-width: 0;
	}

	.group legend {
		padding: 0;
		margin-block-end: var(--space-3);
		font-family: var(--font-display);
		font-size: var(--text-md);
		font-weight: 600;
	}

	.group > :global(div + div) {
		margin-block-start: var(--space-5);
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
</style>
