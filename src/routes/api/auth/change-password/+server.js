import { hashPassword, requireApiUser, verifyPassword } from '$lib/server/auth.js';
import { db } from '$lib/server/db.js';
import { ApiError, api, ok, readJson } from '$lib/server/http.js';

export const POST = api(async (event) => {
	const { user } = requireApiUser(event);
	const { currentPassword, newPassword } = await readJson(event.request);

	if (!verifyPassword(currentPassword, user.passwordHash)) {
		throw new ApiError(400, 'Current password is incorrect.');
	}
	if (!newPassword || String(newPassword).length < 8) {
		throw new ApiError(400, 'New password must be at least 8 characters.');
	}

	const record = db.data.users.find((u) => u.id === user.id);
	record.passwordHash = hashPassword(newPassword);
	db.save();
	return ok({ ok: true });
});
