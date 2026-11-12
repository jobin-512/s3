import { db } from '$lib/server/db.js';
import { setSessionCookie, verifyPassword } from '$lib/server/auth.js';
import { ApiError, api, ok, readJson } from '$lib/server/http.js';
import { rateLimit } from '$lib/server/ratelimit.js';
import { userView } from '$lib/server/store.js';
import { clientIp, now } from '$lib/server/utils.js';

export const POST = api(async (event) => {
	const limited = rateLimit(`login:${clientIp(event)}`, { limit: 20, windowMs: 15 * 60 * 1000 });
	if (!limited.ok) throw new ApiError(429, 'Too many login attempts. Try again in 15 minutes.');

	const { username, password } = await readJson(event.request);
	const user = db.data.users.find((u) => u.username === String(username || '').trim().toLowerCase());

	if (!user || !verifyPassword(password, user.passwordHash)) {
		throw new ApiError(401, 'Invalid username or password.');
	}

	user.lastLoginAt = now();
	db.save();

	const token = setSessionCookie(event, user);
	return ok({ token, user: userView(user) });
});
