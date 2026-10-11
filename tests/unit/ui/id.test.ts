import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReviewInputSchema } from '#lib/server/study/schema.ts';
import { newId } from '#lib/ui/id.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('newId', () => {
	it('returns a UUID v4 using randomUUID when it exists', () => {
		expect(newId()).toMatch(UUID);
	});

	it('still produces a valid UUID v4 when randomUUID is missing, as on a plain http page', () => {
		vi.stubGlobal('crypto', {
			getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto)
		});
		const ids = new Set(Array.from({ length: 200 }, () => newId()));
		expect(ids.size).toBe(200);
		for (const id of ids) expect(id).toMatch(UUID);
	});

	it('produces ids the server accepts as a reviewId', () => {
		const result = ReviewInputSchema.safeParse({
			reviewId: newId(),
			cardPk: 1,
			ordinal: 0,
			grade: 3,
			servedAt: '2026-10-10T12:00:00.000Z'
		});
		expect(result.success).toBe(true);
	});
});
