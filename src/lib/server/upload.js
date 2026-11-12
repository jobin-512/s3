import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import multer from 'multer';
import { config, UPLOAD_DIR } from './config.js';
import { sanitizeExt } from './utils.js';
import { ApiError } from './http.js';

const storage = multer.diskStorage({
	destination(req, file, cb) {
		const dir = path.join(UPLOAD_DIR, req.uploadSetId);
		fs.mkdir(dir, { recursive: true }, (err) => cb(err, dir));
	},
	filename(req, file, cb) {
		const ext = sanitizeExt(file.originalname);
		cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`);
	}
});

const uploader = multer({
	storage,
	limits: {
		fileSize: config.MAX_UPLOAD_MB * 1024 * 1024,
		files: config.MAX_FILES_PER_UPLOAD,
		fields: 20,
		parts: config.MAX_FILES_PER_UPLOAD + 20
	}
});

/**
 * Multer expects an Express-style request. SvelteKit gives us a Web Request,
 * so we bridge the body stream into a Node Readable that multer can pipe.
 * Files are written to uploads/<setId>/ by multer's disk storage.
 */
export async function receiveFiles(request, setId) {
	if (!request.body) throw new ApiError(400, 'Request body is empty.');
	const contentType = request.headers.get('content-type') || '';
	if (!contentType.toLowerCase().includes('multipart/form-data')) {
		throw new ApiError(400, 'Content-Type must be multipart/form-data with a "files" field.');
	}

	const stream = Readable.fromWeb(request.body);
	stream.headers = Object.fromEntries(request.headers.entries());
	stream.uploadSetId = setId;
	stream.params = { id: setId };
	stream.query = {};
	stream.body = {};
	stream.files = [];

	try {
		await new Promise((resolve, reject) => {
			uploader.array('files', config.MAX_FILES_PER_UPLOAD)(stream, null, (err) =>
				err ? reject(err) : resolve()
			);
		});
	} catch (err) {
		if (err && err.code === 'LIMIT_FILE_SIZE') {
			throw new ApiError(413, `File too large. Maximum is ${config.MAX_UPLOAD_MB} MB per file.`);
		}
		if (err && err.code === 'LIMIT_FILE_COUNT') {
			throw new ApiError(400, `Too many files. Maximum is ${config.MAX_FILES_PER_UPLOAD} per upload.`);
		}
		if (err && err.code) {
			throw new ApiError(400, `Upload error: ${err.message}`);
		}
		throw err;
	}

	return {
		fields: stream.body || {},
		files: Array.isArray(stream.files) ? stream.files : []
	};
}

/** Removes multer-written files (used when validation fails after upload). */
export function removeTempFiles(files) {
	for (const f of files || []) {
		try {
			fs.rmSync(f.path, { force: true });
		} catch {
			/* ignore */
		}
	}
}
