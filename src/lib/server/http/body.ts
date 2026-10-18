import { errorResponse } from './errors.ts';

// How much more of an oversized body is read and thrown away before it is cut off. Cutting a body that is still being
// sent ends the connection, and a client that is mid-upload then sees a reset instead of the 413 (B-3). Reading on
// for a while lets a client that sends a little too much finish and receive its answer. A body that goes on past this
// is not a mistake, so it is cut off and may see a reset.
export const DRAIN_BYTES = 1024 * 1024;

async function drain(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
	let discarded = 0;
	try {
		while (discarded <= DRAIN_BYTES) {
			const { done, value } = await reader.read();
			if (done) return;
			discarded += value.byteLength;
		}
	} catch {
		// The stream failed or was aborted: there is nothing more to read.
	}
	await reader.cancel().catch(() => undefined);
}

// Reads a request body as text with a hard byte limit, so the cap holds whether or not the client
// declares a Content-Length and whatever the deployment's BODY_SIZE_LIMIT is. A body sent with chunked
// transfer encoding has no declared length, and adapter-node reports an oversized one by throwing from
// the stream, which used to surface as a 500. Returns the text, or a ready 4xx response.
export async function readBodyText(
	request: Request,
	maxBytes: number,
	tooLargeMessage: string,
	requestId: string
): Promise<string | Response> {
	const tooLarge = () => errorResponse('payload_too_large', tooLargeMessage, undefined, requestId);

	const declared = Number(request.headers.get('content-length') ?? 0);
	if (declared > maxBytes) return tooLarge();
	if (!request.body) return '';

	const reader = request.body.getReader();
	const parts: Uint8Array[] = [];
	let total = 0;
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			total += value.byteLength;
			if (total > maxBytes) {
				await drain(reader);
				return tooLarge();
			}
			parts.push(value);
		}
	} catch (error) {
		// adapter-node aborts the stream itself when the body passes BODY_SIZE_LIMIT.
		const message = error instanceof Error ? error.message : '';
		if (/BODY_SIZE_LIMIT|body size exceeded/i.test(message)) return tooLarge();
		return errorResponse(
			'bad_request',
			'The request body could not be read. The connection may have been interrupted.',
			undefined,
			requestId
		);
	}

	const bytes = new Uint8Array(total);
	let offset = 0;
	for (const part of parts) {
		bytes.set(part, offset);
		offset += part.byteLength;
	}
	return new TextDecoder().decode(bytes);
}

// The limit for the small JSON bodies (a new deck, a review, settings, a confirmation), far below the import limit.
const SMALL_BODY_BYTES = 16 * 1024;

// Reads a small JSON request body. Returns the parsed value, or a ready 4xx response when the body is too large,
// cannot be read, or is not valid JSON. What the value contains is for the caller to check.
export async function readJsonBody(
	request: Request,
	requestId: string
): Promise<{ value: unknown } | Response> {
	const text = await readBodyText(
		request,
		SMALL_BODY_BYTES,
		'The request body is too large.',
		requestId
	);
	if (text instanceof Response) return text;
	try {
		return { value: JSON.parse(text) };
	} catch {
		return errorResponse('bad_request', 'The body must be valid JSON.', undefined, requestId);
	}
}
