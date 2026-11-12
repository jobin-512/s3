import { requireApiUser } from '$lib/server/auth.js';
import { ApiError, api, ok } from '$lib/server/http.js';
import { listFiles, recordUploads, requireSet } from '$lib/server/store.js';
import { receiveFiles, removeTempFiles } from '$lib/server/upload.js';
import { isPublicFlag } from '$lib/server/utils.js';

// List files in a set (owner or super admin).
export const GET = api(async (event) => {
	const { user } = requireApiUser(event);
	const { q, page, limit } = Object.fromEntries(event.url.searchParams);
	return ok(listFiles(user, event.params.id, { q, page, limit }));
});

// Upload one or more files into a set using multer (multipart/form-data, field "files").
export const POST = api(async (event) => {
	const { user } = requireApiUser(event);
	// Authorize before reading the body/uploads, and use the canonical set id.
	const set = requireSet(user, event.params.id);

	const { files, fields } = await receiveFiles(event.request, set.id);
	if (!files.length) {
		throw new ApiError(400, 'No files received. Send multipart/form-data with one or more "files" fields.');
	}

	const isPublic = fields.isPublic !== undefined ? isPublicFlag(fields.isPublic) : set.isPublic;

	try {
		const created = recordUploads(user, set, files, isPublic);
		return ok({ files: created }, 201);
	} catch (err) {
		// Validation (e.g. quota) failed after multer wrote the files: clean up.
		removeTempFiles(files);
		throw err;
	}
});
