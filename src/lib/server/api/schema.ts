import { deckJsonSchema } from '#lib/core/schema/index.ts';
import { jsonResponse } from '../http/response.ts';

// GET /api/schema. Public by design (it contains no study data) so Claude can fetch it.
export function handleSchema(): Response {
	return jsonResponse(deckJsonSchema(), {
		headers: {
			'content-type': 'application/schema+json; charset=utf-8',
			'cache-control': 'public, max-age=300'
		}
	});
}
