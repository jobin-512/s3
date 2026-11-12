import { redirect } from '@sveltejs/kit';
import { db } from '$lib/server/db.js';
import { getSessionUser } from '$lib/server/auth.js';
import { config } from '$lib/server/config.js';

export function load(event) {
	if (db.data.users.length === 0) throw redirect(303, '/setup');
	if (getSessionUser(event)) throw redirect(303, '/app');
	return { appName: config.APP_NAME };
}
