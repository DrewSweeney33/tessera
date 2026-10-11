import { expect, type APIRequestContext, type Page } from '@playwright/test';

export interface TestCard {
	id: string;
	type: 'basic' | 'cloze' | 'typed' | 'choice';
	[field: string]: unknown;
}

export function deckOf(id: string, title: string, cards: TestCard[]) {
	return { tessera: 1, deck: { id, title }, cards };
}

// Imports a deck straight through the API, bypassing the UI, to set up a scenario quickly.
export async function importViaApi(request: APIRequestContext, deck: unknown): Promise<void> {
	const response = await request.post('/api/import', {
		headers: { 'content-type': 'application/json' },
		data: JSON.stringify(deck)
	});
	expect(response.ok(), await response.text()).toBe(true);
}

export function basicCards(count: number, prefix = 'card'): TestCard[] {
	return Array.from({ length: count }, (_, i) => ({
		id: `${prefix}-${i + 1}`,
		type: 'basic' as const,
		front: `Question ${i + 1}`,
		back: `Answer ${i + 1}`
	}));
}

// True if the page scrolls sideways, which means something overflows the viewport.
export async function scrollsHorizontally(page: Page): Promise<boolean> {
	return page.evaluate(
		() => document.documentElement.scrollWidth > document.documentElement.clientWidth
	);
}
