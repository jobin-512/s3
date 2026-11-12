import { requireApiUser } from '$lib/server/auth.js';
import { api, ok, readJson } from '$lib/server/http.js';
import { createKey, listKeys } from '$lib/server/store.js';

export const GET = api(async (event) => {
	const { user } = requireApiUser(event);
	const all = event.url.searchParams.get('all') === '1';
	return ok({ keys: listKeys(user, { all }) });
});

export const POST = api(async (event) => {
	const { user } = requireApiUser(event);
	const body = await readJson(event.request);
	return ok({ key: createKey(user, body) }, 201);
});
