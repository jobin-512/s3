import { getAuth, requireApiUser } from '$lib/server/auth.js';
import { db } from '$lib/server/db.js';
import { ApiError, api, ok, readJson } from '$lib/server/http.js';
import { deleteFile, fileView, updateFile } from '$lib/server/store.js';

export const GET = api(async (event) => {
	const file = db.data.files.find((f) => f.id === event.params.id);
	if (!file) throw new ApiError(404, 'File not found.');
	const set = db.data.sets.find((s) => s.id === file.setId);
	const auth = getAuth(event);
	const owns = auth && set && (auth.user.role === 'superadmin' || set.ownerId === auth.user.id);

	if (!owns && !file.isPublic) {
		throw auth ? new ApiError(404, 'File not found.') : new ApiError(401, 'This file is private. Provide an API key or sign in.');
	}
	return ok({ file: fileView(file) });
});

export const PATCH = api(async (event) => {
	const { user } = requireApiUser(event);
	const body = await readJson(event.request);
	return ok({ file: updateFile(user, event.params.id, body) });
});

export const DELETE = api(async (event) => {
	const { user } = requireApiUser(event);
	return ok(deleteFile(user, event.params.id));
});
