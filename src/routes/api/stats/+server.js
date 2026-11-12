import { requireApiUser } from '$lib/server/auth.js';
import { api, ok } from '$lib/server/http.js';
import { statsFor } from '$lib/server/store.js';

export const GET = api(async (event) => {
	const { user } = requireApiUser(event);
	return ok(statsFor(user));
});
