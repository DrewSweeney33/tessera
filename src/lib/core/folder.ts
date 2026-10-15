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
