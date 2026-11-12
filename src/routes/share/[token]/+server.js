import { countDownload, findShareByToken } from '$lib/server/store.js';
import { serveStoredFile } from '$lib/server/serve.js';

/**
 * Share link URL: /share/<token>
 * The token was returned once when the link was created; only its hash is stored.
 * Works even for private files, until the link expires or is revoked.
 */
export function GET(event) {
	const found = findShareByToken(event.params.token);
	if (!found) return new Response('Share link not found, expired, or revoked.', { status: 404 });

	countDownload(found.file);
	return serveStoredFile(found.file, {
		download: event.url.searchParams.get('download') === '1',
		cache: 'private, no-store',
		range: event.request.headers.get('range')
	});
}
