import type { SettingsResponse } from '#lib/core/api-types.ts';
import { DEFAULT_SETTINGS, isSettingKey, settingProblems } from '#lib/core/settings.ts';
import type { AppContext } from '../app.ts';
import { withTx } from '../db/tx.ts';
import { readBodyText } from '../http/body.ts';
import { errorResponse } from '../http/errors.ts';
import { jsonResponse } from '../http/response.ts';
import { getSettings, setSetting } from '../repos/index.ts';

// The settings over HTTP (M3-09). A change is all or nothing: every value is checked first, and they are saved in one
// transaction, so a form that has one bad field saves none of the others.

const MAX_BODY_BYTES = 16 * 1024;

function answer(app: AppContext): SettingsResponse {
	return {
		settings: getSettings(app.db),
		defaults: { ...DEFAULT_SETTINGS },
		timeZone: app.config.timeZone
	};
}

// GET /api/settings
export function handleGetSettings(app: AppContext): Response {
	return jsonResponse(answer(app), { headers: { 'cache-control': 'no-store' } });
}

// PUT /api/settings with any of the settings, for example {"newPerDay": 10}.
export async function handleUpdateSettings(
	app: AppContext,
	request: Request,
	requestId: string
): Promise<Response> {
	const text = await readBodyText(
		request,
		MAX_BODY_BYTES,
		'The request body is too large.',
		requestId
	);
	if (text instanceof Response) return text;

	let body: unknown;
	try {
		body = JSON.parse(text);
	} catch {
		return errorResponse('bad_request', 'The body must be valid JSON.', undefined, requestId);
	}

	const problems = settingProblems(body);
	if (problems.length === 0 && Object.keys(body as object).length === 0) {
		problems.push({
			path: '',
			code: 'not_an_object',
			message: 'Send at least one setting to change.'
		});
	}
	if (problems.length > 0) {
		return errorResponse(
			'validation_failed',
			'The settings are not valid. Nothing was saved.',
			{ errors: problems },
			requestId
		);
	}

	const changes = body as Record<string, unknown>;
	withTx(app.db, (tx) => {
		for (const [key, value] of Object.entries(changes)) {
			if (isSettingKey(key)) setSetting(tx, key, value);
		}
	});
	app.log.info('settings changed', { requestId, changes });
	return jsonResponse(answer(app), { headers: { 'cache-control': 'no-store' } });
}
