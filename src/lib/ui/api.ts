import type {
	ApiErrorBody,
	BackupsResponse,
	CreateBackupResponse,
	CreateDeckRequest,
	CreateDeckResponse,
	DecksResponse,
	DeleteBackupResponse,
	DeleteDeckResponse,
	FieldErrorDto,
	GetDeckResponse,
	LeechesResponse,
	ImportResponse,
	NextResponse,
	RestoreDeckResponse,
	SettingsDto,
	SettingsResponse,
	RestorePreviewResponse,
	RestoreResponse,
	ReviewRequest,
	ReviewResponse,
	StartOverResponse,
	TrashDeckResponse,
	TrashResponse
} from '#lib/core/api-types.ts';
// Straight from the file, so the browser bundle does not pull in the Markdown and schema readers.
import { CLIENT_HEADER, CLIENT_HEADER_VALUE } from '#lib/core/client-header.ts';
import { CONTENT_TYPES, type DeckFormat } from '#lib/core/parse/detect.ts';

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

const JSON_HEADERS = { 'content-type': 'application/json' };

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

function failureOf(response: Response, body: unknown): ApiError {
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

export const api = {
	decks: () => call<DecksResponse>('/api/decks'),

	getDeck: (deckId: string) => call<GetDeckResponse>(`/api/decks/${encodeURIComponent(deckId)}`),

	createDeck: (request: CreateDeckRequest) =>
		call<CreateDeckResponse>('/api/decks', {
			method: 'POST',
			headers: JSON_HEADERS,
			body: JSON.stringify(request)
		}),

	settings: () => call<SettingsResponse>('/api/settings'),

	saveSettings: (changes: Partial<SettingsDto>) =>
		call<SettingsResponse>('/api/settings', {
			method: 'PUT',
			headers: JSON_HEADERS,
			body: JSON.stringify(changes)
		}),

	leeches: (deckId?: string) =>
		call<LeechesResponse>(`/api/leeches${deckId ? `?deckId=${encodeURIComponent(deckId)}` : ''}`),

	resetLeech: (cardPk: number, ordinal: number) =>
		call<{ reset: true }>(`/api/leeches/${cardPk}/${ordinal}/reset`, {
			method: 'POST',
			headers: JSON_HEADERS,
			body: '{}'
		}),

	setSuspended: (cardPk: number, suspended: boolean) =>
		call<{ suspended: boolean }>(`/api/cards/${cardPk}/${suspended ? 'suspend' : 'unsuspend'}`, {
			method: 'POST',
			headers: JSON_HEADERS,
			body: '{}'
		}),

	weakSpotReport: (deckId?: string) =>
		fetchText(`/api/report/weak-spots${deckId ? `?deckId=${encodeURIComponent(deckId)}` : ''}`),

	backups: () => call<BackupsResponse>('/api/backups'),

	createBackup: () =>
		call<CreateBackupResponse>('/api/backups', {
			method: 'POST',
			headers: JSON_HEADERS,
			body: '{}'
		}),

	previewRestore: (name: string) =>
		call<RestorePreviewResponse>(`/api/backups/${encodeURIComponent(name)}/preview`),

	restore: (name: string) =>
		call<RestoreResponse>(`/api/backups/${encodeURIComponent(name)}/restore`, {
			method: 'POST',
			headers: JSON_HEADERS,
			body: JSON.stringify({ confirm: 'restore' })
		}),

	deleteBackup: (name: string) =>
		call<DeleteBackupResponse>(`/api/backups/${encodeURIComponent(name)}`, {
			method: 'DELETE',
			headers: JSON_HEADERS
		}),

	trash: () => call<TrashResponse>('/api/trash'),

	trashDeck: (deckId: string) =>
		call<TrashDeckResponse>(`/api/decks/${encodeURIComponent(deckId)}/trash`, {
			method: 'POST',
			headers: JSON_HEADERS,
			body: '{}'
		}),

	restoreDeck: (deckId: string) =>
		call<RestoreDeckResponse>(`/api/decks/${encodeURIComponent(deckId)}/restore`, {
			method: 'POST',
			headers: JSON_HEADERS,
			body: '{}'
		}),

	deleteDeckForever: (deckId: string, confirmTitle: string) =>
		call<DeleteDeckResponse>(`/api/decks/${encodeURIComponent(deckId)}/delete-forever`, {
			method: 'POST',
			headers: JSON_HEADERS,
			body: JSON.stringify({ confirmTitle })
		}),

	startOver: (deckId: string, confirmTitle: string) =>
		call<StartOverResponse>(`/api/decks/${encodeURIComponent(deckId)}/start-over`, {
			method: 'POST',
			headers: JSON_HEADERS,
			body: JSON.stringify({ confirmTitle })
		}),

	studyNext: (deckId?: string) =>
		call<NextResponse>(`/api/study/next${deckId ? `?deckId=${encodeURIComponent(deckId)}` : ''}`),

	review: (request: ReviewRequest) =>
		call<ReviewResponse>('/api/study/review', {
			method: 'POST',
			headers: JSON_HEADERS,
			body: JSON.stringify(request)
		}),

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
