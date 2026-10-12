<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import type { BackupDto, BackupKind } from '#lib/core/api-types.ts';
	import { ApiError, api, fetchFile } from '#lib/ui/api.ts';
	import { saveBlob } from '#lib/ui/download.ts';
	import { formatBytes } from '#lib/ui/format.ts';

	type View =
		| { kind: 'loading' }
		| { kind: 'error'; message: string }
		| { kind: 'ready'; backups: BackupDto[] };

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

	async function load() {
		view = { kind: 'loading' };
		try {
			view = { kind: 'ready', backups: (await api.backups()).backups };
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
				</li>
			{/each}
		</ul>
	{/if}

	<p class="muted small">
		To bring a backup back, follow “Restore” in the operations guide (<code>docs/operations.md</code
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

	@media (min-width: 48rem) {
		.row {
			grid-template-columns: minmax(0, 1fr) auto;
		}
	}
</style>
