import { redirect } from '@sveltejs/kit';
import { db } from '$lib/server/db.js';
import { getSessionUser } from '$lib/server/auth.js';
import { config } from '$lib/server/config.js';
import { userView } from '$lib/server/store.js';

export function load(event) {
	if (db.data.users.length === 0) throw redirect(303, '/setup');
	const user = getSessionUser(event);
	if (!user) throw redirect(303, '/login');

	return {
		appName: config.APP_NAME,
		user: userView(user),
		limits: {
			maxUploadMB: config.MAX_UPLOAD_MB,
			maxFiles: config.MAX_FILES_PER_UPLOAD
		}
	};
}
