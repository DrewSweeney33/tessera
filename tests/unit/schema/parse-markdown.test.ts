import { describe, expect, it } from 'vitest';
import { parseMarkdown } from '#lib/core/parse/index.ts';
import { LIMITS, type Deck } from '#lib/core/schema/index.ts';

// The Markdown format is read into the same object a JSON deck gives, then checked by the one validator.
// So these tests are about what the author wrote being understood, and about errors that point at lines.

const head = ['---', 'tessera: 1', 'id: d', 'title: Deck', '---', ''];
const md = (...lines: string[]) => [...head, ...lines].join('\n');

function ok(text: string): Deck {
	const result = parseMarkdown(text);
	if (!result.ok) throw new Error(JSON.stringify(result.error, null, 1));
	return result.value;
}

function errors(text: string) {
	const result = parseMarkdown(text);
	if (result.ok) throw new Error('expected a refusal');
	return result.error;
}

const cardsOf = (text: string) => ok(text).cards;

describe('the example from the specification', () => {
	const spec = [
		'---',
		'tessera: 1',
		'id: ccna-ospf',
		'title: "CCNA: OSPF"',
		'tags: [ccna]',
		'---',
		'',
		'## ospf-hello',
		'Q: Default OSPF hello interval on broadcast networks?',
		'A: 10 seconds',
		'Hint: Dead is 4x this',
		'Tags: timers',
		'Source: Lesson 3',
		'',
		'## ospf-dr',
		'Cloze: The {{c1::DR}} is elected by highest {{c2::priority}}.',
		'',
		'## ospf-show-nbr',
		'Q: Command to list OSPF neighbors?',
		'Answer: show ip ospf neighbor',
		'Accept: sh ip ospf nei',
		'',
		'## ospf-lsa',
		'Q: Which LSA type describes a network segment?',
		'Choices:',
		'- Type 1',
		'- [x] Type 2',
		'- Type 3',
		'- Type 5',
		'Explanation: The DR originates Type 2.'
	].join('\n');

	it('reads into the deck the JSON form gives', () => {
		expect(ok(spec)).toEqual({
			tessera: 1,
			deck: { id: 'ccna-ospf', title: 'CCNA: OSPF', tags: ['ccna'] },
			cards: [
				{
					id: 'ospf-hello',
					type: 'basic',
					front: 'Default OSPF hello interval on broadcast networks?',
					back: '10 seconds',
					hint: 'Dead is 4x this',
					tags: ['timers'],
					source: 'Lesson 3'
				},
				{
					id: 'ospf-dr',
					type: 'cloze',
					text: 'The {{c1::DR}} is elected by highest {{c2::priority}}.'
				},
				{
					id: 'ospf-show-nbr',
					type: 'typed',
					front: 'Command to list OSPF neighbors?',
					answer: 'show ip ospf neighbor',
					accept: ['sh ip ospf nei']
				},
				{
					id: 'ospf-lsa',
					type: 'choice',
					front: 'Which LSA type describes a network segment?',
					choices: ['Type 1', 'Type 2', 'Type 3', 'Type 5'],
					correct: 1,
					explanation: 'The DR originates Type 2.'
				}
			]
		});
	});
});

describe('card types', () => {
	it.each([
		['basic', ['## a', 'Q: front', 'A: back'], { type: 'basic', front: 'front', back: 'back' }],
		['cloze', ['## a', 'Cloze: A {{c1::b}} c'], { type: 'cloze', text: 'A {{c1::b}} c' }],
		['typed', ['## a', 'Q: front', 'Answer: x'], { type: 'typed', front: 'front', answer: 'x' }],
		[
			'choice',
			['## a', 'Q: front', 'Choices:', '- one', '- [x] two'],
			{ type: 'choice', front: 'front', choices: ['one', 'two'], correct: 1 }
		]
	])('is inferred as %s', (_name, lines, expected) => {
		expect(cardsOf(md(...lines))[0]).toMatchObject({ id: 'a', ...expected });
	});

	it('lets Type: say what the card is', () => {
		const [card] = cardsOf(md('## a', 'Type: typed', 'Q: front', 'Answer: x'));
		expect(card).toMatchObject({ type: 'typed' });
	});

	it('lets a bad Type: through to the validator, which lists the choices', () => {
		const [error] = errors(md('## a', 'Type: flip', 'Q: front', 'A: back'));
		expect(error).toMatchObject({ path: 'cards[0].type', code: 'invalid_value', line: 8 });
		expect(error!.allowed).toEqual(['basic', 'cloze', 'typed', 'choice']);
	});

	it('reads labels in any case', () => {
		expect(cardsOf(md('## a', 'q: front', 'ANSWER: x', 'accept: y'))[0]).toMatchObject({
			type: 'typed',
			accept: ['y']
		});
	});
});

describe('fields', () => {
	it('keeps a multi-line value, including blank lines and indentation', () => {
		const [card] = cardsOf(md('## a', 'Q: first', '', '  indented', 'last', '', 'A: back'));
		expect(card).toMatchObject({ front: 'first\n\n  indented\nlast' });
	});

	it('lets the value start on the line after the label', () => {
		const [card] = cardsOf(md('## a', 'Q:', 'on the next line', 'A: b'));
		expect(card).toMatchObject({ front: 'on the next line' });
	});

	it('removes blank lines at the start and whitespace at the end of a value only', () => {
		const [card] = cardsOf(md('## a', 'Q:', '', '', 'text   ', '', '', 'A: b'));
		expect(card).toMatchObject({ front: 'text' });
	});

	it('treats a label that is not at the start of a line as text', () => {
		const [card] = cardsOf(md('## a', 'Q: ask Q: again', 'A: see A: below'));
		expect(card).toMatchObject({ front: 'ask Q: again', back: 'see A: below' });
	});

	it('treats an unknown label as part of the field above it', () => {
		const [card] = cardsOf(md('## a', 'Q: front', 'Note: this stays in the question', 'A: back'));
		expect(card).toMatchObject({ front: 'front\nNote: this stays in the question' });
	});

	it('reads Tags and Accept as comma separated lists, trimmed, with empty items dropped', () => {
		const [card] = cardsOf(
			md('## a', 'Q: q', 'Answer: x', 'Accept: one,  two ,, three', 'Tags: a, b')
		);
		expect(card).toMatchObject({ accept: ['one', 'two', 'three'], tags: ['a', 'b'] });
	});

	it('lets an accepted answer hold a comma by escaping it, and joins repeated Accept lines', () => {
		const [card] = cardsOf(
			md('## a', 'Q: q', 'Answer: x', String.raw`Accept: ospf\, eigrp, plain`, 'Accept: more')
		);
		expect(card).toMatchObject({ accept: ['ospf, eigrp', 'plain', 'more'] });
	});

	it('refuses a field repeated in one card, at the second one', () => {
		const [error] = errors(md('## a', 'Q: one', 'A: b', 'Q: two'));
		expect(error).toMatchObject({ code: 'duplicate_field', line: 10 });
		expect(error!.message).toContain('Q:');
	});
});

describe('code fences are opaque', () => {
	it('never reads a label or heading inside a fence', () => {
		const [card] = cardsOf(
			md(
				'## a',
				'Q: what does this print?',
				'```',
				'A: not a label',
				'## not a card',
				'```',
				'A: the real answer'
			)
		);
		expect(card).toMatchObject({
			front: 'what does this print?\n```\nA: not a label\n## not a card\n```',
			back: 'the real answer'
		});
	});

	it('handles tilde fences, longer fences, and info text', () => {
		const text = md(
			'## a',
			'Q: x',
			'~~~text',
			'Answer: no',
			'~~~',
			'````md',
			'```',
			'A: no',
			'```',
			'````',
			'A: yes'
		);
		expect(cardsOf(text)[0]).toMatchObject({ type: 'basic', back: 'yes' });
	});

	it('does not close a fence with a shorter one, or a different character', () => {
		const text = md(
			'## a',
			'Q: x',
			'````',
			'```',
			'A: no',
			'~~~~',
			'A: still no',
			'````',
			'A: yes'
		);
		expect(cardsOf(text)[0]).toMatchObject({ back: 'yes' });
	});

	it('starts a fence on the label line', () => {
		const [card] = cardsOf(md('## a', 'Q: show', 'A: ```', 'Q: inside', '```'));
		expect(card).toMatchObject({ back: '```\nQ: inside\n```' });
	});

	it('does not treat inline code with backticks as a fence', () => {
		const [card] = cardsOf(md('## a', 'Q: ```code``` then', 'A: ok'));
		expect(card).toMatchObject({ front: '```code``` then', back: 'ok' });
	});

	it('reports a fence that is never closed, where it opened', () => {
		const [error, ...rest] = errors(md('## a', 'Q: x', 'A: ```', 'code', 'more'));
		expect(rest).toEqual([]);
		expect(error).toMatchObject({ code: 'unclosed_fence', line: 9 });
	});
});

describe('the escape for text that looks like a label', () => {
	it('reads one backslash before a label or heading as ordinary text', () => {
		const [card] = cardsOf(
			md('## a', 'Q: ask', String.raw`\A: not a field`, String.raw`\## not a card`, 'A: b')
		);
		expect(card).toMatchObject({ front: 'ask\nA: not a field\n## not a card' });
	});

	it('removes exactly one backslash', () => {
		const [card] = cardsOf(md('## a', 'Q: ask', String.raw`\\A: two slashes`, 'A: b'));
		expect(card).toMatchObject({ front: String.raw`ask` + '\n' + String.raw`\A: two slashes` });
	});

	it('leaves a backslash that is not in front of a label alone', () => {
		const [card] = cardsOf(md('## a', 'Q: C:\\temp', String.raw`\n and \x`, 'A: b'));
		expect(card).toMatchObject({ front: 'C:\\temp\n' + String.raw`\n and \x` });
	});
});

describe('headings and ids', () => {
	it('makes an id-less card from a bare ##', () => {
		const [card] = cardsOf(md('##', 'Q: q', 'A: a'));
		expect(card).not.toHaveProperty('id');
	});

	it('reads the id from the heading, trimmed', () => {
		expect(cardsOf(md('##   spaced-id   ', 'Q: q', 'A: a'))[0]).toMatchObject({ id: 'spaced-id' });
	});

	it('does not treat ### or deeper as a card', () => {
		const [card] = cardsOf(md('## a', 'Q: q', 'A: text', '### a sub heading', 'more'));
		expect(card).toMatchObject({ back: 'text\n### a sub heading\nmore' });
	});

	it('says what is wrong with an id, at the heading line', () => {
		const [error] = errors(md('## OSPF hello timers', 'Q: q', 'A: a'));
		expect(error).toMatchObject({ path: 'cards[0].id', code: 'invalid_format', line: 7 });
		expect(error!.message).toContain('lowercase');
	});

	it('refuses two cards with one id, at the second heading', () => {
		const [error] = errors(md('## a', 'Q: q', 'A: a', '', '## a', 'Q: r', 'A: b'));
		expect(error).toMatchObject({ code: 'duplicate_id', line: 11 });
	});
});

describe('what is outside a card or a field', () => {
	it('allows blank lines, a title heading, and a comment before the first card', () => {
		const text = md(
			'',
			'# My deck title',
			'',
			'<!-- written by Claude -->',
			'',
			'## a',
			'Q: q',
			'A: a'
		);
		expect(cardsOf(text)).toHaveLength(1);
	});

	it('refuses other text before the first card', () => {
		const [error] = errors(md('Here is your deck:', '', '## a', 'Q: q', 'A: a'));
		expect(error).toMatchObject({ code: 'text_before_first_card', line: 7 });
	});

	it('refuses a field before any card', () => {
		const [error] = errors(md('Q: q', 'A: a', '## a', 'Q: q', 'A: a'));
		expect(error).toMatchObject({ code: 'field_outside_card', line: 7 });
	});

	it('refuses text under a heading that is not in a field', () => {
		const [error] = errors(md('## a', 'some words', 'Q: q', 'A: a'));
		expect(error).toMatchObject({ code: 'text_outside_field', line: 8 });
	});

	it('refuses a heading with nothing under it', () => {
		const [error] = errors(md('## a', '', '## b', 'Q: q', 'A: a'));
		expect(error).toMatchObject({ code: 'empty_card', path: 'cards[0]', line: 7 });
	});

	it('refuses a deck with no cards at all', () => {
		expect(errors(md('Just prose')).map((e) => e.code)).toContain('text_before_first_card');
		expect(errors(md()).map((e) => e.code)).toEqual(['too_few']);
	});
});

describe('working out the card type', () => {
	it('says when a question has no answer', () => {
		const [error] = errors(md('## a', 'Q: q only'));
		expect(error).toMatchObject({ code: 'cannot_infer_type', line: 8 });
		expect(error!.message).toContain('A:');
		expect(error!.message).toContain('Answer:');
		expect(error!.message).toContain('Choices:');
	});

	it('says when a question has two kinds of answer', () => {
		const [error] = errors(md('## a', 'Q: q', 'A: basic', 'Answer: typed'));
		expect(error).toMatchObject({ code: 'ambiguous_card_type' });
		expect(error!.message).toContain('A:');
		expect(error!.message).toContain('Answer:');
		expect(error!.message).toContain('together');
	});

	it('says when there is no question and no cloze', () => {
		const [error] = errors(md('## a', 'A: back only'));
		expect(error).toMatchObject({ code: 'cannot_infer_type', line: 7 });
	});

	it('hands a field that does not belong to the type to the validator, with its line', () => {
		const [error] = errors(md('## a', 'Q: q', 'A: b', 'Accept: x'));
		expect(error).toMatchObject({ path: 'cards[0].accept', code: 'unknown_field', line: 10 });
	});
});

describe('a label indented under a choice', () => {
	// A formatter or a model can indent the lines after a list. Reading them as part of the last choice would
	// change the deck without a word, so they are refused and the error says what to do.
	const choices = (...after: string[]) =>
		md('## a', 'Q: q', 'Choices:', '- one', '- [x] two', ...after);

	it.each([
		'Explanation: because',
		'Source: Ch 4',
		'Tags: x',
		'Hint: h',
		'Q: again',
		'explanation: lower'
	])('refuses "%s" indented two spaces and says which line', (label) => {
		const result = errors(choices(`  ${label}`));
		expect(result).toHaveLength(1);
		expect(result[0]).toMatchObject({
			code: 'label_in_choice',
			path: 'cards[0].choices',
			line: 12
		});
		expect(result[0]!.message).toContain('indented');
		expect(result[0]!.message).toContain('backslash');
	});

	it('refuses one indented with a tab, and a one space indent is refused as not a choice at all', () => {
		expect(errors(choices('\tExplanation: x'))[0]).toMatchObject({ code: 'label_in_choice' });
		expect(errors(choices(' Explanation: x'))[0]).toMatchObject({ code: 'invalid_choice_line' });
	});

	it('names the label in the message', () => {
		expect(errors(choices('  Explanation: because'))[0]!.message).toContain('(Explanation:)');
	});

	it('reads the same label at the start of the line as a field, as always', () => {
		expect(cardsOf(choices('Explanation: because'))[0]).toMatchObject({
			choices: ['one', 'two'],
			explanation: 'because'
		});
	});

	it('keeps an escaped one as text of the choice, with one backslash removed', () => {
		expect(cardsOf(choices('  \\Explanation: part of the choice'))[0]).toMatchObject({
			choices: ['one', 'two\nExplanation: part of the choice']
		});
		expect(cardsOf(choices('  \\\\Source: two backslashes'))[0]).toMatchObject({
			choices: ['one', 'two\n\\Source: two backslashes']
		});
	});

	it('leaves deeper indentation and other indented text alone', () => {
		expect(
			cardsOf(choices('    Explanation: code', '  ## not a card', '  - a nested bullet'))[0]
		).toMatchObject({
			choices: ['one', 'two\n  Explanation: code\n## not a card\n- a nested bullet']
		});
	});

	it('reports every one, not only the first', () => {
		const result = errors(choices('  Explanation: x', '  Source: y'));
		expect(result.map((e) => [e.code, e.line])).toEqual([
			['label_in_choice', 12],
			['label_in_choice', 13]
		]);
	});

	it('is what a formatter does to a deck, so the example in the docs says not to run one', () => {
		const formatted = [
			'---',
			'tessera: 1',
			'id: d',
			'title: D',
			'---',
			'',
			'## a',
			'',
			'Q: q',
			'Choices:',
			'',
			'- one',
			'- [x] two',
			'  Explanation: because',
			'  Tags: x',
			''
		].join('\n');
		expect(errors(formatted).map((e) => e.code)).toEqual(['label_in_choice', 'label_in_choice']);
	});
});

describe('Choices', () => {
	const choice = (...items: string[]) => md('## a', 'Q: q', 'Choices:', ...items);

	it('reads dash, star, and plus bullets, and any case of the marker', () => {
		const [card] = cardsOf(choice('- one', '* [ ] two', '+ [X] three'));
		expect(card).toMatchObject({ choices: ['one', 'two', 'three'], correct: 2 });
	});

	it('lets blank lines separate the items', () => {
		const [card] = cardsOf(choice('- one', '', '- [x] two'));
		expect(card).toMatchObject({ choices: ['one', 'two'], correct: 1 });
	});

	it('joins an indented line to the item above it', () => {
		const [card] = cardsOf(choice('- first line', '  second line', '- [x] other'));
		expect(card).toMatchObject({ choices: ['first line\nsecond line', 'other'] });
	});

	it('keeps text that starts with a bracket when it is not a marker', () => {
		const [card] = cardsOf(choice('- [array] of items', '- [x] [x] literal'));
		expect(card).toMatchObject({ choices: ['[array] of items', '[x] literal'], correct: 1 });
	});

	it('asks for exactly one right choice, none marked', () => {
		const [error] = errors(choice('- one', '- two'));
		expect(error).toMatchObject({ code: 'no_correct_choice', path: 'cards[0].correct', line: 9 });
		expect(error!.message).toContain('[x]');
	});

	it('asks for exactly one right choice, several marked, and names the lines', () => {
		const [error] = errors(choice('- [x] one', '- two', '- [x] three'));
		expect(error).toMatchObject({ code: 'multiple_correct_choices' });
		expect(error!.message).toContain('lines 10, 12');
	});

	it('refuses a line that is not a list item', () => {
		const [error] = errors(choice('- one', 'not a list item', '- [x] two'));
		expect(error).toMatchObject({ code: 'invalid_choice_line', line: 11 });
	});

	it('points validator errors at the choice that caused them', () => {
		const [error] = errors(choice('- same', '- [x] other', '- Same'));
		expect(error).toMatchObject({
			path: 'cards[0].choices[2]',
			code: 'duplicate_choice',
			line: 12
		});
	});

	it('points a too-short list at the label', () => {
		const [error] = errors(choice('- [x] only one'));
		expect(error).toMatchObject({ path: 'cards[0].choices', code: 'too_few', line: 9 });
	});
});

describe('the block at the top', () => {
	it('reads description, tags, and a quoted title', () => {
		const text = [
			'---',
			'tessera: 1',
			'id: d',
			'title: "A: title, with punctuation"',
			'description: |',
			'  Two lines',
			'  of text',
			'tags: [one, two]',
			'---',
			'## a',
			'Q: q',
			'A: a'
		].join('\n');
		expect(ok(text).deck).toEqual({
			id: 'd',
			title: 'A: title, with punctuation',
			description: 'Two lines\nof text\n',
			tags: ['one', 'two']
		});
	});

	it('is required, and says what to put in it', () => {
		const [error] = errors('## a\nQ: q\nA: a');
		expect(error).toMatchObject({ code: 'missing_frontmatter', line: 1 });
		expect(error!.message).toContain('tessera: 1');
	});

	it('says when it is a JSON deck', () => {
		const [error] = errors('{ "tessera": 1 }');
		expect(error).toMatchObject({ code: 'not_markdown_is_json' });
	});

	it('must be closed', () => {
		const [error] = errors('---\ntessera: 1\nid: d\n');
		expect(error).toMatchObject({ code: 'unclosed_frontmatter', line: 1 });
	});

	it('reports YAML mistakes with the line in the file', () => {
		const [error] = errors(
			['---', 'tessera: 1', 'id: [unclosed', 'title: T', '---', '## a', 'Q: q', 'A: a'].join('\n')
		);
		expect(error).toMatchObject({ code: 'invalid_frontmatter', path: 'frontmatter' });
		expect(error!.line).toBeGreaterThanOrEqual(3);
	});

	it('refuses a block that is not a list of fields', () => {
		const [error] = errors('---\n- just\n- a list\n---\n## a\nQ: q\nA: a');
		expect(error).toMatchObject({ code: 'invalid_frontmatter' });
	});

	it('refuses a repeated field', () => {
		const [error] = errors('---\ntessera: 1\nid: a\nid: b\ntitle: T\n---\n## a\nQ: q\nA: a');
		expect(error).toMatchObject({ code: 'invalid_frontmatter' });
	});

	it('refuses YAML tags that name code or types, and aliases beyond the limit', () => {
		expect(
			errors('---\ntessera: 1\nid: d\ntitle: !!js/function "x"\n---\n## a\nQ: q\nA: a')[0]
		).toMatchObject({
			code: 'invalid_frontmatter'
		});
		const aliases = [
			'---',
			'tessera: 1',
			'id: d',
			'title: T',
			'a: &x one',
			...Array.from({ length: 12 }, (_, i) => `k${i}: *x`),
			'---',
			'## a',
			'Q: q',
			'A: a'
		].join('\n');
		expect(errors(aliases)[0]).toMatchObject({ code: 'invalid_frontmatter' });
	});

	it('does not run anything for the old --- js front matter', () => {
		const text = ['---js', '{ tessera: 1 }', '---', '## a', 'Q: q', 'A: a'].join('\n');
		expect(parseMarkdown(text).ok).toBe(false);
	});

	it('asks for tessera: 1 in Markdown words, at the block', () => {
		const [error] = errors('---\nid: d\ntitle: T\n---\n## a\nQ: q\nA: a');
		expect(error).toMatchObject({ path: 'tessera', code: 'required', line: 1 });
		expect(error!.message).toContain('tessera: 1');
		expect(error!.message).not.toContain('"tessera"');
	});

	it('refuses another version', () => {
		expect(errors('---\ntessera: 2\nid: d\ntitle: T\n---\n## a\nQ: q\nA: a')[0]).toMatchObject({
			code: 'unsupported_version',
			line: 2
		});
	});

	it('points an unknown field at its line and lists the allowed ones', () => {
		const [error] = errors('---\ntessera: 1\nid: d\ntitle: T\nauthor: me\n---\n## a\nQ: q\nA: a');
		expect(error).toMatchObject({ path: 'deck.author', code: 'unknown_field', line: 5 });
		expect(error!.allowed).toEqual(['id', 'title', 'description', 'tags']);
	});

	it('points a bad deck field at its line', () => {
		const [error] = errors('---\ntessera: 1\nid: Bad Id\ntitle: T\n---\n## a\nQ: q\nA: a');
		expect(error).toMatchObject({ path: 'deck.id', code: 'invalid_format', line: 3 });
	});
});

describe('how the text arrives', () => {
	const body = [...head, '## a', 'Q: q', 'A: a'].join('\n');

	it('accepts Windows line endings and a byte order mark, with the same result', () => {
		expect(ok('\ufeff' + body.replace(/\n/g, '\r\n'))).toEqual(ok(body));
	});

	it('accepts old Mac line endings', () => {
		expect(ok(body.replace(/\n/g, '\r'))).toEqual(ok(body));
	});

	it('accepts leading blank lines', () => {
		expect(ok('\n\n' + body)).toEqual(ok(body));
	});

	it('removes a code fence a chat put around the whole deck, and counts its line', () => {
		for (const wrap of [
			['```markdown', '```'],
			['```', '```'],
			['~~~md', '~~~'],
			['````markdown', '````']
		]) {
			const wrapped = [wrap[0], body, wrap[1]].join('\n');
			expect(ok(wrapped)).toEqual(ok(body));
		}
		const broken = ['```markdown', ...head, '## a', 'Q: only a question', '```'].join('\n');
		expect(errors(broken)[0]).toMatchObject({ code: 'cannot_infer_type', line: 9 });
	});

	it('keeps a fence inside a card when the whole deck is wrapped in a longer one', () => {
		const text = [
			'````markdown',
			...head,
			'## a',
			'Q: x',
			'A:',
			'```bash',
			'show ip route',
			'```',
			'````'
		].join('\n');
		expect(ok(text).cards[0]).toMatchObject({ back: '```bash\nshow ip route\n```' });
	});

	it('numbers lines from the original text', () => {
		const [error] = errors('\n\n' + md('## a', 'Q: q only'));
		expect(error).toMatchObject({ line: 10 });
	});

	it('refuses empty input and input over the size limit', () => {
		expect(errors('  \n ')[0]).toMatchObject({ code: 'empty' });
		expect(errors('x'.repeat(5 * 1024 * 1024 + 1))[0]).toMatchObject({ code: 'payload_too_large' });
	});
});

describe('errors from the validator carry lines', () => {
	it('puts the line of the field on a field problem', () => {
		const [error] = errors(md('## a', 'Q: q', 'A: ', ''));
		expect(error).toMatchObject({ path: 'cards[0].back', line: 9 });
	});

	it('puts the heading line on a missing field', () => {
		const [error] = errors(md('## a', 'Q: q', 'Type: basic'));
		expect(error).toMatchObject({ path: 'cards[0].back', code: 'required', line: 7 });
	});

	it('reports an unclosed cloze blank with the cloze line, and its own position in the text', () => {
		const [error] = errors(md('## a', 'Cloze: A {{c1::never closed'));
		expect(error).toMatchObject({ path: 'cards[0].text', code: 'unclosed_cloze', line: 8 });
	});

	it('numbers several cards correctly', () => {
		const result = errors(
			md('## a', 'Q: q', 'A: a', '', '## b', 'Q: q', 'A: ', '', '## c', 'Q: q', 'A: a')
		);
		expect(result).toHaveLength(1);
		expect(result[0]).toMatchObject({ path: 'cards[1].back', line: 13 });
	});

	it('caps the list and says how many were left out', () => {
		const cards = Array.from({ length: 80 }, (_, i) => ['## c' + i, 'Q: q', 'A: '].join('\n')).join(
			'\n\n'
		);
		const result = errors(md(cards));
		expect(result.length).toBe(51);
		expect(result.at(-1)).toMatchObject({ code: 'too_many_errors' });
	});

	it('sorts errors by line', () => {
		const result = errors(md('## a', 'Q: q', 'A: ', '', '## b', 'Q: ', 'A: b'));
		const lines = result.map((e) => e.line ?? 0);
		expect(lines).toEqual([...lines].sort((a, b) => a - b));
	});
});

// Each test below pins a rule that a mutation check (deliberately breaking one line of the reader and seeing
// whether any test noticed) showed was not yet covered.
describe('rules found uncovered by mutation checking', () => {
	it('reads the Type value in any case, and does not take it for another field', () => {
		expect(cardsOf(md('## a', 'Type: BASIC', 'Q: q', 'A: a'))[0]).toEqual({
			id: 'a',
			type: 'basic',
			front: 'q',
			back: 'a'
		});
		expect(cardsOf(md('## c', 'type:  Cloze', 'Cloze: x {{c1::y}}'))[0]).toMatchObject({
			type: 'cloze'
		});
	});

	it('drops trailing spaces from the end of a choice, but keeps them inside it', () => {
		expect(
			cardsOf(md('## a', 'Q: q', 'Choices:', '- one   ', '- [x] two  ', '  more   '))[0]
		).toMatchObject({ choices: ['one', 'two  \nmore'], correct: 1 });
	});

	it('finds a code fence in a choice however far it is indented, and closes it the same way', () => {
		const closed = md(
			'## a',
			'Q: q',
			'Choices:',
			'- [x] code',
			'     ```',
			'     x',
			'     ```',
			'- other'
		);
		expect(cardsOf(closed)[0]).toMatchObject({ choices: ['code\n   ```\n   x\n   ```', 'other'] });

		const open = md('## a', 'Q: q', 'Choices:', '- [x] code', '     ```', '- other');
		expect(errors(open)[0]).toMatchObject({ code: 'unclosed_fence', line: 11 });
	});

	it('does not unwrap a fence that is closed by a shorter or different fence', () => {
		const inner = md('## a', 'Q: q', 'A: a');
		expect(errors('````markdown\n' + inner + '\n```')[0]?.code).toBe('missing_frontmatter');
		expect(errors('```markdown\n' + inner + '\n~~~')[0]?.code).toBe('missing_frontmatter');
		expect(cardsOf('```markdown\n' + inner + '\n````')).toHaveLength(1);
	});

	it('accepts a deck of exactly the size limit and refuses one byte more', () => {
		const base = md('## a', 'Q: q', 'A: a');
		const pad = LIMITS.maxBodyBytes - new TextEncoder().encode(base).length;
		expect(parseMarkdown(base + ' '.repeat(pad)).ok).toBe(true);
		expect(errors(base + ' '.repeat(pad + 1))[0]?.code).toBe('payload_too_large');
	});

	it('lists errors in the order of the file, whichever stage found them', () => {
		const result = errors(
			md('## a', 'Q: q', 'A: a', 'A: again', '', '## b', 'stray words', '## c', 'Q: q2', 'A: a2')
		);
		expect(result.map((e) => [e.code, e.line])).toEqual([
			['duplicate_field', 10],
			['empty_card', 12],
			['text_outside_field', 13]
		]);
	});

	it('puts the missing-answer error of an empty Choices list on the Choices line', () => {
		const result = errors(md('## a', 'Q: q', 'Choices:'));
		expect(result).toContainEqual(expect.objectContaining({ path: 'cards[0].correct', line: 9 }));
	});

	it('allows blank lines between a heading and its first field', () => {
		expect(cardsOf(md('## a', '', '', 'Q: q', '', 'A: a'))[0]).toMatchObject({
			front: 'q',
			back: 'a'
		});
	});

	it('ends the block at the top at a "..." line, as YAML allows', () => {
		const text = ['---', 'tessera: 1', 'id: d', 'title: T', '...', '', '## a', 'Q: q', 'A: a'].join(
			'\n'
		);
		expect(ok(text).deck.title).toBe('T');
	});

	it('takes only a line of exactly --- as the start of the block, trailing spaces aside', () => {
		const rest = ['tessera: 1', 'id: d', 'title: T', '---', '## a', 'Q: q', 'A: a'];
		expect(errors(['---x', ...rest].join('\n'))[0]?.code).toBe('missing_frontmatter');
		expect(errors(['--- x', ...rest].join('\n'))[0]?.code).toBe('missing_frontmatter');
		expect(ok(['---  ', ...rest].join('\n')).cards).toHaveLength(1);
	});

	it('does not take a fence marker indented four spaces for a fence, but three spaces for one', () => {
		const four = cardsOf(md('## a', 'Q: q', 'A: a', '    ```', 'Hint: still a label'))[0];
		expect(four).toMatchObject({ back: 'a\n    ```', hint: 'still a label' });

		const three = cardsOf(
			md('## a', 'Q: q', 'A: a', '   ```', 'Hint: code', '   ```', 'Hint: real')
		)[0];
		expect(three).toMatchObject({ back: 'a\n   ```\nHint: code\n   ```', hint: 'real' });
	});

	it('splits Tags and Accept at line breaks as well as commas', () => {
		const card = cardsOf(
			md('## a', 'Q: q', 'Answer: x', 'Accept: one, two', 'three', 'Tags: a', 'b, c')
		)[0];
		expect(card).toMatchObject({ accept: ['one', 'two', 'three'], tags: ['a', 'b', 'c'] });
	});
});

describe('robustness', () => {
	it('never throws, whatever it is given', () => {
		const pieces = [
			'---',
			'## a',
			'Q: ',
			'A: x',
			'Cloze: {{c1::',
			'```',
			'~~~',
			'Choices:',
			'- [x] a',
			'\\Q:',
			'',
			'\r',
			'Answer: ',
			'Tags: a,b',
			'    ',
			'<!--',
			'###'
		];
		let seed = 99;
		const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648);
		for (let n = 0; n < 400; n++) {
			let text = '';
			for (let k = 0; k < 25; k++) text += pieces[next() % pieces.length] + '\n';
			expect(() => parseMarkdown(text), JSON.stringify(text)).not.toThrow();
		}
	});

	it('reads a 5,000 card deck quickly', () => {
		const cards = Array.from(
			{ length: 5000 },
			(_, i) => `## c${i}\nQ: Question ${i}\nA: Answer ${i}\nTags: t${i % 7}`
		).join('\n\n');
		const started = performance.now();
		const result = parseMarkdown(md(cards));
		expect(result.ok).toBe(true);
		expect(performance.now() - started).toBeLessThan(2000);
	});

	it('does not slow down on long runs of one character', () => {
		const started = performance.now();
		for (const text of [
			md('## a', 'Q: ' + 'a'.repeat(100_000), 'A: b'),
			md('## a', 'Q: q', 'A: ' + ' '.repeat(100_000) + 'x'),
			md('Q:'.repeat(30_000))
		]) {
			parseMarkdown(text);
		}
		expect(performance.now() - started).toBeLessThan(1500);
	});
});
