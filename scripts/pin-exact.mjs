// Rewrites every dependency range in package.json to the exact version recorded in
// package-lock.json. Run after adding a dependency with a range: node scripts/pin-exact.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
let changed = 0;

for (const section of ['dependencies', 'devDependencies']) {
	for (const name of Object.keys(pkg[section] ?? {})) {
		const installed = lock.packages?.[`node_modules/${name}`]?.version;
		if (installed && pkg[section][name] !== installed) {
			pkg[section][name] = installed;
			changed++;
		}
	}
}

writeFileSync('package.json', JSON.stringify(pkg, null, '\t') + '\n');
console.log(`pinned ${changed} dependency range(s) to exact versions`);
