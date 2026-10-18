import { defineConfig, devices } from '@playwright/test';
import {
	passwordPort,
	passwordServerMaxBackups,
	passwordValue
} from './tests/e2e/password-server.ts';
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

// A production server for the tests on its own port, with what it does not share with the other in `env`.
function e2eServer(listenPort: number, env: Record<string, string>) {
	return {
		command: 'node scripts/e2e-server.ts',
		url: `http://127.0.0.1:${listenPort}/healthz`,
		reuseExistingServer: false,
		timeout: 30_000,
		env: {
			NODE_ENV: 'production',
			PORT: String(listenPort),
			BODY_SIZE_LIMIT: '5M',
			TZ: 'America/Chicago',
			LOG_LEVEL: 'warn',
			...env
		}
	};
}

export default defineConfig({
	testDir: 'tests/e2e',
	testMatch: '**/*.spec.ts',
	fullyParallel: false,
	workers: 1,
	// No retries anywhere. A test that passes only on the second try is a race, and it should fail loudly.
	// (Most tests also import fixed deck ids, so a retry would meet cards the first attempt already studied.)
	retries: 0,
	// More headroom than the defaults (30 seconds a test, 5 seconds for each wait), for a slower runner. A test that
	// passes still takes the same time. Only one that is going to fail waits longer before it does.
	timeout: 45_000,
	expect: { timeout: 10_000 },
	// In CI the failing test and its message are also written as GitHub annotations. Those can be read from the run
	// page and the API without logging in, which the job log cannot.
	reporter: process.env['CI'] ? [['list'], ['github']] : [['list']],
	projects: [{ name: browser, use: browsers[browser as keyof typeof browsers] }],
	use: {
		baseURL,
		trace: 'retain-on-failure',
		// The page registers Tessera's service worker (ADR-018). With one active, WebKit sends the page's requests past
		// Playwright's page.route(), so a test that stubs an API answer would reach the real server (a stubbed restore
		// really stopped it). Only the installable app spec turns service workers on.
		serviceWorkers: 'block'
	},
	webServer: [
		// The backup limit is out of the way here: these specs make many backups on purpose. The limit itself is tested
		// on the password server below, which has a small one.
		e2eServer(port, { HOST: '127.0.0.1', DATA_DIR: '.e2e-data', TESSERA_MAX_BACKUPS: '1000' }),
		// A second server with an API token set, listening on every address so a test can reach it by the machine's
		// LAN address over plain HTTP, as a homelab user would (ADR-011).
		e2eServer(tokenPort, {
			HOST: '0.0.0.0',
			DATA_DIR: '.e2e-data-token',
			TESSERA_API_TOKEN: tokenValue
		}),
		// A third server with a page password and the same token set, for the sign-in tests (ADR-021).
		e2eServer(passwordPort, {
			HOST: '127.0.0.1',
			DATA_DIR: '.e2e-data-password',
			TESSERA_MAX_BACKUPS: String(passwordServerMaxBackups),
			TESSERA_PASSWORD: passwordValue,
			TESSERA_API_TOKEN: tokenValue
		})
	]
});
