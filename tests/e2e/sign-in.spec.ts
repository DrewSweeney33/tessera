import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { scrollsHorizontally } from './helpers.ts';
import { passwordPort, passwordValue } from './password-server.ts';
import { tokenValue } from './token-server.ts';

// Sign-in (ADR-021), against a real server with TESSERA_PASSWORD (and an API token) set. The login page, the redirect
// there and back, a wrong password, both sign outs, a second device being signed out from the first, and what a plain
// script or a stranger can and cannot reach.

const BASE = `http://127.0.0.1:${passwordPort}`;
test.use({ baseURL: BASE });

const PAGE_HEADERS = { 'content-type': 'application/json', 'x-tessera-client': 'web' };

async function signInOnPage(page: Page, password = passwordValue) {
	await page.getByLabel('Password', { exact: true }).fill(password);
	await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}

test.describe('the login page', () => {
	test('a signed-out visit goes to the login and comes back to the page that was asked for', async ({
		page
	}) => {
		await page.goto('/settings?tab=one');
		await expect(page).toHaveURL(`${BASE}/login?next=%2Fsettings%3Ftab%3Done`);
		await expect(page.getByRole('heading', { name: 'Sign in', level: 1 })).toBeVisible();
		// Nothing behind the password can be reached, so there is nothing to navigate to.
		await expect(page.getByRole('navigation', { name: 'Main' })).toHaveCount(0);
		await expect(page.getByLabel('Password', { exact: true })).toBeFocused();

		await signInOnPage(page);
		await expect(page).toHaveURL(`${BASE}/settings?tab=one`);
		await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
		await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
	});

	test('a wrong password says so, keeps the person on the page, and does not clear what they typed', async ({
		page
	}) => {
		await page.goto('/login');
		await signInOnPage(page, 'not the password at all');
		const alert = page.getByRole('alert');
		await expect(alert).toHaveText('That password is not right.');
		await expect(page).toHaveURL(`${BASE}/login`);
		const field = page.getByLabel('Password', { exact: true });
		await expect(field).toHaveValue('not the password at all');
		await expect(field).toBeFocused();
		await expect(field).toHaveAttribute('aria-invalid', 'true');
		await expect(field).toHaveAccessibleDescription('That password is not right.');
	});

	test('shows and hides the password', async ({ page }) => {
		await page.goto('/login');
		const field = page.getByLabel('Password', { exact: true });
		await field.fill('typed here');
		await expect(field).toHaveAttribute('type', 'password');
		const toggle = page.getByRole('button', { name: 'Show password' });
		await toggle.click();
		await expect(field).toHaveAttribute('type', 'text');
		await expect(page.getByRole('button', { name: 'Hide password' })).toHaveAttribute(
			'aria-pressed',
			'true'
		);
		await page.getByRole('button', { name: 'Hide password' }).click();
		await expect(field).toHaveAttribute('type', 'password');
	});

	test('cannot send the person to another site or back to the login through next', async ({
		page
	}) => {
		for (const next of ['//evil.example/x', 'https://evil.example', '/login', '/api/decks']) {
			await page.goto(`/login?next=${encodeURIComponent(next)}`);
			await signInOnPage(page);
			await expect(page).toHaveURL(`${BASE}/`);
			// Let the page finish loading before the next navigation starts (WebKit: "Frame load interrupted").
			await expect(page.getByRole('heading', { name: 'Decks', level: 1 })).toBeVisible();
			await page.context().clearCookies();
		}
	});

	test('sends a person who is already signed in on to the page', async ({ page }) => {
		await page.goto('/login');
		await signInOnPage(page);
		await expect(page).toHaveURL(`${BASE}/`);
		await expect(page.getByRole('heading', { name: 'Decks', level: 1 })).toBeVisible();
		await page.goto('/login?next=%2Fstats');
		await expect(page).toHaveURL(`${BASE}/stats`);
	});

	test('explains a delay after several wrong guesses instead of looking stuck', async ({
		page
	}) => {
		await page.route('**/api/auth/login', async (route) => {
			await new Promise((done) => setTimeout(done, 3000));
			await route.fulfill({
				status: 401,
				contentType: 'application/json',
				body: JSON.stringify({
					error: { code: 'invalid_password', message: 'That password is not right.' }
				})
			});
		});
		await page.goto('/login');
		await signInOnPage(page, 'a slow wrong guess');
		await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeDisabled();
		await expect(page.getByText(/several wrong guesses/)).toBeVisible();
		await expect(page.getByRole('alert')).toHaveText('That password is not right.');
		await expect(page.getByText(/several wrong guesses/)).toHaveCount(0);
	});

	test('fits a 320 px phone with 44 px controls and no sideways scroll', async ({ page }) => {
		await page.setViewportSize({ width: 320, height: 640 });
		await page.goto('/login');
		await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
		expect(await scrollsHorizontally(page)).toBe(false);
		await page.getByLabel('Password', { exact: true }).fill('x');
		for (const control of [
			page.getByLabel('Password', { exact: true }),
			page.getByRole('button', { name: 'Show password' }),
			page.getByRole('button', { name: 'Sign in', exact: true })
		]) {
			const box = await control.boundingBox();
			expect(box?.height ?? 0).toBeGreaterThanOrEqual(43.5);
		}
	});
});

for (const scheme of ['light', 'dark'] as const) {
	test.describe(`accessibility, ${scheme} theme`, () => {
		test.use({ colorScheme: scheme });

		test('the login page, with and without an error', async ({ page }) => {
			await page.goto('/login');
			await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
			const scan = async (label: string) => {
				await page.evaluate(() =>
					Promise.all(
						document.getAnimations().map((animation) => animation.finished.catch(() => undefined))
					)
				);
				const results = await new AxeBuilder({ page })
					.withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'])
					.analyze();
				expect(
					results.violations.map((v) => `${v.id}: ${v.help}`),
					label
				).toEqual([]);
			};
			await scan('empty login');
			await signInOnPage(page, 'wrong for the scan');
			await expect(page.getByRole('alert')).toBeVisible();
			await scan('login with an error');
		});
	});
}

test.describe('signing out', () => {
	test('Sign out ends the login on this device', async ({ page }) => {
		await page.goto('/login?next=%2Fsettings');
		await signInOnPage(page);
		await expect(page.getByRole('heading', { name: 'Security' })).toBeVisible();
		await expect(page.getByText('Sign-in is on.')).toBeVisible();
		await page.getByRole('button', { name: 'Sign out', exact: true }).click();
		await expect(page).toHaveURL(`${BASE}/login`);
		await page.goto('/settings');
		await expect(page).toHaveURL(/\/login\?next=%2Fsettings$/);
	});

	test('Sign out everywhere asks first, then ends every device, including this one', async ({
		page
	}) => {
		await page.goto('/login?next=%2Fsettings');
		await signInOnPage(page);
		await page.getByRole('button', { name: 'Sign out everywhere' }).click();
		const confirm = page.getByRole('group', { name: 'Confirm signing out everywhere' });
		await expect(confirm).toContainText('every device, including this one');
		await confirm.getByRole('button', { name: 'Cancel' }).click();
		await expect(confirm).toHaveCount(0);
		await expect(page).toHaveURL(`${BASE}/settings`);

		await page.getByRole('button', { name: 'Sign out everywhere' }).click();
		await page
			.getByRole('group', { name: 'Confirm signing out everywhere' })
			.getByRole('button', { name: 'Sign out everywhere' })
			.click();
		await expect(page).toHaveURL(`${BASE}/login`);
	});

	test('signing out everywhere on one device sends another device to the login on its next request', async ({
		browser
	}) => {
		const phone = await browser.newContext({ baseURL: BASE });
		const laptop = await browser.newContext({ baseURL: BASE });
		try {
			for (const context of [phone, laptop]) {
				const signedIn = await context.request.post('/api/auth/login', {
					headers: PAGE_HEADERS,
					data: JSON.stringify({ password: passwordValue })
				});
				expect(signedIn.ok()).toBe(true);
			}
			const onPhone = await phone.newPage();
			await onPhone.goto('/');
			await expect(onPhone.getByRole('heading', { name: 'Decks', level: 1 })).toBeVisible();

			const onLaptop = await laptop.newPage();
			await onLaptop.goto('/settings');
			await onLaptop.getByRole('button', { name: 'Sign out everywhere' }).click();
			await onLaptop
				.getByRole('group', { name: 'Confirm signing out everywhere' })
				.getByRole('button', { name: 'Sign out everywhere' })
				.click();
			await expect(onLaptop).toHaveURL(`${BASE}/login`);

			// The phone's page is still open. The next thing it asks the server for is refused, and it goes to the login,
			// to come back to where it was going.
			await onPhone.getByRole('link', { name: 'Stats' }).click();
			await expect(onPhone).toHaveURL(`${BASE}/login?next=%2Fstats`);
			await signInOnPage(onPhone);
			await expect(onPhone).toHaveURL(`${BASE}/stats`);
		} finally {
			await phone.close();
			await laptop.close();
		}
	});
});

test.describe('what a script or a stranger can reach', () => {
	test('a page redirects, the API answers 401 with the reason, and the few open routes answer', async ({
		request
	}) => {
		const page = await request.get('/', { maxRedirects: 0 });
		expect(page.status()).toBe(303);
		expect(page.headers()['location']).toBe('/login?next=%2F');

		const api = await request.get('/api/decks');
		expect(api.status()).toBe(401);
		const body = (await api.json()) as { error: { code: string; details: { reason: string } } };
		expect(body.error.code).toBe('unauthorized');
		expect(body.error.details.reason).toBe('sign_in_required');

		expect((await request.get('/healthz')).ok()).toBe(true);
		expect((await request.get('/api/schema')).ok()).toBe(true);
		expect((await (await request.get('/api/auth/status')).json()) as object).toEqual({
			enabled: true,
			signedIn: false
		});
		expect((await request.get('/login')).status()).toBe(200);
		// The app's own files hold no data and are handed out before any sign-in check.
		expect((await request.get('/manifest.webmanifest')).ok()).toBe(true);
	});

	test('the web page marker alone opens nothing, the API token still opens the API for a script', async ({
		request
	}) => {
		const marker = await request.get('/api/decks', { headers: { 'x-tessera-client': 'web' } });
		expect(marker.status()).toBe(401);
		const script = await request.get('/api/decks', {
			headers: { authorization: `Bearer ${tokenValue}` }
		});
		expect(script.status()).toBe(200);
		const pageWithToken = await request.get('/settings', {
			headers: { authorization: `Bearer ${tokenValue}` },
			maxRedirects: 0
		});
		expect(pageWithToken.status()).toBe(303);
	});

	test('the login cookie is HttpOnly and SameSite=Lax, and a script cannot read it', async ({
		page,
		browserName
	}) => {
		await page.goto('/login');
		await signInOnPage(page);
		await expect(page).toHaveURL(`${BASE}/`);
		const cookies = await page.context().cookies();
		const session = cookies.find((cookie) => cookie.name === 'tessera_session');
		expect(session?.httpOnly).toBe(true);
		// Playwright's WebKit reports a Lax cookie as "None". The header itself is checked by the integration test and
		// the security probe, which read it off the response.
		if (browserName !== 'webkit') expect(session?.sameSite).toBe('Lax');
		expect(await page.evaluate(() => document.cookie)).not.toContain('tessera_session');
	});
});
