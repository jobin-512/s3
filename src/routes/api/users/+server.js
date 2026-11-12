import { requireSuperAdmin } from '$lib/server/auth.js';
import { api, ok, readJson } from '$lib/server/http.js';
import { createUser, listUsers } from '$lib/server/store.js';

export const GET = api(async (event) => {
	requireSuperAdmin(event);
	return ok({ users: listUsers() });
});

export const POST = api(async (event) => {
	const { user } = requireSuperAdmin(event);
	const body = await readJson(event.request);
	return ok({ user: createUser(user, body) }, 201);
});
