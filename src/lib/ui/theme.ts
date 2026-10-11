export type ThemeChoice = 'auto' | 'light' | 'dark';

const KEY = 'tessera-theme';
const CHOICES: readonly ThemeChoice[] = ['auto', 'light', 'dark'];

// Storage can be blocked (private windows, cleared site data), so every access is wrapped.
export function loadTheme(): ThemeChoice {
	try {
		const stored = localStorage.getItem(KEY);
		if (stored && (CHOICES as readonly string[]).includes(stored)) return stored as ThemeChoice;
	} catch {
		// fall through to auto
	}
	return 'auto';
}

export function saveTheme(choice: ThemeChoice): void {
	try {
		localStorage.setItem(KEY, choice);
	} catch {
		// the choice still applies for this visit
	}
}

// "auto" removes the attribute so the system preference decides.
export function applyTheme(choice: ThemeChoice): void {
	const root = document.documentElement;
	if (choice === 'auto') root.removeAttribute('data-theme');
	else root.setAttribute('data-theme', choice);
}

export function nextTheme(choice: ThemeChoice): ThemeChoice {
	return CHOICES[(CHOICES.indexOf(choice) + 1) % CHOICES.length]!;
}

export const THEME_LABEL: Record<ThemeChoice, string> = {
	auto: 'Auto',
	light: 'Light',
	dark: 'Dark'
};
