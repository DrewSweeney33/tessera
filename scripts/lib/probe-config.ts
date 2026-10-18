// Settings the security probe expects of the extra servers it checks. The probe starts them itself when it
// runs against a local build. Against a remote server (the live-image harness) the harness starts them with
// these same values, so the checks mean the same thing in both modes. Throwaway test values, not secrets.

// An API token for the token checks. 24 characters or more, as the server requires.
export const PROBE_TOKEN = 'probe-token-0123456789abcdef0123456789abcdef';

// A page password for the sign-in checks (--password-mode). 12 characters or more, as the server requires.
export const PROBE_PASSWORD = 'probe-password-correct-horse-123';

// The host list for the host-name checks, exactly as TESSERA_ALLOWED_HOSTS is written in compose.yaml.
export const PROBE_ALLOWED_HOSTS =
	'tessera.example.test, *.lab.example.test, box.example.test:8443';
