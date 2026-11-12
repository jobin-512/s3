import { requireSuperAdmin } from '$lib/server/auth.js';
import { api, ok, readJson } from '$lib/server/http.js';
import { deleteUser, listUsers, updateUser } from '$lib/server/store.js';

export const GET = api(async (event) => {
	requireSuperAdmin(event);
	const user = listUsers().find((u) => u.id === event.params.id);
	if (!user) return ok({ error: 'User not found.' }, 404);
	return ok({ user });
});

export const PATCH = api(async (event) => {
	const { user: admin } = requireSuperAdmin(event);
	const body = await readJson(event.request);
	return ok({ user: updateUser(admin, event.params.id, body) });
});

export const DELETE = api(async (event) => {
	const { user: admin } = requireSuperAdmin(event);
	const result = deleteUser(admin, event.params.id);
	return ok({ ok: true, ...result });
});
