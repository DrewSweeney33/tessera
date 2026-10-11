// Copies text to the clipboard. The async Clipboard API only exists in secure contexts (https or
// localhost), and a self-hosted app on a plain http LAN address is not one, so fall back to the
// old selection-and-execCommand route. Returns false if both fail so the UI can show the text
// for manual copying.
export async function copyText(text: string): Promise<boolean> {
	try {
		if (window.isSecureContext && navigator.clipboard) {
			await navigator.clipboard.writeText(text);
			return true;
		}
	} catch {
		// fall through to the fallback
	}

	const area = document.createElement('textarea');
	area.value = text;
	area.setAttribute('readonly', '');
	area.style.position = 'fixed';
	area.style.insetBlockStart = '0';
	area.style.opacity = '0';
	document.body.appendChild(area);
	area.select();
	try {
		return document.execCommand('copy');
	} catch {
		return false;
	} finally {
		area.remove();
	}
}
