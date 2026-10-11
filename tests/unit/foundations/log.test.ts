import { describe, expect, it } from 'vitest';
import { createLogger } from '#lib/server/log.ts';
import { fakeClock } from '../../helpers/fake-clock.ts';

function capture(level: 'debug' | 'info' | 'warn' | 'error' = 'info') {
	const lines: Record<string, unknown>[] = [];
	const clock = fakeClock('2026-10-10T12:00:00.000Z');
	const logger = createLogger({
		level,
		clock,
		write: (line) => lines.push(JSON.parse(line) as Record<string, unknown>)
	});
	return { lines, logger };
}

describe('logger', () => {
	it('writes one JSON object per event with time, level, and message', () => {
		const { lines, logger } = capture();
		logger.info('import committed', { deck: 'ccna', cards: 12 });
		expect(lines).toEqual([
			{
				time: '2026-10-10T12:00:00.000Z',
				level: 'info',
				msg: 'import committed',
				deck: 'ccna',
				cards: 12
			}
		]);
	});

	it('filters events below the configured level', () => {
		const { lines, logger } = capture('warn');
		logger.debug('d');
		logger.info('i');
		logger.warn('w');
		logger.error('e');
		expect(lines.map((l) => l.level)).toEqual(['warn', 'error']);
	});

	it('carries child fields into every event', () => {
		const { lines, logger } = capture();
		const requestLogger = logger.child({ requestId: 'r1' });
		requestLogger.info('hello', { route: '/api/decks' });
		expect(lines[0]).toMatchObject({ requestId: 'r1', route: '/api/decks' });
	});

	it('redacts card content, typed answers, and credentials', () => {
		const { lines, logger } = capture();
		logger.info('review', {
			typedAnswer: 'show ip route',
			front: 'Q',
			back: 'A',
			text: 'cloze {{c1::x}}',
			token: 'secret',
			Authorization: 'Bearer secret',
			cardKey: 'ospf-hello'
		});
		const line = lines[0]!;
		expect(line.typedAnswer).toBe('[redacted]');
		expect(line.front).toBe('[redacted]');
		expect(line.back).toBe('[redacted]');
		expect(line.text).toBe('[redacted]');
		expect(line.token).toBe('[redacted]');
		expect(line.Authorization).toBe('[redacted]');
		expect(line.cardKey).toBe('ospf-hello');
		expect(JSON.stringify(line)).not.toContain('secret');
	});

	it('redacts sensitive keys inherited from a child logger', () => {
		const { lines, logger } = capture();
		logger.child({ token: 'secret' }).info('x');
		expect(lines[0]!.token).toBe('[redacted]');
	});
});
