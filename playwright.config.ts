import { defineConfig } from '@playwright/test';

export default defineConfig({
	testDir: 'tests/e2e',
	testMatch: '**/*.spec.ts',
	webServer: { command: 'npm run build && npm run preview', port: 4173 }
});
