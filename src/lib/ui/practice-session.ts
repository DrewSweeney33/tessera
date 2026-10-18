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

// One saved session per scope: `deck:<id>`, `folder:<id>`, or `tag:<tag>`.
export function scopeKey(scope: {
	deckId?: string | undefined;
	folderId?: number | undefined;
	tag?: string | undefined;
}): string {
	if (scope.tag !== undefined) return `tag:${scope.tag}`;
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

// The seed of a Quiz me session (ADR-020), kept beside the session so a reload shows the same questions.
export function loadQuizSeed(key: string): string | undefined {
	try {
		const text = storage()?.getItem(`${PREFIX}quiz.${key}`);
		return text && /^[A-Za-z0-9]{8,32}$/.test(text) ? text : undefined;
	} catch {
		return undefined;
	}
}

export function saveQuizSeed(key: string, seed: string | undefined): void {
	try {
		if (seed === undefined) storage()?.removeItem(`${PREFIX}quiz.${key}`);
		else storage()?.setItem(`${PREFIX}quiz.${key}`, seed);
	} catch {
		// Not saved: a reload then shows the cards as they are, not as questions.
	}
}

export function clearSession(key: string): void {
	try {
		storage()?.removeItem(PREFIX + key);
		storage()?.removeItem(`${PREFIX}quiz.${key}`);
	} catch {
		// Nothing to clear.
	}
}
