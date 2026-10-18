// Adds a Set-Cookie header (several can be sent, so it is appended, not set).
export function withSetCookie(response: Response, cookie: string): Response {
	try {
		response.headers.append('set-cookie', cookie);
		return response;
	} catch {
		const copy = new Response(response.body, {
			status: response.status,
			statusText: response.statusText,
			headers: new Headers(response.headers)
		});
		copy.headers.append('set-cookie', cookie);
		return copy;
	}
}

// Sets headers on a response. Responses built from fetch() have immutable headers, so on failure
// the response is rebuilt with a mutable copy.
export function withHeaders(response: Response, headers: Record<string, string>): Response {
	try {
		for (const [name, value] of Object.entries(headers)) response.headers.set(name, value);
		return response;
	} catch {
		const copy = new Response(response.body, {
			status: response.status,
			statusText: response.statusText,
			headers: new Headers(response.headers)
		});
		for (const [name, value] of Object.entries(headers)) copy.headers.set(name, value);
		return copy;
	}
}
