import { describe, expect, it } from 'vitest';
import {
	EXAM_SOON_DAYS,
	FOLDER_NAME_MAX,
	daysToExam,
	examDateProblem,
	examIsSoon,
	examLabel,
	folderNameProblem,
	tidyFolderName
} from '#lib/core/folder.ts';

// Folder names (project folders). The form and the server use this one function.

describe('tidyFolderName', () => {
	it('removes the space around a name and nothing inside it', () => {
		expect(tidyFolderName('  CCNA  200-301 \n')).toBe('CCNA  200-301');
	});
});

describe('folderNameProblem', () => {
	it.each(['CCNA', 'CCNA 200-301', 'Café déjà-vu', 'Networking / Security (2026)', '日本語', 'x'])(
		'accepts %j',
		(name) => {
			expect(folderNameProblem(name)).toBeUndefined();
		}
	);

	it('refuses an empty name and a name of only space', () => {
		for (const name of ['', '   ', '\t\n']) {
			expect(folderNameProblem(name)?.code).toBe('empty');
		}
	});

	it('refuses a name with a line break or another control character inside it', () => {
		for (const name of ['two\nlines', 'tab\there', 'bell\u0007', 'nul\u0000']) {
			expect(folderNameProblem(name)?.code).toBe('control_characters');
		}
	});

	it('counts characters, not code units, against the limit', () => {
		expect(folderNameProblem('a'.repeat(FOLDER_NAME_MAX))).toBeUndefined();
		expect(folderNameProblem('a'.repeat(FOLDER_NAME_MAX + 1))?.code).toBe('too_long');
		expect(folderNameProblem('🙂'.repeat(FOLDER_NAME_MAX))).toBeUndefined();
		expect(folderNameProblem('🙂'.repeat(FOLDER_NAME_MAX + 1))?.code).toBe('too_long');
	});

	it('gives every problem a plain message', () => {
		for (const name of ['', 'a\nb', 'a'.repeat(FOLDER_NAME_MAX + 1)]) {
			expect(folderNameProblem(name)?.message).toMatch(/\w/);
		}
	});
});

describe('examDateProblem', () => {
	it.each(['2026-12-15', '2026-02-28', '2028-02-29', '2000-01-01', '2200-12-31'])(
		'accepts %s',
		(date) => {
			expect(examDateProblem(date)).toBeUndefined();
		}
	);

	it.each([
		'2026-02-29',
		'2026-02-30',
		'2026-04-31',
		'2026-13-01',
		'2026-00-10',
		'2026-12-00',
		'2026-12-32',
		'1999-12-31',
		'2201-01-01',
		'26-12-15',
		'2026-1-5',
		'2026/12/15',
		'20261215',
		' 2026-12-15',
		'2026-12-15 ',
		'2026-12-15T10:00',
		'',
		'tomorrow'
	])('refuses %j', (date) => {
		expect(examDateProblem(date)).toMatchObject({ code: 'invalid_date' });
	});
});

describe('daysToExam', () => {
	it.each([
		['2026-12-15', '2026-12-15', 0],
		['2026-12-16', '2026-12-15', 1],
		['2026-12-14', '2026-12-15', -1],
		['2027-01-01', '2026-12-31', 1],
		['2026-03-01', '2026-02-28', 1],
		['2028-03-01', '2028-02-28', 2],
		['2026-11-01', '2026-10-31', 1],
		['2026-12-25', '2026-10-17', 69]
	])('from %s... exam %s today %s is %d', (exam, today, days) => {
		expect(daysToExam(exam, today)).toBe(days);
	});

	it('does not drift across daylight saving changes (it counts calendar days)', () => {
		expect(daysToExam('2026-11-02', '2026-10-31')).toBe(2);
		expect(daysToExam('2026-03-09', '2026-03-07')).toBe(2);
	});

	it('is undefined for a label that is not a date', () => {
		expect(daysToExam('soon', '2026-12-15')).toBeUndefined();
		expect(daysToExam('2026-12-15', '')).toBeUndefined();
	});
});

describe('examIsSoon', () => {
	it('is true from 14 days before the exam until the day after it', () => {
		expect(EXAM_SOON_DAYS).toBe(14);
		for (const days of [14, 13, 7, 1, 0, -1]) expect(examIsSoon(days), String(days)).toBe(true);
		for (const days of [15, 30, 100, -2, -30]) expect(examIsSoon(days), String(days)).toBe(false);
	});
});

describe('examLabel', () => {
	it.each([
		[12, 'Exam in 12 days'],
		[2, 'Exam in 2 days'],
		[1, 'Exam tomorrow'],
		[0, 'Exam today'],
		[-1, 'Exam was yesterday'],
		[-3, 'Exam was 3 days ago']
	])('%d is %j', (days, text) => {
		expect(examLabel(days)).toBe(text);
	});
});
