// Which element of the card editor a problem belongs to, so the page can move focus there. A problem names its
// field the way the deck format does: front, choices, choices[2], correct, and so on.
export function cardFieldElementId(cardId: string, field: string): string {
	const choice = /^choices\[(\d+)\]$/.exec(field);
	if (choice) return `card-${cardId}-choices-${choice[1]}`;
	if (field === 'choices') return `card-${cardId}-choices-0`;
	if (field === 'correct') return `card-${cardId}-correct-0`;
	return `card-${cardId}-${field}`;
}

// A problem on choices[2] is a problem on the choices as far as "has this been touched yet" goes.
export function baseField(field: string): string {
	return field.replace(/\[\d+\]$/, '');
}
