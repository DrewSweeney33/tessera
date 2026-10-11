// Builds the files that are attached to a GitHub release, next to the container image:
//   tessera-deck.v1.schema.json         the JSON Schema of the deck format
//   tessera-deck-skill-<version>.zip    the Claude skill, as a zip with the folder tessera-deck/ at its root
//   SHA256SUMS                          a checksum for each of the above (check with: sha256sum -c SHA256SUMS)
//
//   node scripts/package-release-assets.ts --out release-assets --version 0.1.0
//
// It only reads files in the repository and writes into --out. It publishes nothing. The release workflow runs it,
// checks the result, and attaches it. Running it by hand is the rehearsal of that step.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { zip, type ZipEntry } from './lib/zip.ts';

const SCHEMA_SOURCE = 'static/schema/tessera-deck.v1.schema.json';
const SKILL_DIR = 'claude-skill/tessera-deck';
const SKILL_NAME = 'tessera-deck';
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

function option(name: string): string | undefined {
	const index = process.argv.indexOf(name);
	return index >= 0 ? process.argv[index + 1] : undefined;
}

function fail(message: string): never {
	console.error(`package-release-assets: ${message}`);
	process.exit(1);
}

function filesIn(directory: string): string[] {
	return readdirSync(directory)
		.sort()
		.flatMap((name) => {
			const path = join(directory, name);
			return statSync(path).isDirectory() ? filesIn(path) : [path];
		});
}

const out = option('--out') ?? 'release-assets';
const version =
	option('--version') ??
	(JSON.parse(readFileSync('package.json', 'utf8')) as { version: string }).version;
if (!VERSION_PATTERN.test(version))
	fail(`"${version}" is not a version such as 0.1.0 or 0.1.0-rc.1.`);

// The schema must be real JSON and describe a deck, or the asset would be a broken file with a good name.
const schemaText = readFileSync(SCHEMA_SOURCE, 'utf8');
try {
	const schema = JSON.parse(schemaText) as { properties?: Record<string, unknown> };
	if (!schema.properties || !('cards' in schema.properties)) throw new Error('no "cards" property');
} catch (error) {
	fail(
		`${SCHEMA_SOURCE} is not the deck schema: ${error instanceof Error ? error.message : error}`
	);
}

// The skill must be a skill: a SKILL.md whose name is the folder name. Anything else in the folder goes in too.
const skillFiles = filesIn(SKILL_DIR);
const skillMain = skillFiles.find((file) => relative(SKILL_DIR, file) === 'SKILL.md');
if (!skillMain) fail(`${SKILL_DIR}/SKILL.md is missing.`);
const front = /^---\nname: ([^\n]+)\ndescription: ([^\n]+)\n---\n/.exec(
	readFileSync(skillMain, 'utf8')
);
if (front?.[1] !== SKILL_NAME) fail(`${SKILL_DIR}/SKILL.md must start with "name: ${SKILL_NAME}".`);

const entries: ZipEntry[] = skillFiles.map((file) => ({
	name: `${SKILL_NAME}/${relative(SKILL_DIR, file).split(sep).join('/')}`,
	data: readFileSync(file)
}));

mkdirSync(out, { recursive: true });
const assets: { name: string; data: Buffer }[] = [
	{ name: 'tessera-deck.v1.schema.json', data: Buffer.from(schemaText, 'utf8') },
	{ name: `tessera-deck-skill-${version}.zip`, data: zip(entries) }
];
for (const asset of assets) writeFileSync(join(out, asset.name), asset.data);

const sums = assets
	.map((asset) => `${createHash('sha256').update(asset.data).digest('hex')}  ${asset.name}`)
	.join('\n');
writeFileSync(join(out, 'SHA256SUMS'), `${sums}\n`);

for (const asset of assets) console.log(`${asset.name}  ${asset.data.length} bytes`);
console.log(`SHA256SUMS  ${assets.length} entries`);
console.log(`skill files: ${entries.map((e) => e.name).join(', ')}`);
