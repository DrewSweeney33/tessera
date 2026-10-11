import type {
	ApiErrorBody,
	DecksResponse,
	FieldErrorDto,
	ImportResponse,
	NextResponse,
	ReviewRequest,
	ReviewResponse
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

async function call<T>(path: string, init?: RequestInit): Promise<T> {
	let response: Response;
	try {
		// Says this call comes from the Tessera page, so a server with an API token still answers it (ADR-011).
		response = await fetch(path, {
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

	const text = await response.text();
	let body: unknown;
	try {
		body = text ? JSON.parse(text) : undefined;
	} catch {
		body = undefined;
	}

	if (!response.ok) {
		const error = (body as ApiErrorBody | undefined)?.error;
		throw new ApiError(
			response.status,
			error?.code ?? 'http_error',
			error?.message ?? `The request failed (HTTP ${response.status}).`,
			error?.details
		);
	}
	return body as T;
}

export interface ImportOptions {
	dryRun: boolean;
	archiveMissing: boolean;
	filename?: string | undefined;
	// The format of the text. The page works it out with detectFormat. JSON when not given.
	format?: DeckFormat | undefined;
}

export const api = {
	decks: () => call<DecksResponse>('/api/decks'),

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
		const suffix = query.size > 0 ? `?${query}` : '';
		return call<ImportResponse>(`/api/import${suffix}`, {
			method: 'POST',
			headers: { 'content-type': CONTENT_TYPES[options.format ?? 'json'] },
			body: text
		});
	}
};
