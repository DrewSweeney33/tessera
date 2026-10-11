import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseJson } from '#lib/core/parse/index.ts';
import { LIMITS } from '#lib/core/schema/index.ts';

const fixtures = 'tests/fixtures/decks';

function read(...parts: string[]): string {
	return readFileSync(join(fixtures, ...parts), 'utf8');
}

function names(dir: string, extension: string): string[] {
	return readdirSync(join(fixtures, dir))
		.filter((file) => file.endsWith(extension) && !file.endsWith('.expected.json'))
		.map((file) => file.slice(0, -extension.length));
}

describe('parseJson: valid fixtures', () => {
	it.each(names('valid', '.json'))('%s imports cleanly', (name) => {
		const result = parseJson(read('valid', `${name}.json`));
		expect(result.ok, result.ok ? '' : JSON.stringify(result.error)).toBe(true);
	});

	it('keeps all card types and ids from the CCNA fixture', () => {
		const result = parseJson(read('valid', 'ccna-ospf.json'));
		if (!result.ok) throw new Error('expected ok');
		expect(result.value.deck.id).toBe('ccna-ospf');
		expect(result.value.cards).toHaveLength(8);
		expect(new Set(result.value.cards.map((c) => c.type))).toEqual(
			new Set(['basic', 'cloze', 'typed', 'choice'])
		);
	});

	it('preserves code fences and unicode exactly', () => {
		const result = parseJson(read('valid', 'rich-markdown.json'));
		if (!result.ok) throw new Error('expected ok');
		const first = result.value.cards[0];
		expect(first?.type === 'basic' && first.front).toContain('```');
		const unicode = result.value.cards.find((c) => c.id === 'unicode');
		expect(unicode?.type === 'basic' && unicode.front).toContain('日本語');
	});
});

describe('parseJson: invalid fixtures report exact path-level errors', () => {
	it.each(names('invalid', '.json'))('%s', (name) => {
		const expected = JSON.parse(read('invalid', `${name}.expected.json`)) as {
			path: string;
			code: string;
		}[];
		const result = parseJson(read('invalid', `${name}.json`));
		if (result.ok) throw new Error('expected validation to fail');
		expect(result.error.map((e) => ({ path: e.path, code: e.code }))).toEqual(expected);
	});
});

describe('parseJson: syntax problems', () => {
	it.each(names('invalid-syntax', '.txt'))('%s', (name) => {
		const expected = JSON.parse(read('invalid-syntax', `${name}.expected.json`)) as {
			code: string;
			line?: number;
			column?: number;
		};
		const result = parseJson(read('invalid-syntax', `${name}.txt`));
		if (result.ok) throw new Error('expected a syntax error');
		expect(result.error).toHaveLength(1);
		const error = result.error[0]!;
		expect(error.path).toBe('(root)');
		expect(error.code).toBe(expected.code);
		if (expected.line !== undefined) expect(error.line).toBe(expected.line);
		if (expected.column !== undefined) expect(error.column).toBe(expected.column);
	});

	it('gives actionable advice for common mistakes', () => {
		const message = (name: string) => {
			const result = parseJson(read('invalid-syntax', `${name}.txt`));
			if (result.ok) throw new Error('expected failure');
			return result.error[0]!.message;
		};
		expect(message('trailing-comma')).toContain('trailing comma');
		expect(message('truncated')).toContain('cut off');
		expect(message('prose-before')).toContain('introduction from Claude');
		expect(message('markdown-input')).toContain('Import it as Markdown');
		expect(message('comment')).toContain('comments are not allowed');
	});
});

describe('parseJson: locating "Unexpected token" errors', () => {
	// V8 reports a position for most syntax errors but only a raw snippet for these.
	const locate = (text: string) => {
		const result = parseJson(text);
		if (result.ok) throw new Error('expected failure');
		return result.error[0]!;
	};

	it.each([
		['a trailing comma in an array', '[1,]', 1, 4, ']'],
		['a leading dot in a number', '[.5]', 1, 2, '.'],
		['a stray comma on a later line', '{\n  "a": 1,\n  "b": [ ,\n}', 3, 10, ','],
		['a bad token deep in a long text', `{"a":[${'1,'.repeat(5000)}]}`, 1, 10_007, ']']
	])('%s', (_name, text, line, column, character) => {
		const error = locate(text);
		expect(error.code).toBe('invalid_json');
		expect(error.line).toBe(line);
		expect(error.column).toBe(column);
		expect(error.message).toContain(`Unexpected character ${JSON.stringify(character)}`);
		expect(error.message).toContain(`line ${line}, column ${column}`);
	});

	it('does not print the raw source snippet', () => {
		expect(locate('{\n  "a": 1,\n  "b": [ ,\n}').message).not.toContain('is not valid JSON');
	});

	it('explains a trailing comma', () => {
		expect(locate('[1,]').message).toContain('trailing comma');
	});

	it('handles Windows line endings and a fence offset', () => {
		const error = locate('```json\r\n{\r\n  "a": [1,]\r\n}\r\n```');
		expect(error.line).toBe(3);
		expect(error.column).toBe(11);
	});
});

describe('parseJson: pasted input handling', () => {
	const deck = read('valid', 'minimal.json');

	it('accepts a deck wrapped in a json code fence', () => {
		expect(parseJson('```json\n' + deck.trim() + '\n```').ok).toBe(true);
		expect(parseJson('\n\n```\n' + deck.trim() + '\n```\n').ok).toBe(true);
	});

	it('reports syntax error lines relative to the original text when a fence is stripped', () => {
		const broken = '```json\n{\n  "tessera": 1,\n}\n```';
		const result = parseJson(broken);
		if (result.ok) throw new Error('expected failure');
		expect(result.error[0]!.line).toBe(4);
	});

	it('accepts a UTF-8 byte order mark and Windows line endings', () => {
		expect(parseJson('﻿' + deck).ok).toBe(true);
		expect(parseJson(deck.replace(/\n/g, '\r\n')).ok).toBe(true);
	});

	it('rejects input over the size limit before parsing', () => {
		const result = parseJson(' '.repeat(LIMITS.maxBodyBytes + 1));
		if (result.ok) throw new Error('expected failure');
		expect(result.error[0]!.code).toBe('payload_too_large');
	});

	it('reports non-object JSON values through the validator', () => {
		for (const text of ['null', '42', '"deck"', 'true']) {
			const result = parseJson(text);
			if (result.ok) throw new Error(`expected failure for ${text}`);
			expect(result.error[0]).toMatchObject({ path: '(root)', code: 'wrong_type' });
		}
	});

	it('never throws on arbitrary garbage', () => {
		for (const text of [
			'{',
			'}',
			'[',
			'{"a":',
			'\u0000',
			'undefined',
			'{"tessera":1,"deck":null,"cards":null}'
		]) {
			expect(() => parseJson(text)).not.toThrow();
		}
	});
});
