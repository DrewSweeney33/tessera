// Hands a file the page has fetched to the browser as a download. An object URL and a temporary link, because a
// plain link would not carry the page's marker header (ADR-011).
export function saveBlob(blob: Blob, filename: string): void {
	const url = URL.createObjectURL(blob);
	const link = document.createElement('a');
	link.href = url;
	link.download = filename;
	link.style.display = 'none';
	document.body.append(link);
	link.click();
	link.remove();
	// Not at once: some browsers start the download after the click handler returns.
	setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
