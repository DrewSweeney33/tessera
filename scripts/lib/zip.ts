import { crc32, deflateRawSync } from 'node:zlib';

// A small zip writer, so the release can package the Claude skill without a zip program on the machine, and so
// the same inputs always give the same bytes (a reproducible release asset). It writes only what a skill needs:
// regular files, compressed with deflate, names in UTF-8.

export interface ZipEntry {
	// Path inside the archive, with forward slashes and no leading slash.
	name: string;
	data: Buffer;
}

// Every entry gets the same time, the zip epoch (1980-01-01 00:00), so the date of the build is not in the file.
const DOS_TIME = 0;
const DOS_DATE = (0 << 9) | (1 << 5) | 1;
const UTF8_NAMES = 0x0800;
// "Made on Unix" and "regular file, mode 644", so an extracted file is not executable.
const MADE_BY_UNIX = (3 << 8) | 20;
const FILE_MODE = (0o100644 << 16) >>> 0;

function checkName(name: string): void {
	if (
		name === '' ||
		name.startsWith('/') ||
		name.includes('\\') ||
		name.split('/').some((part) => part === '' || part === '.' || part === '..')
	) {
		throw new Error(`Not a safe path inside a zip file: "${name}"`);
	}
}

export function zip(entries: readonly ZipEntry[]): Buffer {
	const sorted = [...entries].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
	const names = new Set<string>();
	for (const entry of sorted) {
		checkName(entry.name);
		if (names.has(entry.name)) throw new Error(`Two entries are named "${entry.name}".`);
		names.add(entry.name);
	}

	const parts: Buffer[] = [];
	const central: Buffer[] = [];
	let offset = 0;

	for (const entry of sorted) {
		const name = Buffer.from(entry.name, 'utf8');
		const compressed = deflateRawSync(entry.data, { level: 9 });
		const crc = crc32(entry.data) >>> 0;

		const local = Buffer.alloc(30);
		local.writeUInt32LE(0x04034b50, 0);
		local.writeUInt16LE(20, 4); // version needed
		local.writeUInt16LE(UTF8_NAMES, 6);
		local.writeUInt16LE(8, 8); // deflate
		local.writeUInt16LE(DOS_TIME, 10);
		local.writeUInt16LE(DOS_DATE, 12);
		local.writeUInt32LE(crc, 14);
		local.writeUInt32LE(compressed.length, 18);
		local.writeUInt32LE(entry.data.length, 22);
		local.writeUInt16LE(name.length, 26);
		local.writeUInt16LE(0, 28); // no extra field
		parts.push(local, name, compressed);

		const header = Buffer.alloc(46);
		header.writeUInt32LE(0x02014b50, 0);
		header.writeUInt16LE(MADE_BY_UNIX, 4);
		header.writeUInt16LE(20, 6);
		header.writeUInt16LE(UTF8_NAMES, 8);
		header.writeUInt16LE(8, 10);
		header.writeUInt16LE(DOS_TIME, 12);
		header.writeUInt16LE(DOS_DATE, 14);
		header.writeUInt32LE(crc, 16);
		header.writeUInt32LE(compressed.length, 20);
		header.writeUInt32LE(entry.data.length, 24);
		header.writeUInt16LE(name.length, 28);
		header.writeUInt16LE(0, 30); // extra
		header.writeUInt16LE(0, 32); // comment
		header.writeUInt16LE(0, 34); // disk
		header.writeUInt16LE(0, 36); // internal attributes
		header.writeUInt32LE(FILE_MODE, 38);
		header.writeUInt32LE(offset, 42);
		central.push(header, name);

		offset += local.length + name.length + compressed.length;
	}

	const directory = Buffer.concat(central);
	const end = Buffer.alloc(22);
	end.writeUInt32LE(0x06054b50, 0);
	end.writeUInt16LE(sorted.length, 8);
	end.writeUInt16LE(sorted.length, 10);
	end.writeUInt32LE(directory.length, 12);
	end.writeUInt32LE(offset, 16);
	return Buffer.concat([...parts, directory, end]);
}
