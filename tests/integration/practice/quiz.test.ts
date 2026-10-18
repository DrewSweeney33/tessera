import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp, type AppContext } from '#lib/server/app.ts';
import { parseConfig } from '#lib/server/config.ts';
import { createLogger } from '#lib/server/log.ts';
import { getPracticeItem, startPracticeSession } from '#lib/server/practice/index.ts';
import { getCardByKey, setDeckArchived, setSuspended } from '#lib/server/repos/index.ts';
import { basic, cloze, makeDeck } from '../../helpers/decks.ts';
import { fakeClock } from '../../helpers/fake-clock.ts';
import { importForSetup } from '../../helpers/setup-import.ts';
import { makeTempDir, type TempDir } from '../../helpers/temp-dir.ts';

// Quiz me (ADR-020): a basic or typed card comes back from the practice item as a choice card when a seed is sent,
// with its own answer and three wrong ones from other cards. Reads only, the same for the same seed.

let dir: TempDir;
let app: AppContext;

const SEED = 'abcd1234efgh5678';

beforeEach(() => {
	dir = makeTempDir();
	const config = parseConfig({ DATA_DIR: dir.path, TZ: 'America/Chicago' });
	if (!config.ok) throw new Error(config.error.join(', '));
	app = createApp({
		config: config.value,
		clock: fakeClock('2026-10-12T15:00:00.000Z'),
		rng: () => 0.5,
		log: createLogger({ level: 'error', write: () => {} })
	});
	importForSetup(
		app.db,
		makeDeck(
			[
				basic('p1', 'Which protocol uses Dijkstra?', 'OSPF'),
				basic('p2', 'Which protocol is a distance vector?', 'RIP'),
				basic('p3', 'Which protocol is Cisco proprietary?', 'EIGRP'),
				basic('p4', 'Which protocol is path vector?', 'BGP'),
				basic('p5', 'Which protocol is IS-IS?', 'Intermediate System'),
				{ id: 'p6', type: 'typed', front: 'Command to show routes?', answer: 'show ip route' },
				cloze('p7', 'The {{c1::DR}} is elected on a {{c2::broadcast}} network'),
				{
					id: 'p8',
					type: 'choice',
					front: 'Pick one',
					choices: ['x', 'y', 'z'],
					correct: 1
				}
			],
			{ id: 'proto', title: 'Protocols' }
		),
		app.clock
	);
	importForSetup(
		app.db,
		makeDeck(
			[basic('s1', 'What blocks loops?', 'STP'), basic('s2', 'What tags frames?', '802.1Q')],
			{
				id: 'sw',
				title: 'Switching'
			}
		),
		app.clock
	);
	importForSetup(
		app.db,
		makeDeck([basic('l1', 'Lonely card', 'Alone'), basic('l2', 'Other lonely card', 'Alone too')], {
			id: 'small',
			title: 'Small'
		}),
		app.clock
	);
});

afterEach(() => {
	if (app.database.sqlite.open) app.database.close();
	dir.cleanup();
});

const pk = (deckId: string, key: string) => getCardByKey(app.db, deckId, key)!.pk;
const item = (deckId: string, key: string, quizSeed?: string, ordinal = 0) =>
	getPracticeItem(app.db, pk(deckId, key), ordinal, quizSeed === undefined ? {} : { quizSeed });
const choicesOf = (dto: ReturnType<typeof item>) => (dto!.content as { choices: string[] }).choices;

describe('a basic card as a question', () => {
	it('is a choice card with its own answer once and three wrong ones from the same deck', () => {
		const dto = item('proto', 'p1', SEED)!;
		expect(dto.type).toBe('choice');
		expect(dto.quiz).toBe(true);
		const content = dto.content as { front: string; choices: string[]; correct: number };
		expect(content.front).toBe('Which protocol uses Dijkstra?');
		expect(content.choices).toHaveLength(4);
		expect(content.choices[content.correct]).toBe('OSPF');
		expect(content.choices.filter((choice) => choice === 'OSPF')).toHaveLength(1);
		const sameDeck = ['RIP', 'EIGRP', 'BGP', 'Intermediate System', 'show ip route'];
		for (const choice of content.choices.filter((c) => c !== 'OSPF')) {
			expect(sameDeck, choice).toContain(choice);
		}
		expect(new Set(content.choices).size).toBe(4);
	});

	it('keeps everything else of the item: ids, title, key, tags, state', () => {
		const plain = item('proto', 'p1')!;
		const quiz = item('proto', 'p1', SEED)!;
		for (const field of [
			'cardPk',
			'ordinal',
			'deckId',
			'deckTitle',
			'key',
			'tags',
			'state'
		] as const) {
			expect(quiz[field], field).toEqual(plain[field]);
		}
		expect(plain.type).toBe('basic');
		expect(plain.quiz).toBeUndefined();
		expect(plain.content).toEqual({ front: 'Which protocol uses Dijkstra?', back: 'OSPF' });
	});

	it('is the same for the same seed, and differs between seeds', () => {
		expect(item('proto', 'p1', SEED)).toEqual(item('proto', 'p1', SEED));
		const seen = new Set(
			Array.from({ length: 30 }, (_, i) =>
				choicesOf(item('proto', 'p1', `seed${String(i).padStart(8, '0')}`)).join('|')
			)
		);
		expect(seen.size).toBeGreaterThan(5);
		// Another card in the same session is arranged on its own.
		expect(item('proto', 'p2', SEED)!.content).not.toEqual(item('proto', 'p1', SEED)!.content);
	});
});

describe('a typed card as a question', () => {
	it('uses its answer as the right option', () => {
		const dto = item('proto', 'p6', SEED)!;
		expect(dto.type).toBe('choice');
		const content = dto.content as { front: string; choices: string[]; correct: number };
		expect(content.front).toBe('Command to show routes?');
		expect(content.choices[content.correct]).toBe('show ip route');
		expect(content.choices).toHaveLength(4);
	});
});

describe('a card that is not turned into a question', () => {
	it('stays as it is: cloze and choice cards, and any card without a seed', () => {
		const cloze = item('proto', 'p7', SEED, 1)!;
		expect(cloze.type).toBe('cloze');
		expect(cloze.quiz).toBeUndefined();
		const choice = item('proto', 'p8', SEED)!;
		expect(choice.type).toBe('choice');
		expect(choice.quiz).toBeUndefined();
		expect((choice.content as { choices: string[] }).choices).toEqual(['x', 'y', 'z']);
		expect(item('proto', 'p1')!.type).toBe('basic');
	});

	it('stays as it is when fewer than three wrong answers exist anywhere', () => {
		// Remove the other decks' answers from play: only 'small' (two cards) is left.
		setDeckArchived(app.db, 'proto', true, app.clock.now().toISOString());
		setDeckArchived(app.db, 'sw', true, app.clock.now().toISOString());
		const dto = item('small', 'l1', SEED)!;
		expect(dto.type).toBe('basic');
		expect(dto.quiz).toBeUndefined();
	});

	it('stays as it is when its own answer is not an option (several lines)', () => {
		app.database.sqlite
			.prepare('update cards set content = ? where pk = ?')
			.run(JSON.stringify({ front: 'Q', back: 'line one\nline two' }), pk('proto', 'p1'));
		expect(item('proto', 'p1', SEED)!.type).toBe('basic');
	});
});

describe('where the wrong options come from', () => {
	it('falls back to other decks when the card’s own deck has too few', () => {
		const dto = item('sw', 's1', SEED)!;
		expect(dto.type).toBe('choice');
		const content = dto.content as { choices: string[]; correct: number };
		expect(content.choices[content.correct]).toBe('STP');
		expect(content.choices).toContain('802.1Q');
		expect(content.choices).toHaveLength(4);
	});

	it('never uses the answers of a deck in the Trash, a suspended card, or the card itself', () => {
		setDeckArchived(app.db, 'sw', true, app.clock.now().toISOString());
		setDeckArchived(app.db, 'small', true, app.clock.now().toISOString());
		setSuspended(app.db, pk('proto', 'p2'), true);
		const content = item('proto', 'p1', SEED)!.content as { choices: string[] };
		expect(content.choices).not.toContain('STP');
		expect(content.choices).not.toContain('802.1Q');
		expect(content.choices).not.toContain('Alone');
		expect(content.choices).not.toContain('RIP');
		expect(content.choices.filter((choice) => choice === 'OSPF')).toHaveLength(1);
	});

	it('does not repeat the right answer when another card has the same answer', () => {
		app.database.sqlite
			.prepare('update cards set content = ? where pk = ?')
			.run(JSON.stringify({ front: 'Another', back: ' ospf ' }), pk('proto', 'p2'));
		const content = item('proto', 'p1', SEED)!.content as { choices: string[]; correct: number };
		expect(content.choices.map((choice) => choice.trim().toLowerCase())).toEqual(
			expect.arrayContaining(['ospf'])
		);
		expect(content.choices.filter((choice) => choice.trim().toLowerCase() === 'ospf')).toHaveLength(
			1
		);
	});
});

describe('quiz does not write anything', () => {
	it('leaves every table as it was, however many questions are built', () => {
		const tables = ['cards', 'card_state', 'decks', 'review_log', 'settings'];
		const snapshot = () =>
			tables.map((table) => app.database.sqlite.prepare(`select * from ${table}`).all());
		const before = snapshot();
		for (let i = 0; i < 25; i++) {
			item('proto', 'p1', `seed${String(i).padStart(8, '0')}`);
			item('proto', 'p6', `seed${String(i).padStart(8, '0')}`);
			item('sw', 's2', `seed${String(i).padStart(8, '0')}`);
		}
		expect(snapshot()).toEqual(before);
	});
});

describe('starting a quiz session', () => {
	const start = (quiz?: boolean) =>
		startPracticeSession(
			app.db,
			{
				scope: { deckId: 'proto' },
				count: 'all',
				order: 'shuffle',
				...(quiz === undefined ? {} : { quiz })
			},
			{ now: app.clock.now(), rng: () => 0.37 }
		);

	it('gives a seed of letters and digits only when asked for a quiz', () => {
		expect(start(true).quizSeed).toMatch(/^[a-z0-9]{16}$/);
		expect(start().quizSeed).toBeUndefined();
		expect(start(false).quizSeed).toBeUndefined();
	});

	it('uses the random source, so two sessions differ and a fixed source repeats', () => {
		let n = 0;
		const rng = () => (n += 0.113) % 1;
		const a = startPracticeSession(
			app.db,
			{ scope: { deckId: 'proto' }, count: 'all', order: 'shuffle', quiz: true },
			{ now: app.clock.now(), rng }
		);
		const b = startPracticeSession(
			app.db,
			{ scope: { deckId: 'proto' }, count: 'all', order: 'shuffle', quiz: true },
			{ now: app.clock.now(), rng }
		);
		expect(a.quizSeed).not.toBe(b.quizSeed);
		expect(start(true).quizSeed).toBe(start(true).quizSeed);
	});
});
