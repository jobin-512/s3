import { requireApiUser } from '$lib/server/auth.js';
import { api, ok } from '$lib/server/http.js';
import { revokeShare } from '$lib/server/store.js';

export const DELETE = api(async (event) => {
	const { user } = requireApiUser(event);
	return ok(revokeShare(user, event.params.id));
});
