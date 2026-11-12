import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { env } from '$env/dynamic/private';

export const ROOT = process.cwd();

function envInt(name, def) {
	const n = Number(env[name]);
	return Number.isFinite(n) && n > 0 ? Math.floor(n) : def;
}

export const DATA_DIR = path.resolve(ROOT, env.DATA_DIR || 'data');
export const UPLOAD_DIR = path.resolve(ROOT, env.UPLOAD_DIR || 'uploads');
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// JWT secret: from env, or generated once and persisted so sessions survive restarts.
let jwtSecret = env.JWT_SECRET;
if (!jwtSecret) {
	const secretFile = path.join(DATA_DIR, '.jwt-secret');
	if (fs.existsSync(secretFile)) {
		jwtSecret = fs.readFileSync(secretFile, 'utf8').trim();
	} else {
		jwtSecret = crypto.randomBytes(48).toString('hex');
		fs.writeFileSync(secretFile, jwtSecret, { mode: 0o600 });
		console.warn('[config] JWT_SECRET not set — generated a persistent secret at data/.jwt-secret');
	}
}

export const config = {
	PORT: envInt('PORT', 3000),
	APP_NAME: env.APP_NAME || 'FileVault',
	JWT_SECRET: jwtSecret,
	JWT_TTL: env.JWT_TTL || '7d',
	MAX_UPLOAD_MB: envInt('MAX_UPLOAD_MB', 100),
	MAX_FILES_PER_UPLOAD: envInt('MAX_FILES_PER_UPLOAD', 10),
	DEFAULT_QUOTA_MB: envInt('DEFAULT_QUOTA_MB', 1024),
	CORS_ORIGIN: env.CORS_ORIGIN || '*',
	DATA_DIR,
	UPLOAD_DIR
};
