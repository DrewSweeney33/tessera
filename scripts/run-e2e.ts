// Runs the end-to-end tests once for each browser named on the command line, one after the other, each with its
// own servers and an empty data folder (see playwright.config.ts). Stops at the first browser that fails, and
// exits with its status. Extra Playwright arguments after "--" are passed through.
//   node scripts/run-e2e.ts firefox
//   node scripts/run-e2e.ts chromium firefox webkit -- --grep import
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
// Browser names come first. The rest is passed to Playwright, with or without a "--" in front: npm drops its own "--",
// so `npm run test:e2e:webkit -- --shard=1/4` arrives here as `webkit --shard=1/4`.
const firstOption = args.findIndex((arg) => arg.startsWith('-'));
const split = firstOption === -1 ? args.length : firstOption;
const browsers = args.slice(0, split);
const extra = args.slice(split).filter((arg, index) => !(index === 0 && arg === '--'));
const known = ['chromium', 'firefox', 'webkit'];

if (browsers.length === 0 || browsers.some((b) => !known.includes(b))) {
	console.error(`Usage: node scripts/run-e2e.ts <${known.join('|')}>... [-- playwright arguments]`);
	process.exit(2);
}

for (const browser of browsers) {
	console.log(`\n=== end-to-end tests in ${browser} ===`);
	const run = spawnSync(
		process.execPath,
		['node_modules/@playwright/test/cli.js', 'test', ...extra],
		{ stdio: 'inherit', env: { ...process.env, E2E_BROWSER: browser } }
	);
	if (run.status !== 0) process.exit(run.status ?? 1);
}
