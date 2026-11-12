import crypto from 'node:crypto';
import path from 'node:path';

export const now = () => new Date().toISOString();
export const id = () => crypto.randomUUID();
export const token = (bytes = 24) => crypto.randomBytes(bytes).toString('hex');
export const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

export function slugify(s) {
	return (
		String(s || '')
			.toLowerCase()
			.normalize('NFKD')
			.replace(/[\u0300-\u036f]/g, '')
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '')
			.slice(0, 60) || 'item'
	);
}

export function sanitizeExt(name) {
	const ext = path.extname(String(name || '')).toLowerCase();
	return /^\.[a-z0-9]{1,10}$/.test(ext) ? ext : '';
}

export function formatBytes(n) {
	if (n == null || Number.isNaN(n)) return '—';
	if (n < 1024) return `${n} B`;
	const units = ['KB', 'MB', 'GB', 'TB'];
	let v = n;
	let u = -1;
	do {
		v /= 1024;
		u++;
	} while (v >= 1024 && u < units.length - 1);
	return `${v.toFixed(v >= 100 || u === 0 ? 0 : 1)} ${units[u]}`;
}

export function isPublicFlag(v) {
	return v === true || v === 1 || v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

export function publicUser(u) {
	if (!u) return null;
	const { passwordHash, ...rest } = u;
	return rest;
}

export function clampInt(v, min, max, def) {
	const n = Number(v);
	if (!Number.isFinite(n)) return def;
	return Math.min(max, Math.max(min, Math.floor(n)));
}

// Only safe, non-scriptable types are served inline. HTML/SVG/JS are forced
// to download so uploaded content can never execute on the app's origin.
export const PREVIEWABLE = /^(image\/(?!svg)|video\/|audio\/|application\/pdf|text\/(plain|csv|markdown|x-markdown))/i;

export function clientIp(event) {
	try {
		return event.getClientAddress();
	} catch {
		return 'unknown';
	}
}
