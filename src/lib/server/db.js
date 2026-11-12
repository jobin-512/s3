import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config.js';

const DB_FILE = path.join(DATA_DIR, 'db.json');

const EMPTY = { users: [], sets: [], files: [], keys: [], shares: [] };

function load() {
	try {
		return { ...EMPTY, ...JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) };
	} catch {
		return { ...EMPTY };
	}
}

const state = load();

/**
 * Tiny JSON persistence layer. Single-process app, so synchronous atomic
 * writes (tmp file + rename) are enough and keep the project dependency-light.
 * Swap this module for MongoDB/Postgres later without touching the routes.
 */
export const db = {
	data: state,
	save() {
		const tmp = DB_FILE + '.tmp';
		fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
		fs.renameSync(tmp, DB_FILE);
	}
};

process.on('exit', () => {
	try {
		fs.writeFileSync(DB_FILE + '.tmp', JSON.stringify(state, null, 2));
		fs.renameSync(DB_FILE + '.tmp', DB_FILE);
	} catch {
		/* ignore */
	}
});
