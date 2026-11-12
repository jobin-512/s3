import { config } from '$lib/server/config.js';

const CORS_HEADERS = {
	'access-control-allow-origin': config.CORS_ORIGIN,
	'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS',
	'access-control-allow-headers': 'Content-Type, Authorization, x-api-key',
	'access-control-max-age': '86400'
};

/** Global hooks: CORS for the JSON/file API + basic security headers. */
export async function handle({ event, resolve }) {
	const isApi = event.url.pathname.startsWith('/api/');

	if (isApi && event.request.method === 'OPTIONS') {
		return new Response(null, { status: 204, headers: CORS_HEADERS });
	}

	const response = await resolve(event);
	const headers = new Headers(response.headers);

	if (isApi) {
		for (const [key, value] of Object.entries(CORS_HEADERS)) headers.set(key, value);
	}

	if (!headers.has('x-content-type-options')) headers.set('x-content-type-options', 'nosniff');
	if (!headers.has('referrer-policy')) headers.set('referrer-policy', 'same-origin');

	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers
	});
}
