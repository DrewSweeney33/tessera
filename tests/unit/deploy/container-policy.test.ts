import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

// Docker is not available on every developer machine, so these tests guard the ADR-004 and
// ADR-005 container decisions as policy. CI builds and runs the real image.
const dockerfile = readFileSync('Dockerfile', 'utf8');
const dockerignore = readFileSync('.dockerignore', 'utf8');
const compose = parse(readFileSync('compose.yaml', 'utf8')) as {
	services: Record<string, Record<string, unknown>>;
	volumes: Record<string, unknown>;
};
const service = compose.services['tessera']!;

describe('Dockerfile (ADR-004)', () => {
	it('uses the Debian 13 slim Node 24 image for both stages', () => {
		const stages = [...dockerfile.matchAll(/^FROM (\S+)/gm)].map((m) => m[1]);
		expect(stages).toEqual(['node:24-trixie-slim', 'node:24-trixie-slim']);
	});

	it('builds with a clean install and prunes development dependencies', () => {
		expect(dockerfile).toMatch(/RUN npm ci\b/);
		expect(dockerfile).toMatch(/npm run build && npm prune --omit=dev/);
	});

	it('copies exactly what the server needs at runtime, including migrations', () => {
		for (const path of ['/app/build', '/app/node_modules', '/app/package.json', '/app/drizzle']) {
			expect(dockerfile).toContain(`COPY --from=build --chown=node:node ${path}`);
		}
	});

	it('runs as the non-root node user with a writable data volume', () => {
		expect(dockerfile).toMatch(/^USER node$/m);
		expect(dockerfile).toContain('chown node:node /data');
		expect(dockerfile).toMatch(/^VOLUME \/data$/m);
	});

	it('sets the production environment, including the 5 MB body limit', () => {
		for (const setting of [
			'NODE_ENV=production',
			'HOST=0.0.0.0',
			'PORT=3000',
			'DATA_DIR=/data',
			'BODY_SIZE_LIMIT=5M'
		]) {
			expect(dockerfile).toContain(setting);
		}
	});

	it('has a health check that needs no curl', () => {
		const instructions = dockerfile
			.split('\n')
			.filter((line) => !line.trim().startsWith('#'))
			.join('\n');
		expect(instructions).toMatch(/^HEALTHCHECK /m);
		expect(instructions).toContain('/healthz');
		expect(instructions).not.toMatch(/curl|wget/);
	});

	it('does not bake secrets into the image', () => {
		expect(dockerfile).not.toMatch(/TESSERA_API_TOKEN\s*=/);
	});
});

describe('.dockerignore', () => {
	it('keeps local state, secrets, and team files out of the build context', () => {
		const lines = dockerignore.split('\n').map((l) => l.trim());
		for (const entry of ['.git', '.10x', 'node_modules', 'build', 'data', '.env', '*.db']) {
			expect(lines).toContain(entry);
		}
	});
});

describe('compose.yaml (ADR-004, ADR-005)', () => {
	it('publishes only on loopback by default', () => {
		expect(service['ports']).toEqual(['127.0.0.1:3000:3000']);
	});

	it('runs with an init process and restarts unless stopped', () => {
		expect(service['init']).toBe(true);
		expect(service['restart']).toBe('unless-stopped');
	});

	it('hardens the container: read-only root, no capabilities, no new privileges', () => {
		expect(service['read_only']).toBe(true);
		expect(service['cap_drop']).toEqual(['ALL']);
		expect(service['security_opt']).toContain('no-new-privileges:true');
		expect(service['tmpfs']).toContain('/tmp');
	});

	it('keeps data in a named volume mounted at /data', () => {
		expect(service['volumes']).toEqual(['tessera-data:/data']);
		expect(Object.keys(compose.volumes)).toEqual(['tessera-data']);
	});

	it('does not set an API token, which would be a committed secret', () => {
		const env = service['environment'] as Record<string, string>;
		expect(Object.keys(env)).not.toContain('TESSERA_API_TOKEN');
	});
});
