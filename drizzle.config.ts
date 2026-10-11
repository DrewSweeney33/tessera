import { defineConfig } from 'drizzle-kit';

// Generates SQL migrations into ./drizzle. They are committed and applied at boot.
export default defineConfig({
	dialect: 'sqlite',
	schema: './src/lib/server/db/schema.ts',
	out: './drizzle',
	strict: true,
	verbose: true
});
