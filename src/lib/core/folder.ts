// Folder names (project folders). The same rule runs in the browser, so a form can say what is wrong before
// anything is sent, and on the server, which is the check that counts.
export const FOLDER_NAME_MAX = 60;

// A line break, tab, or other control character would break a heading or a list. Nothing else is forbidden.
function hasControlCharacter(text: string): boolean {
	return [...text].some((character) => {
		const code = character.codePointAt(0)!;
		return code < 32 || code === 127;
	});
}

export interface FolderNameProblem {
	code: 'empty' | 'too_long' | 'control_characters';
	message: string;
}

// A name is stored as typed minus the space around it.
export function tidyFolderName(name: string): string {
	return name.trim();
}

// The first thing wrong with a folder name, or undefined when it is fine. `name` is checked after tidying.
export function folderNameProblem(name: string): FolderNameProblem | undefined {
	const tidy = tidyFolderName(name);
	if (tidy === '') return { code: 'empty', message: 'Give the folder a name.' };
	if (hasControlCharacter(tidy)) {
		return {
			code: 'control_characters',
			message: 'A name cannot hold a line break or other control characters.'
		};
	}
	if ([...tidy].length > FOLDER_NAME_MAX) {
		return {
			code: 'too_long',
			message: `Use ${FOLDER_NAME_MAX} characters or fewer.`
		};
	}
	return undefined;
}

// ---- Exam dates (ADR-017). A folder can carry the day of an exam, "YYYY-MM-DD", shown as a countdown.

// From this many days before the exam (and for a day after it) the folder suggests Practice folder.
export const EXAM_SOON_DAYS = 14;

export interface ExamDateProblem {
	code: 'invalid_date';
	message: string;
}

const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function dayNumber(day: string): number | undefined {
	const match = DAY_PATTERN.exec(day);
	if (!match) return undefined;
	const [, year, month, date] = match.map(Number) as [number, number, number, number];
	const at = new Date(Date.UTC(year, month - 1, date));
	// A date such as 2026-02-31 rolls over into March; refuse it.
	if (
		at.getUTCFullYear() !== year ||
		at.getUTCMonth() !== month - 1 ||
		at.getUTCDate() !== date ||
		year < 2000 ||
		year > 2200
	) {
		return undefined;
	}
	return Math.round(at.getTime() / 86_400_000);
}

// The first thing wrong with an exam date, or undefined when it is a real calendar date between 2000 and 2200.
export function examDateProblem(text: string): ExamDateProblem | undefined {
	return dayNumber(text) === undefined
		? {
				code: 'invalid_date',
				message: 'Use a real date written as year-month-day, such as 2026-12-15.'
			}
		: undefined;
}

// Whole calendar days from `today` to `examDay` (both "YYYY-MM-DD"): 0 on the day, negative after it.
export function daysToExam(examDay: string, today: string): number | undefined {
	const exam = dayNumber(examDay);
	const now = dayNumber(today);
	return exam === undefined || now === undefined ? undefined : exam - now;
}

// True from `EXAM_SOON_DAYS` before the exam until the day after it.
export function examIsSoon(days: number): boolean {
	return days >= -1 && days <= EXAM_SOON_DAYS;
}

// "Exam in 12 days", "Exam tomorrow", "Exam today", "Exam was yesterday", "Exam was 3 days ago".
export function examLabel(days: number): string {
	if (days === 0) return 'Exam today';
	if (days === 1) return 'Exam tomorrow';
	if (days === -1) return 'Exam was yesterday';
	return days > 0 ? `Exam in ${days} days` : `Exam was ${-days} days ago`;
}
