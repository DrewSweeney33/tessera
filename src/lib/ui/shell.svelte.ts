import { api } from './api.ts';

// What the navigation shows that comes from the server: how many leeches need attention. The home page and the leech
// page set it from what they load anyway, and the layout fetches it once for every other page.
export const shell = $state({ openLeeches: 0 });

export async function refreshShell(): Promise<void> {
	try {
		shell.openLeeches = (await api.decks()).openLeeches;
	} catch {
		// The badge is a convenience. A page that cannot load says so itself.
	}
}
