import { db } from '$lib/server/db.js';
import { hashPassword, setSessionCookie } from '$lib/server/auth.js';
import { ApiError, api, ok, readJson } from '$lib/server/http.js';
import { rateLimit } from '$lib/server/ratelimit.js';
import { userView } from '$lib/server/store.js';
import { clientIp, id, now } from '$lib/server/utils.js';

// Note: `api()` wraps this handler and converts thrown ApiErrors to JSON.

export const POST = api(async (event) => {
	if (db.data.users.length > 0) {
		throw new ApiError(
			403,
			'Setup is already complete. New users can only be created by the super admin.'
		);
	}

	const limited = rateLimit(`setup:${clientIp(event)}`, { limit: 10, windowMs: 15 * 60 * 1000 });
	if (!limited.ok) throw new ApiError(429, 'Too many setup attempts. Try again later.');

	const body = await readJson(event.request);
	const { name, username, password } = body;

	if (!name || String(name).trim().length < 1 || String(name).trim().length > 80) {
		throw new ApiError(400, 'Name is required (1-80 characters).');
	}
	if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(String(username || ''))) {
		throw new ApiError(400, 'Username must be 3-32 chars: letters, digits, _ . -');
	}
	if (!password || String(password).length < 8) {
		throw new ApiError(400, 'Password must be at least 8 characters.');
	}

	const user = {
		id: id(),
		name: String(name).trim(),
		username: String(username).trim().toLowerCase(),
		role: 'superadmin',
		passwordHash: hashPassword(password),
		quotaBytes: null, // super admin has unlimited storage
		createdAt: now(),
		createdBy: null,
		lastLoginAt: now()
	};
	db.data.users.push(user);
	db.save();

	const token = setSessionCookie(event, user);
	return ok({ token, user: userView(user) }, 201);
});
