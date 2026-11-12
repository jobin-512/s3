import { requireApiUser } from '$lib/server/auth.js';
import { api, ok, readJson } from '$lib/server/http.js';
import { createSet, listSets } from '$lib/server/store.js';

export const GET = api(async (event) => {
	const { user } = requireApiUser(event);
	const all = event.url.searchParams.get('all') === '1';
	const owner = event.url.searchParams.get('owner');
	return ok({ sets: listSets(user, { all, owner }) });
});

export const POST = api(async (event) => {
	const { user } = requireApiUser(event);
	const body = await readJson(event.request);
	return ok({ set: createSet(user, body) }, 201);
});
