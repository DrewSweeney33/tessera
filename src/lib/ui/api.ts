import type {
	ApiErrorBody,
	AssignDecksRequest,
	AssignDecksResponse,
	AuthStatusResponse,
	BackupsResponse,
	CreateBackupResponse,
	CreateDeckRequest,
	CreateDeckResponse,
	DecksResponse,
	DeleteBackupResponse,
	DeleteDeckResponse,
	DeleteFolderResponse,
	FieldErrorDto,
	FolderResponse,
	FolderStatsDto,
	FoldersResponse,
	GetDeckResponse,
	LeechesResponse,
	ImportResponse,
	NextResponse,
	StatsDto,
	PracticeGradeRequest,
	PracticeGradeResponse,
	PracticeItemResponse,
	PracticePoolResponse,
	PracticeStartRequest,
	PracticeStartResponse,
	PracticeUndoRequest,
	PracticeUndoResponse,
	RestoreDeckResponse,
	SettingsDto,
	SettingsResponse,
	RestorePreviewResponse,
	RestoreResponse,
	ReviewRequest,
	ReviewResponse,
	UndoRequest,
	UndoResponse,
	StartOverResponse,
	TrashDeckResponse,
	TrashResponse
} from '#lib/core/api-types.ts';
// Straight from the file, so the browser bundle does not pull in the Markdown and schema readers.
import { CLIENT_HEADER, CLIENT_HEADER_VALUE } from '#lib/core/client-header.ts';
import { CONTENT_TYPES, type DeckFormat } from '#lib/core/parse/detect.ts';
import { safeNextPath } from '#lib/core/safe-next.ts';

// The browser talks to the server with JSON fetch calls only (ADR-006).
export class ApiError extends Error {
	readonly status: number;
	readonly code: string;
	readonly details: unknown;

	constructor(status: number, code: string, message: string, details?: unknown) {
		super(message);
		this.name = 'ApiError';
		this.status = status;
		this.code = code;
		this.details = details;
	}

	// The path-level problems of a rejected deck or request body, if the server sent any.
	get fieldErrors(): FieldErrorDto[] {
		const errors = (this.details as { errors?: unknown } | undefined)?.errors;
		return Array.isArray(errors) ? (errors as FieldErrorDto[]) : [];
	}
}

// What to show when a call failed: the server's own message, or `fallback` for anything that is not an API error.
export function failureMessage(error: unknown, fallback: string): string {
	return error instanceof ApiError ? error.message : fallback;
}

// A write with a JSON body. Without a body, none is sent.
function jsonRequest(method: 'POST' | 'PUT' | 'DELETE', body?: unknown): RequestInit {
	return {
		method,
		headers: { 'content-type': 'application/json' },
		...(body === undefined ? {} : { body: JSON.stringify(body) })
	};
}

// The query string that limits a request to one deck, or nothing for every deck.
function deckQuery(deckId: string | undefined): string {
	return deckId ? `?deckId=${encodeURIComponent(deckId)}` : '';
}

// The query string that limits a study request to one deck or one folder, or nothing for every deck.
function scopeQuery(scope: StudyScope): string {
	if (scope.folderId !== undefined) return `?folderId=${scope.folderId}`;
	return deckQuery(scope.deckId);
}

// What a practice session covers: exactly one deck or one folder.
export type PracticeScope =
	| { deckId: string; folderId?: undefined; tag?: undefined }
	| { folderId: number; deckId?: undefined; tag?: undefined }
	| { tag: string; deckId?: undefined; folderId?: undefined };

function practiceQuery(scope: PracticeScope): string {
	if (scope.tag !== undefined) return `?tag=${encodeURIComponent(scope.tag)}`;
	return scope.folderId !== undefined
		? `?folderId=${scope.folderId}`
		: `?deckId=${encodeURIComponent(scope.deckId)}`;
}

// Sends the request, marked as coming from the Tessera page (ADR-011). A network failure becomes an ApiError.
async function send(path: string, init?: RequestInit): Promise<Response> {
	try {
		return await fetch(path, {
			...init,
			headers: {
				...(init?.headers as Record<string, string> | undefined),
				[CLIENT_HEADER]: CLIENT_HEADER_VALUE
			}
		});
	} catch {
		throw new ApiError(
			0,
			'network',
			'Cannot reach the Tessera server. Check that it is running, then try again.'
		);
	}
}

function parseBody(text: string): unknown {
	try {
		return text ? JSON.parse(text) : undefined;
	} catch {
		return undefined;
	}
}

// Where a page that finds out it is not signed in sends the browser. Replaceable so a test can watch it.
let goToSignIn: (target: string) => void = (target) => window.location.assign(target);

export function setSignInRedirect(redirect: (target: string) => void): void {
	goToSignIn = redirect;
}

// A 401 whose reason is sign_in_required means sign-in is on and this browser is not signed in (ADR-021), whether it
// never was or the person signed out on another device. The browser goes to the login and comes back to this page
// after. Any other 401 (a wrong password, a token) is shown where it happened.
function leaveForSignIn(response: Response, body: unknown): void {
	if (response.status !== 401 || typeof window === 'undefined') return;
	const details = (body as ApiErrorBody | undefined)?.error?.details as
		{ reason?: unknown } | undefined;
	if (details?.reason !== 'sign_in_required') return;
	const { pathname, search } = window.location;
	if (pathname === '/login') return;
	goToSignIn(`/login?next=${encodeURIComponent(safeNextPath(pathname + search))}`);
}

function failureOf(response: Response, body: unknown): ApiError {
	leaveForSignIn(response, body);
	const error = (body as ApiErrorBody | undefined)?.error;
	return new ApiError(
		response.status,
		error?.code ?? 'http_error',
		error?.message ?? `The request failed (HTTP ${response.status}).`,
		error?.details
	);
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
	const response = await send(path, init);
	const body = parseBody(await response.text());
	if (!response.ok) throw failureOf(response, body);
	return body as T;
}

// A text answer (the weak-spot report), for pasting.
export async function fetchText(path: string): Promise<string> {
	const response = await send(path);
	const text = await response.text();
	if (!response.ok) throw failureOf(response, parseBody(text));
	return text;
}

// A file the server sends as a download (a deck export, a backup), with the name it suggests.
export async function fetchFile(path: string): Promise<{ blob: Blob; filename: string }> {
	const response = await send(path);
	if (!response.ok) throw failureOf(response, parseBody(await response.text()));
	const disposition = response.headers.get('content-disposition') ?? '';
	const named = /filename="([^"]+)"/.exec(disposition)?.[1];
	return { blob: await response.blob(), filename: named ?? 'download' };
}

export interface ImportOptions {
	dryRun: boolean;
	archiveMissing: boolean;
	filename?: string | undefined;
	// The format of the text. The page works it out with detectFormat. JSON when not given.
	format?: DeckFormat | undefined;
	// The revision the editor loaded the deck at. A save made from an out-of-date copy is refused with 409.
	expectedRevision?: string | undefined;
}

// What a study session is limited to. Neither means every deck.
export interface StudyScope {
	deckId?: string | undefined;
	folderId?: number | undefined;
}

export const api = {
	// Sign-in (ADR-021). Whether it is on, and whether this browser is signed in.
	authStatus: () => call<AuthStatusResponse>('/api/auth/status'),

	signIn: (password: string) =>
		call<AuthStatusResponse>('/api/auth/login', jsonRequest('POST', { password })),

	signOut: () => call<AuthStatusResponse>('/api/auth/logout', jsonRequest('POST', {})),

	signOutEverywhere: () =>
		call<AuthStatusResponse>('/api/auth/logout-all', jsonRequest('POST', {})),

	decks: () => call<DecksResponse>('/api/decks'),

	folders: () => call<FoldersResponse>('/api/folders'),

	createFolder: (name: string) =>
		call<FolderResponse>('/api/folders', jsonRequest('POST', { name })),

	renameFolder: (folderId: number, name: string) =>
		call<FolderResponse>(`/api/folders/${folderId}`, jsonRequest('PUT', { name })),

	// Changes a folder's name, its exam date (null clears it), or both. A field left out keeps its value.
	updateFolder: (folderId: number, changes: { name?: string; examDate?: string | null }) =>
		call<FolderResponse>(`/api/folders/${folderId}`, jsonRequest('PUT', changes)),

	deleteFolder: (folderId: number) =>
		call<DeleteFolderResponse>(`/api/folders/${folderId}`, jsonRequest('DELETE')),

	folderStats: (folderId: number) => call<FolderStatsDto>(`/api/folders/${folderId}/stats`),

	assignDecks: (request: AssignDecksRequest) =>
		call<AssignDecksResponse>('/api/folder-assignments', jsonRequest('PUT', request)),

	getDeck: (deckId: string) => call<GetDeckResponse>(`/api/decks/${encodeURIComponent(deckId)}`),

	createDeck: (request: CreateDeckRequest) =>
		call<CreateDeckResponse>('/api/decks', jsonRequest('POST', request)),

	settings: () => call<SettingsResponse>('/api/settings'),

	saveSettings: (changes: Partial<SettingsDto>) =>
		call<SettingsResponse>('/api/settings', jsonRequest('PUT', changes)),

	leeches: (deckId?: string) => call<LeechesResponse>(`/api/leeches${deckQuery(deckId)}`),

	resetLeech: (cardPk: number, ordinal: number) =>
		call<{ reset: true }>(`/api/leeches/${cardPk}/${ordinal}/reset`, jsonRequest('POST', {})),

	setSuspended: (cardPk: number, suspended: boolean) =>
		call<{ suspended: boolean }>(
			`/api/cards/${cardPk}/${suspended ? 'suspend' : 'unsuspend'}`,
			jsonRequest('POST', {})
		),

	weakSpotReport: (deckId?: string) => fetchText(`/api/report/weak-spots${deckQuery(deckId)}`),

	backups: () => call<BackupsResponse>('/api/backups'),

	createBackup: () => call<CreateBackupResponse>('/api/backups', jsonRequest('POST', {})),

	previewRestore: (name: string) =>
		call<RestorePreviewResponse>(`/api/backups/${encodeURIComponent(name)}/preview`),

	restore: (name: string) =>
		call<RestoreResponse>(
			`/api/backups/${encodeURIComponent(name)}/restore`,
			jsonRequest('POST', { confirm: 'restore' })
		),

	deleteBackup: (name: string) =>
		call<DeleteBackupResponse>(`/api/backups/${encodeURIComponent(name)}`, jsonRequest('DELETE')),

	trash: () => call<TrashResponse>('/api/trash'),

	trashDeck: (deckId: string) =>
		call<TrashDeckResponse>(
			`/api/decks/${encodeURIComponent(deckId)}/trash`,
			jsonRequest('POST', {})
		),

	restoreDeck: (deckId: string) =>
		call<RestoreDeckResponse>(
			`/api/decks/${encodeURIComponent(deckId)}/restore`,
			jsonRequest('POST', {})
		),

	deleteDeckForever: (deckId: string, confirmTitle: string) =>
		call<DeleteDeckResponse>(
			`/api/decks/${encodeURIComponent(deckId)}/delete-forever`,
			jsonRequest('POST', { confirmTitle })
		),

	startOver: (deckId: string, confirmTitle: string) =>
		call<StartOverResponse>(
			`/api/decks/${encodeURIComponent(deckId)}/start-over`,
			jsonRequest('POST', { confirmTitle })
		),

	studyNext: (scope: StudyScope = {}) => call<NextResponse>(`/api/study/next${scopeQuery(scope)}`),

	review: (request: ReviewRequest) =>
		call<ReviewResponse>('/api/study/review', jsonRequest('POST', request)),

	// Takes back the most recent answer and returns the card to show again (ADR-019).
	undo: (request: UndoRequest) =>
		call<UndoResponse>('/api/study/undo', jsonRequest('POST', request)),

	// The Statistics page's numbers for every deck (no scope), one deck, or the decks in one folder.
	stats: (scope: StudyScope = {}) => call<StatsDto>(`/api/stats${scopeQuery(scope)}`),

	practicePool: (scope: PracticeScope) =>
		call<PracticePoolResponse>(`/api/practice/pool${practiceQuery(scope)}`),

	practiceStart: (request: PracticeStartRequest) =>
		call<PracticeStartResponse>('/api/practice/start', jsonRequest('POST', request)),

	practiceItem: (cardPk: number, ordinal: number, quizSeed?: string) =>
		call<PracticeItemResponse>(
			`/api/practice/item?cardPk=${cardPk}&ordinal=${ordinal}${quizSeed ? `&quizSeed=${quizSeed}` : ''}`
		),

	practiceGrade: (request: PracticeGradeRequest) =>
		call<PracticeGradeResponse>('/api/practice/grade', jsonRequest('POST', request)),

	practiceUndo: (request: PracticeUndoRequest) =>
		call<PracticeUndoResponse>('/api/practice/undo', jsonRequest('POST', request)),

	importDeck: (text: string, options: ImportOptions) => {
		const query = new URLSearchParams();
		if (options.dryRun) query.set('dry_run', 'true');
		if (options.archiveMissing) query.set('archive_missing', 'true');
		if (options.filename) query.set('filename', options.filename);
		if (options.expectedRevision) query.set('expected_revision', options.expectedRevision);
		const suffix = query.size > 0 ? `?${query}` : '';
		return call<ImportResponse>(`/api/import${suffix}`, {
			method: 'POST',
			headers: { 'content-type': CONTENT_TYPES[options.format ?? 'json'] },
			body: text
		});
	}
};
