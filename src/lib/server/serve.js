import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { UPLOAD_DIR } from './config.js';
import { PREVIEWABLE } from './utils.js';

function encodedFilename(name) {
	return encodeURIComponent(String(name || 'file')).replace(
		/['()*]/g,
		(c) => '%' + c.charCodeAt(0).toString(16).toUpperCase()
	);
}

function asciiFilename(name) {
	return String(name || 'file')
		.replace(/[^\x20-\x7e]/g, '_')
		.replace(/["\\]/g, '_');
}

function parseRange(header, size) {
	if (!header) return null;
	const m = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim());
	if (!m || (m[1] === '' && m[2] === '')) return null;
	let start = m[1] === '' ? null : Number(m[1]);
	let end = m[2] === '' ? null : Number(m[2]);
	if (start === null) {
		// suffix range: last N bytes
		start = Math.max(0, size - end);
		end = size - 1;
	} else if (end === null || end >= size) {
		end = size - 1;
	}
	if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) {
		return { invalid: true };
	}
	return { start, end };
}

/**
 * Streams a stored file back to the client with correct headers.
 * Supports HTTP Range requests (needed for video/audio seeking).
 */
export function serveStoredFile(file, { download = false, cache = 'no-store', range = null } = {}) {
	const absolute = path.join(UPLOAD_DIR, file.setId, file.storedName);
	let stat;
	try {
		stat = fs.statSync(absolute);
	} catch {
		return new Response('File data is missing on disk.', { status: 404 });
	}

	const previewable = PREVIEWABLE.test(file.mimeType || '');
	const disposition = download || !previewable ? 'attachment' : 'inline';
	const headers = new Headers({
		'content-type': file.mimeType || 'application/octet-stream',
		'content-disposition': `${disposition}; filename="${asciiFilename(file.name)}"; filename*=UTF-8''${encodedFilename(file.name)}`,
		'x-content-type-options': 'nosniff',
		'cache-control': cache,
		'accept-ranges': 'bytes'
	});

	const parsed = parseRange(range, stat.size);
	if (parsed && parsed.invalid) {
		headers.set('content-range', `bytes */${stat.size}`);
		return new Response('Range not satisfiable.', { status: 416, headers });
	}

	const start = parsed ? parsed.start : 0;
	const end = parsed ? parsed.end : stat.size - 1;
	headers.set('content-length', String(Math.max(0, end - start + 1)));
	if (parsed) headers.set('content-range', `bytes ${start}-${end}/${stat.size}`);

	const nodeStream = fs.createReadStream(absolute, { start, end });
	return new Response(Readable.toWeb(nodeStream), {
		status: parsed ? 206 : 200,
		headers
	});
}
