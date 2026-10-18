// The third end-to-end server, which has a page password set (see playwright.config.ts). The values protect
// nothing: they exist only for this test server.
export const passwordPort = 4179;
export const passwordValue = 'e2e-test-password-correct-horse';
// A small backup limit, so the limit can be reached in a test (TESSERA_MAX_BACKUPS).
export const passwordServerMaxBackups = 3;
