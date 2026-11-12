import { requireApiUser } from '$lib/server/auth.js';
import { api, ok, readJson } from '$lib/server/http.js';
import { deleteSet, requireSet, setView, updateSet } from '$lib/server/store.js';

export const GET = api(async (event) => {
	const { user } = requireApiUser(event);
	return ok({ set: setView(requireSet(user, event.params.id)) });
});

export const PATCH = api(async (event) => {
	const { user } = requireApiUser(event);
	const body = await readJson(event.request);
	return ok({ set: updateSet(user, event.params.id, body) });
});

export const DELETE = api(async (event) => {
	const { user } = requireApiUser(event);
	return ok(deleteSet(user, event.params.id));
});
