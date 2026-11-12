import { clearSessionCookie } from '$lib/server/auth.js';
import { ok } from '$lib/server/http.js';

export function POST(event) {
	clearSessionCookie(event);
	return ok({ ok: true });
}
