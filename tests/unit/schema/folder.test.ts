import { describe, expect, it } from 'vitest';
import { FOLDER_NAME_MAX, folderNameProblem, tidyFolderName } from '#lib/core/folder.ts';

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
