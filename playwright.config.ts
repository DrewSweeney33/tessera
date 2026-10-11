import { defineConfig, devices } from '@playwright/test';
import { tokenPort, tokenValue } from './tests/e2e/token-server.ts';

const port = 4177;
const baseURL = `http://127.0.0.1:${port}`;

// Run `npm run build` first. Locally this drives the Chrome that is already installed, so no browser
// download is needed. In CI the workflow installs Chromium and the channel is left unset.
//
// One browser per run, chosen by E2E_BROWSER (chromium, firefox, or webkit; chromium by default). Most tests
// import decks with fixed ids into one shared server, so two browsers in one run would meet each other's data.
// Each run starts its own servers on an empty data folder. `npm run test:e2e:firefox`, `:webkit`, and `:all`
// (scripts/run-e2e.ts) do this.
const browser = process.env['E2E_BROWSER'] ?? 'chromium';
const browsers = {
	chromium: { ...devices['Desktop Chrome'], ...(process.env['CI'] ? {} : { channel: 'chrome' }) },
	firefox: { ...devices['Desktop Firefox'] },
	webkit: { ...devices['Desktop Safari'] }
} as const;
if (!(browser in browsers)) {
	throw new Error(`E2E_BROWSER must be chromium, firefox, or webkit, not "${browser}".`);
}
export default defineConfig({
	testDir: 'tests/e2e',
	testMatch: '**/*.spec.ts',
	fullyParallel: false,
	workers: 1,
	// No retries anywhere. A test that passes only on the second try is a race, and it should fail loudly.
	// (Most tests also import fixed deck ids, so a retry would meet cards the first attempt already studied.)
	retries: 0,
	reporter: [['list']],
	projects: [{ name: browser, use: browsers[browser as keyof typeof browsers] }],
	use: {
		baseURL,
		trace: 'retain-on-failure'
	},
	webServer: [
		{
			command: 'node scripts/e2e-server.ts',
			url: `${baseURL}/healthz`,
			reuseExistingServer: false,
			timeout: 30_000,
			env: {
				NODE_ENV: 'production',
				PORT: String(port),
				HOST: '127.0.0.1',
				DATA_DIR: '.e2e-data',
				BODY_SIZE_LIMIT: '5M',
				TZ: 'America/Chicago',
				LOG_LEVEL: 'warn'
			}
		},
		// A second server with an API token set, listening on every address so a test can reach it by the machine's
		// LAN address over plain HTTP, as a homelab user would (ADR-011).
		{
			command: 'node scripts/e2e-server.ts',
			url: `http://127.0.0.1:${tokenPort}/healthz`,
			reuseExistingServer: false,
			timeout: 30_000,
			env: {
				NODE_ENV: 'production',
				PORT: String(tokenPort),
				HOST: '0.0.0.0',
				DATA_DIR: '.e2e-data-token',
				BODY_SIZE_LIMIT: '5M',
				TZ: 'America/Chicago',
				LOG_LEVEL: 'warn',
				TESSERA_API_TOKEN: tokenValue
			}
		}
	]
});
