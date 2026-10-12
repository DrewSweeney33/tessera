import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

// docs/deploy.md shows how to run the published image without the source. The example must stay as hardened
// as compose.yaml, or someone following the guide runs a weaker container than the repository's own.

interface Service {
	image?: string;
	build?: unknown;
	[key: string]: unknown;
}
const guide = readFileSync('docs/deploy.md', 'utf8');
const block = /<!-- published-image-compose -->\s*```yaml\n([\s\S]*?)```/.exec(guide)?.[1];
const example = block
	? (parse(block) as { services: Record<string, Service>; volumes: Record<string, unknown> })
	: undefined;
const repository = parse(readFileSync('compose.yaml', 'utf8')) as {
	services: Record<string, Service>;
};
const own = repository.services['tessera']!;
const published = example?.services['tessera'];

describe('the published-image example in docs/deploy.md', () => {
	it('is in the guide and is valid YAML with a tessera service', () => {
		expect(block, 'a yaml block after <!-- published-image-compose -->').toBeDefined();
		expect(published).toBeDefined();
	});

	it('runs the image from the registry at an exact version, and builds nothing', () => {
		expect(published?.image).toMatch(/^ghcr\.io\/drewsweeney33\/tessera:\d+\.\d+\.\d+$/);
		expect(published?.build).toBeUndefined();
	});

	it.each([
		'init',
		'restart',
		'read_only',
		'tmpfs',
		'cap_drop',
		'security_opt',
		'logging',
		'volumes'
	])('keeps the %s setting of compose.yaml unchanged', (key) => {
		expect(published?.[key], key).toEqual(own[key]);
	});

	it('declares the named data volume it mounts', () => {
		expect(Object.keys(example?.volumes ?? {})).toEqual(['tessera-data']);
	});

	it('does not set an API token, which would be a committed secret', () => {
		expect(JSON.stringify(published?.environment ?? {})).not.toMatch(/TESSERA_API_TOKEN\s*"?\s*:/);
	});

	it('publishes on loopback, as compose.yaml does', () => {
		expect(published?.ports).toEqual(own['ports']);
	});

	it('tells the reader to pin a version and how to update', () => {
		expect(guide).toMatch(/docker compose pull/);
		expect(guide).toMatch(/pin/i);
	});
});
