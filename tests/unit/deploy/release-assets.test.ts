import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32, inflateRawSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { zip } from '../../../scripts/lib/zip.ts';

// The release attaches the deck schema and the Claude skill (as a zip) to the GitHub release. The workflow cannot
// run here, so the step that builds those files is tested directly: the zip writer against a separate reader
// written for this test, and the packaging script by running it.

interface Read {
	name: string;
	data: Buffer;
	method: number;
	flags: number;
	mode: number;
}

// A reader that follows the zip format from the end of the file: the end record, then the central directory, then
// each local header. It checks sizes and the checksum of every file.
function unzip(archive: Buffer): Read[] {
	let end = archive.length - 22;
	while (end >= 0 && archive.readUInt32LE(end) !== 0x06054b50) end--;
	if (end < 0) throw new Error('no end of central directory record');
	const count = archive.readUInt16LE(end + 10);
	let at = archive.readUInt32LE(end + 16);
	const found: Read[] = [];
	for (let i = 0; i < count; i++) {
		if (archive.readUInt32LE(at) !== 0x02014b50) throw new Error('bad central directory entry');
		const flags = archive.readUInt16LE(at + 8);
		const method = archive.readUInt16LE(at + 10);
		const crc = archive.readUInt32LE(at + 16);
		const compressed = archive.readUInt32LE(at + 20);
		const size = archive.readUInt32LE(at + 24);
		const nameLength = archive.readUInt16LE(at + 28);
		const mode = archive.readUInt32LE(at + 38) >>> 16;
		const local = archive.readUInt32LE(at + 42);
		const name = archive.subarray(at + 46, at + 46 + nameLength).toString('utf8');

		if (archive.readUInt32LE(local) !== 0x04034b50) throw new Error('bad local header');
		const start = local + 30 + archive.readUInt16LE(local + 26) + archive.readUInt16LE(local + 28);
		const stored = archive.subarray(start, start + compressed);
		const data = method === 8 ? inflateRawSync(stored) : Buffer.from(stored);
		if (data.length !== size) throw new Error(`${name}: wrong size`);
		if (crc32(data) >>> 0 !== crc) throw new Error(`${name}: wrong checksum`);
		found.push({ name, data, method, flags, mode });
		at += 46 + nameLength + archive.readUInt16LE(at + 30) + archive.readUInt16LE(at + 32);
	}
	return found;
}

describe('the zip writer', () => {
	it('gives back exactly what went in, with a correct checksum for every file', () => {
		const entries = [
			{ name: 'a/one.txt', data: Buffer.from('hello hello hello hello') },
			{ name: 'a/two.bin', data: Buffer.from(Array.from({ length: 5000 }, (_, i) => i % 251)) },
			{ name: 'empty.txt', data: Buffer.alloc(0) }
		];
		const read = unzip(zip(entries));
		expect(read.map((r) => r.name)).toEqual(['a/one.txt', 'a/two.bin', 'empty.txt']);
		for (const entry of entries) {
			expect(read.find((r) => r.name === entry.name)!.data.equals(entry.data)).toBe(true);
		}
	});

	it('handles a megabyte of data and compresses repeated text', () => {
		const big = Buffer.from('tessera '.repeat(131072));
		const archive = zip([{ name: 'big.txt', data: big }]);
		expect(archive.length).toBeLessThan(big.length / 20);
		expect(unzip(archive)[0]!.data.equals(big)).toBe(true);
	});

	it('writes UTF-8 names, marks files as regular and not executable, and uses deflate', () => {
		const [file] = unzip(zip([{ name: 'tessera-deck/résumé.md', data: Buffer.from('x') }]));
		expect(file!.name).toBe('tessera-deck/résumé.md');
		expect(file!.flags & 0x0800).toBe(0x0800);
		expect(file!.method).toBe(8);
		expect(file!.mode).toBe(0o100644);
	});

	it('gives the same bytes for the same input in any order, with no date in the file', () => {
		const a = { name: 'b.txt', data: Buffer.from('b') };
		const c = { name: 'a.txt', data: Buffer.from('a') };
		const first = zip([a, c]);
		expect(zip([c, a]).equals(first)).toBe(true);
		expect(zip([a, c]).equals(first)).toBe(true);
		// The time and date fields of the first local header are the zip epoch.
		expect(first.readUInt16LE(10)).toBe(0);
		expect(first.readUInt16LE(12)).toBe(0x0021);
	});

	it('writes a valid empty archive', () => {
		const archive = zip([]);
		expect(archive.length).toBe(22);
		expect(unzip(archive)).toEqual([]);
	});

	it.each(['', '/etc/passwd', '../outside.txt', 'a/../b', 'a\\b', 'a//b', './a', 'dir/'])(
		'refuses the path %j, which could write outside the folder when extracted',
		(name) => {
			expect(() => zip([{ name, data: Buffer.from('x') }])).toThrow(/safe path/);
		}
	);

	it('refuses two entries with one name', () => {
		expect(() =>
			zip([
				{ name: 'a.txt', data: Buffer.from('1') },
				{ name: 'a.txt', data: Buffer.from('2') }
			])
		).toThrow(/Two entries/);
	});
});

describe('the packaging script', () => {
	const folders: string[] = [];
	afterEach(() => {
		for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
	});

	function run(version: string | undefined, extra: string[] = []) {
		const out = mkdtempSync(join(tmpdir(), 'tessera-assets-'));
		folders.push(out);
		const args = ['scripts/package-release-assets.ts', '--out', out, ...extra];
		if (version !== undefined) args.push('--version', version);
		const result = spawnSync(process.execPath, args, { encoding: 'utf8' });
		return { out, status: result.status, stdout: result.stdout, stderr: result.stderr };
	}

	it('writes the schema, the skill zip, and a checksum file, and nothing else', () => {
		const { out, status } = run('0.1.0');
		expect(status).toBe(0);
		expect(readdirSync(out).sort()).toEqual([
			'SHA256SUMS',
			'tessera-deck-skill-0.1.0.zip',
			'tessera-deck.v1.schema.json'
		]);
	});

	it('attaches the schema exactly as it is in the repository', () => {
		const { out } = run('0.1.0');
		expect(readFileSync(join(out, 'tessera-deck.v1.schema.json'), 'utf8')).toBe(
			readFileSync('static/schema/tessera-deck.v1.schema.json', 'utf8')
		);
	});

	it('puts the whole skill in the zip under a tessera-deck folder, as the skill upload expects', () => {
		const { out } = run('0.1.0');
		const files = unzip(readFileSync(join(out, 'tessera-deck-skill-0.1.0.zip')));
		expect(files.map((f) => f.name)).toEqual(['tessera-deck/SKILL.md']);
		expect(files[0]!.data.equals(readFileSync('claude-skill/tessera-deck/SKILL.md'))).toBe(true);
		expect(files[0]!.data.toString('utf8')).toMatch(/^---\nname: tessera-deck\n/);
	});

	it('writes checksums that match the files, in the form sha256sum -c reads', () => {
		const { out } = run('0.1.0');
		const lines = readFileSync(join(out, 'SHA256SUMS'), 'utf8').trimEnd().split('\n');
		expect(lines).toHaveLength(2);
		for (const line of lines) {
			const [, hash, name] = /^([0-9a-f]{64}) {2}(\S+)$/.exec(line) ?? [];
			expect(hash, line).toBeDefined();
			const actual = createHash('sha256')
				.update(readFileSync(join(out, name!)))
				.digest('hex');
			expect(actual, name).toBe(hash);
		}
	});

	it('is reproducible: two runs give identical files', () => {
		const first = run('0.1.0');
		const second = run('0.1.0');
		for (const file of readdirSync(first.out)) {
			expect(
				readFileSync(join(first.out, file)).equals(readFileSync(join(second.out, file))),
				file
			).toBe(true);
		}
	});

	it('names the zip after the version, including a release candidate, and reads the version from package.json by default', () => {
		expect(existsSync(join(run('0.1.0-rc.1').out, 'tessera-deck-skill-0.1.0-rc.1.zip'))).toBe(true);
		const version = (JSON.parse(readFileSync('package.json', 'utf8')) as { version: string })
			.version;
		expect(existsSync(join(run(undefined).out, `tessera-deck-skill-${version}.zip`))).toBe(true);
	});

	it.each(['', 'v0.1.0', '0.1', '../0.1.0', '0.1.0/x', '0.1.0 ', '$(id)', '0.1.0; rm -rf /'])(
		'refuses the version %j before writing anything',
		(version) => {
			const { out, status, stderr } = run(version);
			expect(status).toBe(1);
			expect(stderr).toContain('not a version');
			expect(readdirSync(out)).toEqual([]);
		}
	);
});
