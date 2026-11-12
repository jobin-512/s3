import { countDownload, getPublicFile } from '$lib/server/store.js';
import { serveStoredFile } from '$lib/server/serve.js';

/**
 * Public file URL: /s/<set-slug>/<file-slug>
 * Only files explicitly marked public are served here — no API key required.
 */
export function GET(event) {
	const found = getPublicFile(event.params.setSlug, event.params.fileSlug);
	if (!found) return new Response('Not found', { status: 404 });

	countDownload(found.file);
	return serveStoredFile(found.file, {
		download: event.url.searchParams.get('download') === '1',
		cache: 'public, max-age=300',
		range: event.request.headers.get('range')
	});
}
