import { defineConfig } from '@playwright/test';

const port = 4177;
const baseURL = `http://127.0.0.1:${port}`;

// Run `npm run build` first. Locally this drives the Chrome that is already installed, so no browser
// download is needed. In CI the workflow installs Chromium and the channel is left unset.
export default defineConfig({
	testDir: 'tests/e2e',
	testMatch: '**/*.spec.ts',
	fullyParallel: false,
	workers: 1,
	// No retries anywhere. A test that passes only on the second try is a race, and it should fail loudly.
	// (Most tests also import fixed deck ids, so a retry would meet cards the first attempt already studied.)
	retries: 0,
	reporter: [['list']],
	use: {
		baseURL,
		...(process.env['CI'] ? {} : { channel: 'chrome' }),
		trace: 'retain-on-failure'
	},
	webServer: {
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
	}
});
