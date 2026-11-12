import { db } from '$lib/server/db.js';
import { config } from '$lib/server/config.js';
import { ok } from '$lib/server/http.js';

export function GET() {
	return ok({
		appName: config.APP_NAME,
		setupRequired: db.data.users.length === 0
	});
}
