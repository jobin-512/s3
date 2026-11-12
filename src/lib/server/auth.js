import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { db } from './db.js';
import { config } from './config.js';
import { sha256, token } from './utils.js';
import { ApiError } from './http.js';

export const SESSION_COOKIE = 'fv_session';

export const hashPassword = (pw) => bcrypt.hashSync(String(pw), 10);
export const verifyPassword = (pw, hash) => {
	try {
		return bcrypt.compareSync(String(pw || ''), hash);
	} catch {
		return false;
	}
};

export const signToken = (user) =>
	jwt.sign({ sub: user.id, username: user.username, role: user.role }, config.JWT_SECRET, {
		expiresIn: config.JWT_TTL
	});

export const verifyToken = (t) => jwt.verify(t, config.JWT_SECRET);

export const newApiKey = () => 'fv_' + token(24);
export const hashKey = (k) => sha256(k);

function userFromToken(raw) {
	if (!raw) return null;
	try {
		const payload = verifyToken(raw);
		return db.data.users.find((u) => u.id === payload.sub) || null;
	} catch {
		return null;
	}
}

/**
 * Authenticates an API request via (in order):
 *   - Authorization: Bearer <jwt>
 *   - session cookie (dashboard)
 *   - x-api-key header or ?api_key= query parameter
 * Returns { type, user, key? } or null.
 */
export function getAuth(event) {
	const request = event.request;
	const header = request.headers.get('authorization') || '';
	const bearer = header.startsWith('Bearer ') ? header.slice(7).trim() : null;
	const apiKey = request.headers.get('x-api-key') || event.url.searchParams.get('api_key');

	if (bearer) {
		const user = userFromToken(bearer);
		if (user) return { type: 'bearer', user };
		// An invalid bearer token should not silently fall back to a cookie/key.
		return null;
	}

	const cookieToken = event.cookies.get(SESSION_COOKIE);
	const cookieUser = userFromToken(cookieToken);
	if (cookieUser) return { type: 'cookie', user: cookieUser };

	if (apiKey) {
		const keyRec = db.data.keys.find((k) => !k.revokedAt && k.keyHash === hashKey(apiKey));
		if (!keyRec) return null;
		const user = db.data.users.find((u) => u.id === keyRec.userId);
		if (!user) return null;
		keyRec.lastUsedAt = new Date().toISOString();
		db.save();
		return { type: 'apikey', user, key: keyRec };
	}

	return null;
}

/** Cookie-only auth, used by page load functions. */
export function getSessionUser(event) {
	return userFromToken(event.cookies.get(SESSION_COOKIE));
}

export function requireApiUser(event) {
	const auth = getAuth(event);
	if (!auth) {
		throw new ApiError(
			401,
			'Authentication required. Use a Bearer token, the dashboard session, or an API key (x-api-key header / ?api_key=).'
		);
	}
	return auth;
}

export function requireSuperAdmin(event) {
	const auth = requireApiUser(event);
	if (auth.user.role !== 'superadmin') throw new ApiError(403, 'Super admin access required.');
	return auth;
}

export function setSessionCookie(event, user) {
	const tokenValue = signToken(user);
	event.cookies.set(SESSION_COOKIE, tokenValue, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: event.url.protocol === 'https:',
		maxAge: 60 * 60 * 24 * 7
	});
	return tokenValue;
}

export function clearSessionCookie(event) {
	event.cookies.delete(SESSION_COOKIE, { path: '/' });
}
