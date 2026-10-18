import { parsePracticeState, type PracticeState } from '#lib/core/practice.ts';

// A practice session in progress is kept in sessionStorage (ADR-017), so a reload resumes it. Storage can be
// missing, full, or blocked (private windows, embedded previews): every access is guarded, and the session simply
// runs without being saved.

const PREFIX = 'tessera.practice.';

function storage(): Storage | undefined {
	try {
		return typeof sessionStorage === 'undefined' ? undefined : sessionStorage;
	} catch {
		return undefined;
	}
}

// One saved session per scope: `deck:<id>` or `folder:<id>`.
export function scopeKey(scope: {
	deckId?: string | undefined;
	folderId?: number | undefined;
}): string {
	return scope.folderId !== undefined ? `folder:${scope.folderId}` : `deck:${scope.deckId ?? ''}`;
}

export function loadSession(key: string): PracticeState | undefined {
	try {
		const text = storage()?.getItem(PREFIX + key);
		if (!text) return undefined;
		const state = parsePracticeState(JSON.parse(text));
		return state && state.queue.length > 0 ? state : undefined;
	} catch {
		return undefined;
	}
}

export function saveSession(key: string, state: PracticeState): void {
	try {
		storage()?.setItem(PREFIX + key, JSON.stringify(state));
	} catch {
		// Not saved: the session still works, it just cannot be resumed after a reload.
	}
}

export function clearSession(key: string): void {
	try {
		storage()?.removeItem(PREFIX + key);
	} catch {
		// Nothing to clear.
	}
}
