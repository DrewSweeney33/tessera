// Starts the production server for end-to-end tests with an empty data folder. Playwright's webServer
// runs this. The build must already exist (npm run build).
import { rmSync } from 'node:fs';

const dataDir = process.env['DATA_DIR'];
if (!dataDir) throw new Error('DATA_DIR must be set for the end-to-end server.');
rmSync(dataDir, { recursive: true, force: true });

// The path is a variable so the type checker does not follow it into the compiled output.
const entry = '../build/index.js';
await import(entry);
