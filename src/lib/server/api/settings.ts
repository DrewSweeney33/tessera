import type { SettingsResponse } from '#lib/core/api-types.ts';
import { DEFAULT_SETTINGS, isSettingKey, settingProblems } from '#lib/core/settings.ts';
import type { AppContext } from '../app.ts';
import { withTx } from '../db/tx.ts';
import { readJsonBody } from '../http/body.ts';
import { errorResponse } from '../http/errors.ts';
import { jsonResponse } from '../http/response.ts';
import { getSettings, setSetting } from '../repos/index.ts';

// The settings over HTTP (M3-09). A change is all or nothing: every value is checked first, and they are saved in one
// transaction, so a form that has one bad field saves none of the others.

function settingsResponse(app: AppContext): Response {
	const body: SettingsResponse = {
		settings: getSettings(app.db),
		defaults: { ...DEFAULT_SETTINGS },
		timeZone: app.config.timeZone
	};
	return jsonResponse(body, { headers: { 'cache-control': 'no-store' } });
}

// GET /api/settings
export function handleGetSettings(app: AppContext): Response {
	return settingsResponse(app);
}

// PUT /api/settings with any of the settings, for example {"newPerDay": 10}.
export async function handleUpdateSettings(
	app: AppContext,
	request: Request,
	requestId: string
): Promise<Response> {
	const body = await readJsonBody(request, requestId);
	if (body instanceof Response) return body;

	const problems = settingProblems(body.value);
	if (problems.length === 0 && Object.keys(body.value as object).length === 0) {
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

	const changes = body.value as Record<string, unknown>;
	withTx(app.db, (tx) => {
		for (const [key, value] of Object.entries(changes)) {
			if (isSettingKey(key)) setSetting(tx, key, value);
		}
	});
	app.log.info('settings changed', { requestId, changes });
	return settingsResponse(app);
}
