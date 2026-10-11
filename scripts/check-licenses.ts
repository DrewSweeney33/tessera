// Fails if any production dependency has a license outside the allowed list.
//   node scripts/check-licenses.ts            check
//   node scripts/check-licenses.ts --list     also print every production package and its license
import { readFileSync } from 'node:fs';
import { ALLOWED_LICENSES, productionLicenses } from './lib/licenses.ts';

const lock = JSON.parse(readFileSync('package-lock.json', 'utf8')) as Parameters<
	typeof productionLicenses
>[0];
const findings = productionLicenses(lock);
const rejected = findings.filter((f) => !f.allowed);

if (process.argv.includes('--list')) {
	for (const f of findings)
		console.log(`${f.allowed ? 'ok  ' : 'BAD '} ${f.name}@${f.version}  ${f.license}`);
}

if (rejected.length > 0) {
	console.error(
		`\n${rejected.length} production dependenc${rejected.length === 1 ? 'y has' : 'ies have'} a license that is not allowed:`
	);
	for (const f of rejected) console.error(`  ${f.name}@${f.version}  ${f.license}`);
	console.error(`\nAllowed: ${[...ALLOWED_LICENSES].join(', ')}`);
	process.exit(1);
}

console.log(`License check passed: ${findings.length} production packages, all allowed.`);
