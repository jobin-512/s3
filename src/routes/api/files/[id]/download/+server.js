import { getAuth } from '$lib/server/auth.js';
import { db } from '$lib/server/db.js';
import { ApiError, api, ok } from '$lib/server/http.js';
import { countDownload } from '$lib/server/store.js';
import { serveStoredFile } from '$lib/server/serve.js';

export const GET = api(async (event) => {
	const file = db.data.files.find((f) => f.id === event.params.id);
	if (!file) throw new ApiError(404, 'File not found.');

	const set = db.data.sets.find((s) => s.id === file.setId);
	const auth = getAuth(event);
	const owns = auth && set && (auth.user.role === 'superadmin' || set.ownerId === auth.user.id);

	if (!owns && !file.isPublic) {
		throw auth
			? new ApiError(404, 'File not found.')
			: new ApiError(
					401,
					'This file is private. Provide an API key (x-api-key header or ?api_key=) or sign in.'
				);
	}

	countDownload(file);
	return serveStoredFile(file, {
		download: event.url.searchParams.get('download') === '1',
		cache: file.isPublic ? 'public, max-age=300' : 'private, no-store',
		range: event.request.headers.get('range')
	});
});
