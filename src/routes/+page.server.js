import { redirect } from '@sveltejs/kit';
import { db } from '$lib/server/db.js';
import { getSessionUser } from '$lib/server/auth.js';

export function load(event) {
	if (db.data.users.length === 0) throw redirect(303, '/setup');
	if (!getSessionUser(event)) throw redirect(303, '/login');
	throw redirect(303, '/app');
}
