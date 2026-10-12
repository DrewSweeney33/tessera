<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { tick } from 'svelte';
	import type {
		BackupDto,
		BackupKind,
		LastRestoreDto,
		RestorePreviewResponse
	} from '#lib/core/api-types.ts';
	import { ApiError, api, fetchFile } from '#lib/ui/api.ts';
	import { saveBlob } from '#lib/ui/download.ts';
	import { formatBytes } from '#lib/ui/format.ts';

	type View =
		| { kind: 'loading' }
		| { kind: 'error'; message: string }
		| {
				kind: 'ready';
				backups: BackupDto[];
				lastRestore?: LastRestoreDto;
				pendingRestore?: string;
		  };

	const KIND_LABEL: Record<BackupKind, string> = {
		manual: 'Taken by you',
		'pre-migrate': 'Before an upgrade',
		'pre-delete': 'Before a deck was deleted for good',
		'pre-reset': 'Before a deck was started over',
		'pre-restore': 'Before a restore',
		other: 'Other'
	};

	let view = $state<View>({ kind: 'loading' });
	let busy = $state<string | undefined>();
	let problem = $state<string | undefined>();
	let announcement = $state('');
	let justMade = $state<string | undefined>();
	// The backup whose delete question is open.
	let deleting = $state<string | undefined>();
	// The backup whose restore panel is open, what it would bring back, and what has been typed.
	let restoring = $state<string | undefined>();
	let preview = $state<RestorePreviewResponse | undefined>();
	let confirmWord = $state('');
	let restoreProblem = $state<string | undefined>();
	// After a restore was accepted: Tessera is stopping and starting again.
	let restart = $state<'waiting' | 'back' | 'slow' | undefined>();
	let safetyCopy = $state<string | undefined>();

	async function load() {
		view = { kind: 'loading' };
		try {
			const response = await api.backups();
			view = {
				kind: 'ready',
				backups: response.backups,
				...(response.lastRestore ? { lastRestore: response.lastRestore } : {}),
				...(response.pendingRestore ? { pendingRestore: response.pendingRestore } : {})
			};
		} catch (error) {
			view = {
				kind: 'error',
				message:
					error instanceof ApiError ? error.message : 'Something went wrong loading the backups.'
			};
		}
	}

	onMount(load);

	const when = (iso: string) =>
		new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

	async function backUpNow() {
		if (busy) return;
		busy = 'create';
		problem = undefined;
		try {
			const { backup } = await api.createBackup();
			justMade = backup.name;
			announcement = `Backup ${backup.name} saved.`;
			await load();
		} catch (error) {
			problem =
				error instanceof ApiError ? error.message : 'Something went wrong making the backup.';
		} finally {
			busy = undefined;
		}
	}

	async function download(backup: BackupDto) {
		if (busy) return;
		busy = backup.name;
		problem = undefined;
		try {
			const file = await fetchFile(`/api/backups/${encodeURIComponent(backup.name)}`);
			saveBlob(file.blob, file.filename);
		} catch (error) {
			problem =
				error instanceof ApiError ? error.message : 'Something went wrong downloading the backup.';
		} finally {
			busy = undefined;
		}
	}

	async function openRestore(backup: BackupDto) {
		if (busy) return;
		restoring = backup.name;
		preview = undefined;
		confirmWord = '';
		restoreProblem = undefined;
		deleting = undefined;
		try {
			preview = await api.previewRestore(backup.name);
		} catch (error) {
			restoreProblem =
				error instanceof ApiError ? error.message : 'Something went wrong looking at the backup.';
		}
		await tick();
		document.getElementById('restore-word')?.focus();
	}

	function closeRestore(backup: BackupDto) {
		restoring = undefined;
		preview = undefined;
		confirmWord = '';
		restoreProblem = undefined;
		void tick().then(() => document.getElementById(`restore-${backup.name}`)?.focus());
	}

	const sleepMs = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

	// Tessera stops itself after a restore and the restart policy starts it again. Wait for it to come back: first
	// the stop, then the start. A restart so quick that the stop is never seen counts after fifteen seconds.
	async function waitForRestart() {
		const started = Date.now();
		let sawDown = false;
		await sleepMs(2500);
		while (Date.now() - started < 90_000) {
			const up = await fetch('/healthz', { cache: 'no-store' }).then(
				(response) => response.ok,
				() => false
			);
			if (!up) sawDown = true;
			if (up && (sawDown || Date.now() - started > 15_000)) {
				restart = 'back';
				return;
			}
			await sleepMs(1000);
		}
		restart = 'slow';
	}

	async function restore(backup: BackupDto) {
		if (busy || confirmWord.trim() !== 'restore') return;
		busy = backup.name;
		restoreProblem = undefined;
		try {
			const response = await api.restore(backup.name);
			safetyCopy = response.restoring.safetyCopy;
			restart = 'waiting';
			restoring = undefined;
			announcement = 'Restoring. Tessera is restarting.';
			void waitForRestart();
		} catch (error) {
			restoreProblem =
				error instanceof ApiError ? error.message : 'Something went wrong starting the restore.';
			await tick();
			document.getElementById('restore-word')?.focus();
		} finally {
			busy = undefined;
		}
	}

	async function remove(backup: BackupDto) {
		if (busy) return;
		busy = backup.name;
		problem = undefined;
		try {
			await api.deleteBackup(backup.name);
			deleting = undefined;
			if (justMade === backup.name) justMade = undefined;
			announcement = `Backup ${backup.name} deleted.`;
			await load();
		} catch (error) {
			problem =
				error instanceof ApiError ? error.message : 'Something went wrong deleting the backup.';
		} finally {
			busy = undefined;
		}
	}
</script>

<svelte:head>
	<title>Backups · Tessera</title>
</svelte:head>

<div class="page stack">
	<header>
		<p class="muted small"><a href={resolve('/')}>All decks</a></p>
		<h1>Backups</h1>
		<p class="muted lead">
			A backup is a copy of everything in Tessera: your decks, your cards, and everything you
			studied. Tessera also saves one by itself before an upgrade, before it deletes a deck for
			good, and before it starts a deck over.
		</p>
	</header>

	<div class="callout">
		<p>
			<strong>A backup on the same disk does not protect you if the disk is lost.</strong> Download one
			now and then and keep it somewhere else.
		</p>
	</div>

	<p class="sr-only" role="status" aria-live="polite">{announcement}</p>

	<p class="actions">
		<button
			type="button"
			class="btn btn--primary"
			disabled={busy !== undefined}
			data-state={busy === 'create' ? 'loading' : undefined}
			onclick={backUpNow}
		>
			Back up now
		</button>
	</p>

	{#if justMade}
		<div class="callout callout--ok" role="status">
			<p>Backup saved as <code>{justMade}</code>.</p>
		</div>
	{/if}

	{#if restart === 'waiting'}
		<div class="callout" role="status">
			<h2>Restoring…</h2>
			<p>Tessera is restarting to bring the backup back. This takes a few seconds.</p>
			{#if safetyCopy}
				<p class="muted small">
					The data as it was is saved as <code>{safetyCopy}</code>.
				</p>
			{/if}
		</div>
	{:else if restart === 'back'}
		<div class="callout callout--ok" role="status">
			<h2>Restored</h2>
			<p>Tessera is back, with the backup in place.</p>
			<p>
				<a class="btn btn--primary" href={resolve('/')} data-sveltekit-reload>Go to your decks</a>
			</p>
		</div>
	{:else if restart === 'slow'}
		<div class="callout callout--error" role="alert">
			<h2>Tessera has not come back yet</h2>
			<p>
				The restore is saved and is applied the next time Tessera starts. If you run it with Docker,
				the container needs a restart policy such as <code>unless-stopped</code> (the one in
				<code>compose.yaml</code>) to start again by itself. Otherwise start it by hand:
				<code>docker compose up -d</code>. Your data is safe.
			</p>
		</div>
	{/if}

	{#if view.kind === 'ready' && view.pendingRestore && restart === undefined}
		<div class="callout" role="status">
			<p>
				A restore from <code>{view.pendingRestore}</code> is waiting for Tessera to restart. It is applied
				at the next start.
			</p>
		</div>
	{/if}

	{#if view.kind === 'ready' && view.lastRestore && restart === undefined}
		<div class="callout" class:callout--error={!view.lastRestore.ok} role="status">
			<p>
				<strong>{view.lastRestore.ok ? 'Last restore' : 'The last restore did not happen'}</strong>
				({when(view.lastRestore.at)}): {view.lastRestore.message}
			</p>
		</div>
	{/if}

	{#if problem}
		<div class="callout callout--error" role="alert"><p>{problem}</p></div>
	{/if}

	{#if view.kind === 'loading'}
		<p class="muted" role="status">Loading the backups…</p>
	{:else if view.kind === 'error'}
		<div class="callout callout--error" role="alert">
			<p>{view.message}</p>
			<p><button type="button" class="btn" onclick={load}>Try again</button></p>
		</div>
	{:else if view.backups.length === 0}
		<div class="callout"><p>There are no backups yet.</p></div>
	{:else}
		<ul class="ledger">
			{#each view.backups as backup (backup.name)}
				<li class="row">
					<div class="row__main">
						<h2 class="row__title"><code>{backup.name}</code></h2>
						<p class="muted small">
							{KIND_LABEL[backup.kind]}<span class="sep" aria-hidden="true">·</span>{when(
								backup.modifiedAt
							)}<span class="sep" aria-hidden="true">·</span>{formatBytes(backup.size)}
						</p>
					</div>
					<div class="row__actions">
						<button
							type="button"
							class="btn"
							disabled={busy !== undefined}
							data-state={busy === backup.name && deleting !== backup.name ? 'loading' : undefined}
							aria-label="Download {backup.name}"
							onclick={() => download(backup)}
						>
							Download
						</button>
						<button
							id="restore-{backup.name}"
							type="button"
							class="btn"
							disabled={busy !== undefined || restart !== undefined}
							aria-expanded={restoring === backup.name ? 'true' : 'false'}
							aria-controls="restore-panel-{backup.name}"
							aria-label="Restore {backup.name}"
							onclick={() =>
								restoring === backup.name ? closeRestore(backup) : openRestore(backup)}
						>
							Restore…
						</button>
						{#if deleting === backup.name}
							<span class="muted">Delete this backup?</span>
							<button
								type="button"
								class="btn"
								disabled={busy !== undefined}
								data-state={busy === backup.name ? 'loading' : undefined}
								aria-label="Yes, delete {backup.name}"
								onclick={() => remove(backup)}
							>
								Delete
							</button>
							<button type="button" class="btn btn--quiet" onclick={() => (deleting = undefined)}>
								Keep it
							</button>
						{:else}
							<button
								type="button"
								class="btn btn--quiet"
								disabled={busy !== undefined}
								aria-label="Delete {backup.name}"
								onclick={() => (deleting = backup.name)}
							>
								Delete…
							</button>
						{/if}
					</div>
					{#if restoring === backup.name}
						<form
							id="restore-panel-{backup.name}"
							class="danger stack"
							onsubmit={(event) => {
								event.preventDefault();
								void restore(backup);
							}}
						>
							{#if !preview && !restoreProblem}
								<p class="muted" role="status">Looking at the backup…</p>
							{/if}
							{#if restoreProblem}
								<p class="problem" role="alert">{restoreProblem}</p>
							{/if}
							{#if preview && !preview.restorable}
								<p class="problem" role="alert">
									This backup cannot be restored: {preview.reason}
								</p>
							{/if}
							{#if preview}
								<table class="compare">
									<caption class="sr-only"
										>What the backup holds, and what is in Tessera now</caption
									>
									<thead>
										<tr>
											<th scope="col"><span class="sr-only">What</span></th>
											<th scope="col">This backup</th>
											<th scope="col">Now</th>
										</tr>
									</thead>
									<tbody>
										{#each [['Decks', 'decks'], ['Cards', 'cards'], ['Reviews', 'reviews']] as const as [label, key] (key)}
											<tr>
												<th scope="row">{label}</th>
												<td>{preview.summary ? preview.summary[key] : '—'}</td>
												<td>{preview.current[key]}</td>
											</tr>
										{/each}
										<tr>
											<th scope="row">Last review</th>
											<td>
												{preview.summary
													? preview.summary.newestReviewAt
														? when(preview.summary.newestReviewAt)
														: 'none'
													: '—'}
											</td>
											<td>
												{preview.current.newestReviewAt
													? when(preview.current.newestReviewAt)
													: 'none'}
											</td>
										</tr>
									</tbody>
								</table>
							{/if}
							{#if preview?.restorable}
								<p>
									<strong>Restoring replaces everything in Tessera with this backup.</strong>
									Anything you studied or changed since it was taken is lost, except that Tessera first
									saves a copy of the data as it is now, so a restore can be undone. Tessera then stops
									and starts again by itself, which needs a restart policy such as
									<code>unless-stopped</code>
									(the one in
									<code>compose.yaml</code>).
								</p>
							{/if}
							<label for="restore-word">
								{preview?.restorable ? 'Type' : 'To go on, type'} <strong>restore</strong> to confirm
							</label>
							<input
								id="restore-word"
								class="field field--text"
								type="text"
								bind:value={confirmWord}
								autocomplete="off"
								spellcheck="false"
								disabled={!preview?.restorable}
							/>
							<p class="actions">
								<button
									type="submit"
									class="btn btn--primary"
									disabled={!preview?.restorable ||
										confirmWord.trim() !== 'restore' ||
										busy !== undefined}
									data-state={busy === backup.name ? 'loading' : undefined}
								>
									Restore this backup
								</button>
								<button type="button" class="btn btn--quiet" onclick={() => closeRestore(backup)}>
									Cancel
								</button>
							</p>
						</form>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}

	<p class="muted small">
		Restoring from the page needs Tessera to restart by itself (the restart policy in <code
			>compose.yaml</code
		>). To bring a backup back by hand instead, follow “Restore” in the operations guide (<code
			>docs/operations.md</code
		>).
	</p>
</div>

<style>
	.small {
		font-size: var(--text-sm);
	}

	.lead {
		margin-block-start: var(--space-2);
		max-width: var(--measure);
	}

	.page.stack > :global(* + *) {
		margin-block-start: var(--space-5);
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
		margin: 0;
	}

	.sep {
		margin-inline: 0.5ch;
	}

	.ledger {
		margin: 0;
		padding: 0;
		list-style: none;
		border-block-start: 1px solid var(--color-rule-strong);
	}

	.row {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--space-3) var(--space-5);
		align-items: center;
		padding-block: var(--space-4);
		border-block-end: 1px solid var(--color-rule);
	}

	.row__main {
		min-width: 0;
	}

	.row__title {
		font-size: var(--text-base);
		font-weight: 500;
		overflow-wrap: anywhere;
	}

	.row__actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		align-items: center;
	}

	.problem {
		color: var(--color-error);
		font-size: var(--text-sm);
	}

	.danger {
		padding: var(--space-4) var(--space-5);
		border: 1px solid var(--color-error);
		border-radius: var(--radius);
		background: var(--color-error-soft);
	}

	.danger > :global(* + *) {
		margin-block-start: var(--space-3);
	}

	.compare {
		width: 100%;
		border-collapse: collapse;
		font-variant-numeric: tabular-nums;
	}

	.compare th,
	.compare td {
		padding: var(--space-1) var(--space-3);
		text-align: start;
		border-block-end: 1px solid var(--color-rule);
		overflow-wrap: anywhere;
	}

	.compare thead th {
		font-size: var(--text-sm);
		color: var(--color-muted);
		font-weight: 500;
	}

	@media (min-width: 48rem) {
		.row {
			grid-template-columns: minmax(0, 1fr) auto;
		}

		.danger {
			grid-column: 1 / -1;
		}
	}
</style>
