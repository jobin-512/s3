import { requireApiUser } from '$lib/server/auth.js';
import { api, ok, readJsonOptional } from '$lib/server/http.js';
import { createShare, listShares } from '$lib/server/store.js';

export const GET = api(async (event) => {
	const { user } = requireApiUser(event);
	return ok({ shares: listShares(user, event.params.id) });
});

export const POST = api(async (event) => {
	const { user } = requireApiUser(event);
	const body = await readJsonOptional(event.request);
	return ok({ share: createShare(user, event.params.id, body) }, 201);
});
