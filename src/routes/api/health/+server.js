import { now } from '$lib/server/utils.js';
import { ok } from '$lib/server/http.js';

export function GET() {
	return ok({ ok: true, time: now() });
}
