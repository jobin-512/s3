import fs from 'node:fs';
import path from 'node:path';

/**
 * Production entry point.
 * - Loads .env without extra dependencies (existing env vars win).
 * - Raises adapter-node's BODY_SIZE_LIMIT so multi-file uploads are not rejected
 *   (adapter-node defaults to a very small limit).
 * - Boots the SvelteKit Node build.
 */

const envFile = path.resolve(process.cwd(), '.env');
if (fs.existsSync(envFile)) {
	for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
		const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
		if (!match) continue;
		const [, key, raw] = match;
		if (process.env[key] !== undefined) continue;
		let value = raw;
		if (
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))
		) {
			value = value.slice(1, -1);
		}
		process.env[key] = value;
	}
}

const maxUploadMB = Number(process.env.MAX_UPLOAD_MB) || 100;
const maxFiles = Number(process.env.MAX_FILES_PER_UPLOAD) || 10;
if (!process.env.BODY_SIZE_LIMIT) {
	process.env.BODY_SIZE_LIMIT = String((maxUploadMB * maxFiles + 50) * 1024 * 1024);
}
if (!process.env.PORT) process.env.PORT = '3000';

try {
	await import('../build/index.js');
} catch (error) {
	console.error('Could not start the production server. Run "npm run build" first.');
	console.error(error);
	process.exit(1);
}
