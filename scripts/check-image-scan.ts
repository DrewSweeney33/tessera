// Reads the result of an image scan (Trivy's JSON format) and fails if it found anything serious that can be fixed.
//
//   node scripts/check-image-scan.ts trivy-results.json
//
// Why this is a separate step and not the scanner's own exit code: the scanner's failure says only "exit code 1",
// and a CI job log cannot be read without logging in. This prints every finding, writes each one as a GitHub
// annotation (which can be read from the run page and the API), and says what was scanned, so a failure explains
// itself and a pass shows that something was really looked at. A scanner that crashed or could not download its
// database fails in its own step, before this one.
import { check } from './lib/image-scan.ts';

process.exit(check(process.argv[2] ?? 'trivy-results.json'));
