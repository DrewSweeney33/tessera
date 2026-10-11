import { createHash } from 'node:crypto';
import { canonicalJson, primaryText, type NormalizedCard } from '#lib/core/schema/normalize.ts';

export function sha256Hex(value: string): string {
	return createHash('sha256').update(value, 'utf8').digest('hex');
}

// Detects any change to a card: its type, authored fields, tags, or source.
// The id is excluded because it is the card's identity, not its content.
export function hashCard(card: NormalizedCard): string {
	return sha256Hex(
		canonicalJson({ type: card.type, content: card.content, tags: card.tags, source: card.source })
	);
}

// The key for a card without an id: "h-" plus a short hash of its type and text (ADR-002).
// The type is included so a basic card and a typed card with the same question stay distinct.
export function fallbackKey(card: NormalizedCard): string {
	return `h-${sha256Hex(`${card.type}\n${primaryText(card)}`).slice(0, 12)}`;
}
