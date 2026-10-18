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
	// Or the folder being studied. Not both.
	folderId?: number;
}

// Practice again (ADR-017). A session is limited to one deck or one folder, like a study session.
export interface PracticePoolResponse {
	// The deck title or the folder name.
	label: string;
	// Items that could be practiced (active cards in the scope, whatever their due date).
	total: number;
	// Of those, how many have never been studied (the weakest-first order puts them last).
	unstudied: number;
}

export interface PracticeStartRequest {
	deckId?: string;
	folderId?: number;
	tag?: string;
	// Show basic and typed cards as multiple choice where a question can be made (ADR-020).
	quiz?: boolean;
	count: number | 'all';
	order: 'shuffle' | 'weakest';
}

export interface PracticeStartResponse {
	// Items in the session, already ordered and cut to the count.
	items: { cardPk: number; ordinal: number }[];
	// Items that could have been practiced before the count cut.
	poolSize: number;
	// Present when the session was started with `quiz: true`: the seed that fixes every question of the session, sent
	// back with each item request so a reload shows the same options in the same order (ADR-020).
	quizSeed?: string;
}

// An item to practice: a study item without the schedule parts (no category, previews, or served time). `quiz` is true
// when a basic or typed card was turned into a multiple choice question (its type is then `choice`).
export type PracticeItemDto = Omit<StudyItemDto, 'category' | 'previews' | 'servedAt'> & {
	quiz?: true;
};

export interface PracticeItemResponse {
	item: PracticeItemDto;
}

export interface PracticeGradeRequest {
	reviewId: string;
	cardPk: number;
	ordinal: number;
	// True for Got it (stored as grade 3), false for Missed it (grade 1).
	right: boolean;
	durationMs?: number;
	typedAnswer?: string;
}

export interface PracticeGradeResponse {
	// True when this review id had already been recorded (a retried request).
	replayed: boolean;
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

// Undo of the last study answer (ADR-019). `next` is the card to show again, in the state it had before the answer.
export interface UndoRequest {
	reviewId: string;
	// The deck or folder being studied, so the counts in `next` are the session's. Not both.
	deckId?: string;
	folderId?: number;
}

export interface UndoResponse {
	undone: {
		reviewId: string;
		cardPk: number;
		ordinal: number;
		grade: Grade;
		restored: SerializedState;
		leechCleared: boolean;
		siblingsUnburied: number;
	};
	next: NextResponse;
}

export interface PracticeUndoRequest {
	reviewId: string;
}

export interface PracticeUndoResponse {
	undone: { reviewId: string; cardPk: number; ordinal: number; right: boolean };
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
	// The folder the deck is shown in, or null when it is ungrouped.
	folderId: number | null;
}

// A folder that groups decks (project folders). `counts` is what a session limited to the folder would serve right
// now. `reviewsToday` and `retention` give the folder's study at a glance, the rest is in FolderStatsDto.
export interface FolderDto {
	id: number;
	name: string;
	deckCount: number;
	cardCount: number;
	counts: QueueCounts;
	reviewsToday: number;
	// The share of review-phase reviews in the last 30 days graded Hard, Good, or Easy (0 to 1). Null when there are none.
	retention: number | null;
	// The folder's exam day ("YYYY-MM-DD") and the whole days from the current study day to it (negative once past).
	// Both null when no exam date is set.
	examDate: string | null;
	daysToExam: number | null;
}

export interface CreateFolderRequest {
	name: string;
}

export interface RenameFolderRequest {
	name?: string;
	// "YYYY-MM-DD", or null to clear it. Left out keeps the current value.
	examDate?: string | null;
}

export interface FolderResponse {
	folder: FolderDto;
}

export interface FoldersResponse {
	folders: FolderDto[];
}

export interface DeleteFolderResponse {
	// The decks that went back to the ungrouped list. No deck, card, or review is deleted.
	deleted: { id: number; name: string; decks: number };
}

// PUT /api/folder-assignments: puts decks in a folder, or takes them out of any folder (folderId null).
export interface AssignDecksRequest {
	deckIds: string[];
	folderId: number | null;
}

export interface AssignDecksResponse {
	folderId: number | null;
	moved: number;
}

export interface FolderDayDto {
	// The study day, such as "2026-10-14".
	day: string;
	reviews: number;
	// Reviews graded Hard, Good, or Easy.
	remembered: number;
	timeMs: number;
}

// The numbers that studying a set of decks adds up to, shared by a folder's statistics and the Statistics page. Counts
// are review items, not cards. Only study counts: practice answers are never in them.
export interface StatsNumbers {
	// Items by where they are in learning. `suspended` are items of suspended cards, kept out of the other counts.
	items: { new: number; learning: number; review: number; suspended: number };
	openLeeches: number;
	reviewsToday: number;
	reviews7Days: number;
	reviews30Days: number;
	timeTodayMs: number;
	time7DaysMs: number;
	// Review-phase reviews graded Hard, Good, or Easy over the share of review-phase reviews, per window. Null when none.
	retention7Days: number | null;
	retention30Days: number | null;
	// Study days in a row with at least one review, counting back from today (or from yesterday when today has none
	// yet, so a streak is not broken until the day is over).
	streakDays: number;
	// The last 14 study days, oldest first, today last.
	days: FolderDayDto[];
	weakTags: WeakTagDto[];
}

// GET /api/folders/:id/stats: what the reviews of the decks in a folder add up to.
export interface FolderStatsDto extends StatsNumbers {
	folder: FolderDto;
}

// What a Statistics page covers: every deck, one folder, or one deck.
export interface StatsScopeDto {
	kind: 'all' | 'folder' | 'deck';
	// The folder id or the deck id. Null for every deck.
	id: number | string | null;
	label: string;
}

export interface HeatCellDto {
	day: string;
	reviews: number;
}

export interface ForecastDayDto {
	day: string;
	due: number;
}

// GET /api/stats?folderId=&deckId=
export interface StatsDto extends StatsNumbers {
	scope: StatsScopeDto;
	deckCount: number;
	cardCount: number;
	// Reviews per study day for the last 26 weeks as a calendar: oldest week first, each with seven rows from Monday to
	// Sunday. Days after today are null.
	heatmap: (HeatCellDto | null)[][];
	// Review items due on each of the next 30 study days, today first. `overdue` are review items already past due.
	forecast: { overdue: number; days: ForecastDayDto[] };
	// The tags remembered least over the last 90 days (at least 5 review-phase reviews each), lowest first, up to 10.
	tagRetention: WeakTagDto[];
	// Practice again answers since the day began. Kept apart: they are in none of the numbers above.
	practicedToday: { items: number; answers: number; timeMs: number };
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

// A deck as one document (the deck file format), as an editor reads and writes it. A deck made by hand may have no
// cards yet. Card fields vary by type (see the deck format reference), so they are kept loose here.
export interface DeckDocumentDto {
	tessera: 1;
	deck: { id: string; title: string; description?: string; tags?: string[] };
	cards: DeckCardDto[];
}

export type DeckCardDto = {
	id: string;
	type: 'basic' | 'cloze' | 'typed' | 'choice';
	[field: string]: unknown;
};

// GET /api/decks/:id: everything an editor needs. The revision goes back with a save (expected_revision), so a save
// made from an out-of-date copy is refused.
export interface GetDeckResponse {
	document: DeckDocumentDto;
	deck: DeckSummaryDto;
	revision: string;
}

// A deck in the Trash (US-13). `trashedAt` is when it went there. `reviewCount` is the review history that deleting
// it for good would erase.
export interface TrashedDeckDto {
	id: string;
	title: string;
	description: string | null;
	tags: string[];
	cardCount: number;
	reviewCount: number;
	trashedAt: string;
}

export interface TrashResponse {
	decks: TrashedDeckDto[];
}

export interface TrashDeckResponse {
	deck: TrashedDeckDto;
}

export interface RestoreDeckResponse {
	deck: DeckSummaryDto;
}

// POST /api/decks/:id/delete-forever. The title is typed by a person, as a check that they mean it.
export interface DeleteDeckRequest {
	confirmTitle: string;
}

export interface DeleteDeckResponse {
	deleted: {
		deckId: string;
		title: string;
		cards: number;
		reviews: number;
		// The copy taken first, in the backups folder. Restoring it brings the deck back.
		snapshot: { name: string; size: number };
	};
}

// POST /api/decks/:id/start-over. Like deleting for good, the title is typed by a person as a check.
export interface StartOverRequest {
	confirmTitle: string;
}

export interface StartOverResponse {
	reset: {
		deckId: string;
		// Review items put back to new, and reviews that stay in the log.
		items: number;
		reviews: number;
		// The copy taken first, in the backups folder. Restoring it brings the progress back.
		snapshot: { name: string; size: number };
	};
	deck: DeckSummaryDto;
}

// A copy of the database in the backups folder (US-15, ADR-014). `kind` says why it was taken. A backup is
// named by its file name, never by a path.
export type BackupKind =
	'manual' | 'pre-migrate' | 'pre-delete' | 'pre-reset' | 'pre-restore' | 'other';

export interface BackupDto {
	name: string;
	kind: BackupKind;
	size: number;
	// When the file was written, as an ISO time.
	modifiedAt: string;
}

// What a database holds, to compare a backup with the data there now before restoring.
export interface DataSummaryDto {
	decks: number;
	cards: number;
	reviews: number;
	// The time of the most recent review, if there is one.
	newestReviewAt: string | null;
}

// What the last start did about a restore that was chosen on the Backups page.
export interface LastRestoreDto {
	ok: boolean;
	name: string;
	at: string;
	message: string;
}

export interface BackupsResponse {
	backups: BackupDto[];
	// Present when the last start applied, or could not apply, a restore.
	lastRestore?: LastRestoreDto;
	// The backup a restore is waiting to bring back at the next start, if one is.
	pendingRestore?: string;
}

// GET /api/backups/:name/preview: what restoring this backup would bring back, beside what is there now.
export interface RestorePreviewResponse {
	backup: BackupDto;
	restorable: boolean;
	// Why not, when it cannot be restored.
	reason?: string;
	summary?: DataSummaryDto;
	current: DataSummaryDto;
}

// POST /api/backups/:name/restore. The word "restore" is typed by a person as a check that they mean it.
export interface RestoreRequest {
	confirm: 'restore';
}

export interface RestoreResponse {
	restoring: {
		name: string;
		// The copy of the data as it is now, taken first, so a restore can be undone.
		safetyCopy: string;
	};
}

export interface CreateBackupResponse {
	backup: BackupDto;
}

export interface DeleteBackupResponse {
	deleted: string;
}

// A review item the learner keeps failing (US-6, ADR-015). `ordinal` is 0 for a card and the blank number for a
// cloze card. `wrongAnswers` are the wrong answers typed, newest first, at most five.
export interface LeechDto {
	cardPk: number;
	ordinal: number;
	deckId: string;
	deckTitle: string;
	key: string;
	type: 'basic' | 'cloze' | 'typed' | 'choice';
	content: Record<string, unknown>;
	tags: string[];
	source: string | null;
	lapses: number;
	reps: number;
	lastReviewedAt: string | null;
	suspended: boolean;
	wrongAnswers: string[];
}

export interface WeakTagDto {
	tag: string;
	reviews: number;
	retention: number;
	lapseRate: number;
	cards: number;
}

export interface LeechesResponse {
	leeches: LeechDto[];
	weakTags: WeakTagDto[];
	// Leeches that are not suspended, so still need attention.
	openCount: number;
}

// The settings a learner can change (M3-09), with the defaults to show beside them and the time zone the server
// uses to decide when a study day starts. The time zone is set by the server's TZ, not here.
export interface SettingsDto {
	targetRetention: number;
	newPerDay: number;
	reviewsPerDay: number;
	rolloverHour: number;
	leechThreshold: number;
	interleave: boolean;
}

export interface SettingsResponse {
	settings: SettingsDto;
	defaults: SettingsDto;
	timeZone: string;
}

export interface DecksResponse {
	decks: DeckSummaryDto[];
	folders: FolderDto[];
	// What a session across every deck would serve right now.
	totals: QueueCounts;
	// Leeches that are flagged and not suspended, so the deck list can point at them.
	openLeeches: number;
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
