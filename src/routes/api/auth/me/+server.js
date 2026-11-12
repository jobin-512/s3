import { requireApiUser } from '$lib/server/auth.js';
import { api, ok } from '$lib/server/http.js';
import { userView } from '$lib/server/store.js';

export const GET = api(async (event) => {
	const { user } = requireApiUser(event);
	return ok({ user: userView(user) });
});
