// Applies the saved theme before the first paint so a dark choice never flashes light.
// It is a separate file because the CSP allows scripts from this origin only (ADR-005).
// The storage key and values must match src/lib/ui/theme.ts.
try {
	var saved = localStorage.getItem('tessera-theme');
	if (saved === 'light' || saved === 'dark') {
		document.documentElement.setAttribute('data-theme', saved);
	}
} catch {
	// Storage is blocked, so the system preference decides.
}
