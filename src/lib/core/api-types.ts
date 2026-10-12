// The shapes of API requests and responses, shared by the server and the browser UI. Pure types, so
// both sides are checked against the same definitions and cannot drift apart.
import type { Grade } from './scheduler/types.ts';
import type { CardType } from './schema/card.ts';

export type QueueCategory = 'learning' | 'review' | 'new';

// Counts are review items, not cards: each cloze blank is its own item.
export interface QueueCounts {
	learning: number;
	review: number;
	new: number;
}

// A review item's schedule with dates as ISO strings.
export interface SerializedState {
	due: string;
	stability: number;
	difficulty: number;
	elapsedDays: number;
	scheduledDays: number;
	learningSteps: number;
	reps: number;
	lapses: number;
	phase: number;
	lastReview: string | null;
}

export interface StudyItemDto {
	category: QueueCategory;
	cardPk: number;
	ordinal: number;
	deckId: string;
	deckTitle: string;
	key: string;
	type: CardType;
	// Authored fields as Markdown text. The browser renders and sanitizes them (ADR-005).
	content: Record<string, unknown>;
	tags: string[];
	state: SerializedState;
	// The label for each grade button, such as "10m" or "4d".
	previews: Record<Grade, { label: string }>;
	// Echoed back on submit so a stale answer can be detected.
	servedAt: string;
}

export type NextResponse =
	| { done: false; item: StudyItemDto; counts: QueueCounts }
	| { done: true; waitingUntil: string | null; counts: QueueCounts };

export interface ReviewRequest {
	reviewId: string;
	cardPk: number;
	ordinal: number;
	grade: Grade;
	servedAt: string;
	durationMs?: number;
	typedAnswer?: string;
	// The deck being studied, so the response can include the next card from it.
	deckId?: string;
}

export interface ReviewResultDto {
	reviewId: string;
	replayed: boolean;
	cardPk: number;
	ordinal: number;
	grade: Grade;
	next: SerializedState;
	becameLeech: boolean;
}

export interface ReviewResponse {
	result: ReviewResultDto;
	next: NextResponse;
}

export interface DeckSummaryDto {
	id: string;
	title: string;
	description: string | null;
	tags: string[];
	cardCount: number;
	createdAt: string;
	updatedAt: string;
	counts: QueueCounts;
}

// POST /api/decks: a deck made by hand (US-11). The id is optional: left out, the server makes one from the title.
export interface CreateDeckRequest {
	id?: string;
	title: string;
	description?: string;
	tags?: string[];
}

export interface CreateDeckResponse {
	deck: DeckSummaryDto;
}

export interface DecksResponse {
	decks: DeckSummaryDto[];
	// What a session across every deck would serve right now.
	totals: QueueCounts;
}

export interface ImportCountsDto {
	new: number;
	updated: number;
	typeChanged: number;
	restored: number;
	unchanged: number;
	absent: number;
	archivedMissing: number;
}

export interface ImportWarningDto {
	code: string;
	message: string;
	paths: string[];
}

// One field a re-import changes. Long text is cut, and `cut` says so.
export interface FieldChangeDto {
	field: string;
	before: string | undefined;
	after: string | undefined;
	cut: boolean;
}

export interface ImportPlanSummary {
	deck: { id: string; title: string; action: 'created' | 'updated'; changed: boolean };
	counts: ImportCountsDto;
	cards: {
		key: string;
		index: number;
		action: 'new' | 'unchanged' | 'updated' | 'type_changed' | 'restored';
		changedFields: string[];
		// Old and new values. Only the first 50 changed cards carry them, to keep the reply small.
		changes: FieldChangeDto[] | undefined;
		// For a type change: review items whose history is erased.
		progressLost: number;
		restored: boolean;
		generatedKey: boolean;
	}[];
	// The first 200 cards the file does not mention. `counts.absent` has the full number.
	absent: { key: string; archived: boolean }[];
	archiveMissing: boolean;
	warnings: ImportWarningDto[];
}

export interface ImportCommitDto {
	deckId: string;
	changed: boolean;
	counts: ImportCountsDto;
	warnings: ImportWarningDto[];
	importHistoryId: number | undefined;
}

export type ImportResponse =
	{ dryRun: true; plan: ImportPlanSummary } | { dryRun: false; result: ImportCommitDto };

// One problem in an import or a request body.
export interface FieldErrorDto {
	path: string;
	code: string;
	message: string;
	line?: number;
	column?: number;
	allowed?: readonly (string | number)[];
}

export interface ApiErrorBody {
	error: { code: string; message: string; details?: unknown };
}
