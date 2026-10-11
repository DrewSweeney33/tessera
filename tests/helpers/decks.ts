import { validateDeck, type Deck } from '#lib/core/schema/index.ts';

// Builds a validated deck from loose card objects. Throws if the cards are invalid,
// so a test never silently exercises bad input.
export function makeDeck(
	cards: Record<string, unknown>[],
	meta: Record<string, unknown> = {}
): Deck {
	const result = validateDeck({
		tessera: 1,
		deck: { id: 'd1', title: 'Test deck', ...meta },
		cards
	});
	if (!result.ok) throw new Error(`invalid test deck: ${JSON.stringify(result.error)}`);
	return result.value;
}

export function basic(id: string, front = `Q ${id}`, back = `A ${id}`, extra = {}) {
	return { id, type: 'basic', front, back, ...extra };
}

export function cloze(id: string, text: string, extra = {}) {
	return { id, type: 'cloze', text, ...extra };
}
