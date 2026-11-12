import fs from 'node:fs';
import path from 'node:path';
import mime from 'mime-types';
import { db } from './db.js';
import { config, UPLOAD_DIR } from './config.js';
import { id, now, slugify, token, sha256, formatBytes, clampInt } from './utils.js';
import { newApiKey, hashKey, hashPassword } from './auth.js';
import { ApiError } from './http.js';

const MB = 1024 * 1024;

/* ------------------------------------------------------------------ users */

export function usageOf(userId) {
	let usedBytes = 0;
	let fileCount = 0;
	for (const f of db.data.files) {
		const set = db.data.sets.find((s) => s.id === f.setId);
		if (set && set.ownerId === userId) {
			usedBytes += f.size;
			fileCount++;
		}
	}
	const setCount = db.data.sets.filter((s) => s.ownerId === userId).length;
	return { usedBytes, fileCount, setCount };
}

export function userView(user) {
	return { ...publicFields(user), usage: usageOf(user.id) };
}

function publicFields(u) {
	if (!u) return null;
	const { passwordHash, ...rest } = u;
	return rest;
}

const USERNAME_RE = /^[a-zA-Z0-9_.-]{3,32}$/;

export function listUsers() {
	return db.data.users.map(userView);
}

export function createUser(admin, body) {
	const { name, username, password, quotaMB } = body || {};
	if (!name || String(name).trim().length < 1 || String(name).trim().length > 80) {
		throw new ApiError(400, 'Name is required (1-80 characters).');
	}
	if (!USERNAME_RE.test(String(username || ''))) {
		throw new ApiError(400, 'Username must be 3-32 chars: letters, digits, _ . -');
	}
	if (!password || String(password).length < 8) {
		throw new ApiError(400, 'Password must be at least 8 characters.');
	}
	const uname = String(username).trim().toLowerCase();
	if (db.data.users.some((u) => u.username === uname)) {
		throw new ApiError(409, 'Username is already taken.');
	}

	let quotaBytes = config.DEFAULT_QUOTA_MB * MB;
	if (quotaMB !== undefined && quotaMB !== null && quotaMB !== '') {
		if (quotaMB === 'unlimited') {
			quotaBytes = null;
		} else {
			const mb = Number(quotaMB);
			if (!Number.isFinite(mb) || mb < 0) throw new ApiError(400, 'quotaMB must be >= 0, or null for unlimited.');
			quotaBytes = Math.round(mb * MB);
		}
	}

	const user = {
		id: id(),
		name: String(name).trim(),
		username: uname,
		role: 'user',
		passwordHash: hashPassword(password),
		quotaBytes,
		createdAt: now(),
		createdBy: admin ? admin.id : null,
		lastLoginAt: null
	};
	db.data.users.push(user);
	db.save();
	return userView(user);
}

export function updateUser(admin, userId, body) {
	const user = db.data.users.find((u) => u.id === userId);
	if (!user) throw new ApiError(404, 'User not found.');
	const { name, quotaMB, password } = body || {};

	if (name !== undefined) {
		if (!String(name).trim()) throw new ApiError(400, 'Name cannot be empty.');
		user.name = String(name).trim().slice(0, 80);
	}
	if (quotaMB !== undefined) {
		if (quotaMB === null || quotaMB === 'unlimited' || quotaMB === '') {
			user.quotaBytes = null;
		} else {
			const mb = Number(quotaMB);
			if (!Number.isFinite(mb) || mb < 0) {
				throw new ApiError(400, 'quotaMB must be >= 0, or null for unlimited.');
			}
			user.quotaBytes = Math.round(mb * MB);
		}
	}
	if (password !== undefined) {
		if (!password || String(password).length < 8) {
			throw new ApiError(400, 'Password must be at least 8 characters.');
		}
		user.passwordHash = hashPassword(password);
	}
	db.save();
	return userView(user);
}

export function deleteUser(admin, userId) {
	const user = db.data.users.find((u) => u.id === userId);
	if (!user) throw new ApiError(404, 'User not found.');
	if (user.id === admin.id) throw new ApiError(400, 'You cannot delete your own account.');
	if (user.role === 'superadmin') throw new ApiError(400, 'Cannot delete a super admin account.');

	// Never lose data: transfer owned sets to the acting super admin.
	for (const set of db.data.sets) if (set.ownerId === user.id) set.ownerId = admin.id;
	db.data.keys = db.data.keys.filter((k) => k.userId !== user.id);
	db.data.users = db.data.users.filter((u) => u.id !== user.id);
	db.save();
	return { transferredTo: admin.username };
}

/* ------------------------------------------------------------------- sets */

export function setStats(setId) {
	let fileCount = 0;
	let totalBytes = 0;
	for (const f of db.data.files) {
		if (f.setId === setId) {
			fileCount++;
			totalBytes += f.size;
		}
	}
	return { fileCount, totalBytes };
}

export function setView(set) {
	const owner = db.data.users.find((u) => u.id === set.ownerId);
	return {
		...set,
		ownerName: owner ? owner.name : null,
		ownerUsername: owner ? owner.username : null,
		stats: setStats(set.id)
	};
}

export function requireSet(user, idOrSlug) {
	const set = db.data.sets.find((s) => s.id === idOrSlug || s.slug === idOrSlug);
	if (!set || !(user.role === 'superadmin' || set.ownerId === user.id)) {
		throw new ApiError(404, 'Set not found.');
	}
	return set;
}

function uniqueSetSlug(name) {
	const base = slugify(name);
	let slug = base;
	let i = 2;
	while (db.data.sets.some((s) => s.slug === slug)) slug = `${base}-${i++}`;
	return slug;
}

export function listSets(user, { all = false, owner = null } = {}) {
	let sets;
	if (user.role !== 'superadmin') {
		sets = db.data.sets.filter((s) => s.ownerId === user.id);
	} else if (owner) {
		sets = db.data.sets.filter((s) => s.ownerId === owner);
	} else if (all) {
		sets = db.data.sets;
	} else {
		sets = db.data.sets.filter((s) => s.ownerId === user.id);
	}
	return sets
		.slice()
		.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
		.map(setView);
}

export function createSet(user, body) {
	const { name, description, isPublic } = body || {};
	if (!name || String(name).trim().length < 1 || String(name).trim().length > 80) {
		throw new ApiError(400, 'Set name is required (1-80 characters).');
	}
	const set = {
		id: id(),
		name: String(name).trim(),
		slug: uniqueSetSlug(name),
		description: String(description || '').slice(0, 500),
		ownerId: user.id,
		isPublic: !!isPublic, // default visibility applied to new uploads
		createdAt: now(),
		updatedAt: now()
	};
	db.data.sets.push(set);
	db.save();
	return setView(set);
}

export function updateSet(user, idOrSlug, body) {
	const set = requireSet(user, idOrSlug);
	const { name, description, isPublic } = body || {};
	if (name !== undefined) {
		if (!String(name).trim()) throw new ApiError(400, 'Set name cannot be empty.');
		set.name = String(name).trim().slice(0, 80); // slug stays stable so shared URLs keep working
	}
	if (description !== undefined) set.description = String(description).slice(0, 500);
	if (isPublic !== undefined) set.isPublic = !!isPublic;
	set.updatedAt = now();
	db.save();
	return setView(set);
}

export function deleteSet(user, idOrSlug) {
	const set = requireSet(user, idOrSlug);
	fs.rmSync(path.join(UPLOAD_DIR, set.id), { recursive: true, force: true });
	const fileIds = db.data.files.filter((f) => f.setId === set.id).map((f) => f.id);
	db.data.files = db.data.files.filter((f) => f.setId !== set.id);
	db.data.shares = db.data.shares.filter((s) => !fileIds.includes(s.fileId));
	db.data.sets = db.data.sets.filter((s) => s.id !== set.id);
	db.save();
	return { ok: true };
}

/* ------------------------------------------------------------------ files */

export function fileView(file) {
	const set = db.data.sets.find((s) => s.id === file.setId);
	const uploader = db.data.users.find((u) => u.id === file.uploadedBy);
	return {
		id: file.id,
		setId: file.setId,
		name: file.name,
		slug: file.slug,
		size: file.size,
		mimeType: file.mimeType,
		isPublic: file.isPublic,
		downloads: file.downloads,
		uploadedBy: file.uploadedBy,
		uploadedByName: uploader ? uploader.name : null,
		createdAt: file.createdAt,
		updatedAt: file.updatedAt,
		setName: set ? set.name : null,
		setSlug: set ? set.slug : null,
		publicUrl: file.isPublic && set ? `/s/${set.slug}/${file.slug}` : null,
		downloadUrl: `/api/files/${file.id}/download`,
		previewUrl: `/api/files/${file.id}/download`,
		apiUrl: `/api/files/${file.id}/download?api_key=YOUR_API_KEY`
	};
}

function uniqueFileSlug(setId, name) {
	const base = slugify(name);
	let slug = base;
	let i = 2;
	while (db.data.files.some((f) => f.setId === setId && f.slug === slug)) slug = `${base}-${i++}`;
	return slug;
}

export function listFiles(user, setIdOrSlug, { q = '', page = 1, limit = 50 } = {}) {
	const set = requireSet(user, setIdOrSlug);
	const needle = String(q || '').trim().toLowerCase();
	let files = db.data.files.filter(
		(f) => f.setId === set.id && (!needle || f.name.toLowerCase().includes(needle))
	);
	files.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
	const total = files.length;
	const currentPage = clampInt(page, 1, 1_000_000, 1);
	const pageSize = clampInt(limit, 1, 200, 50);
	const start = (currentPage - 1) * pageSize;
	return {
		set: setView(set),
		files: files.slice(start, start + pageSize).map(fileView),
		total,
		page: currentPage,
		limit: pageSize,
		usage: usageOf(user.id)
	};
}

export function requireFileForManagement(user, fileId) {
	const file = db.data.files.find((f) => f.id === fileId);
	if (!file) throw new ApiError(404, 'File not found.');
	const set = db.data.sets.find((s) => s.id === file.setId);
	const allowed = set && (user.role === 'superadmin' || set.ownerId === user.id);
	if (!allowed) throw new ApiError(404, 'File not found.');
	return { file, set };
}

export function recordUploads(user, set, uploaded, isPublic) {
	const incoming = uploaded.reduce((sum, f) => sum + (f.size || 0), 0);
	const used = usageOf(user.id).usedBytes;
	if (user.role !== 'superadmin' && user.quotaBytes != null && used + incoming > user.quotaBytes) {
		throw new ApiError(
			413,
			`Storage quota exceeded. Used ${formatBytes(used)} of ${formatBytes(user.quotaBytes)}.`,
			{ usedBytes: used, quotaBytes: user.quotaBytes }
		);
	}

	const records = uploaded.map((f) => {
		const displayName = path.basename(String(f.originalname || 'file')).slice(0, 200) || 'file';
		const detected = mime.lookup(displayName);
		const mimeType =
			f.mimetype && f.mimetype !== 'application/octet-stream'
				? f.mimetype
				: detected || 'application/octet-stream';
		const record = {
			id: id(),
			setId: set.id,
			name: displayName,
			slug: uniqueFileSlug(set.id, displayName),
			storedName: f.filename,
			size: f.size || 0,
			mimeType,
			isPublic: !!isPublic,
			uploadedBy: user.id,
			downloads: 0,
			createdAt: now(),
			updatedAt: now()
		};
		db.data.files.push(record);
		return record;
	});
	db.save();
	return records.map(fileView);
}

export function updateFile(user, fileId, body) {
	const { file } = requireFileForManagement(user, fileId);
	const { name, isPublic } = body || {};
	if (name !== undefined) {
		const nextName = path.basename(String(name).trim()).slice(0, 200);
		if (!nextName) throw new ApiError(400, 'File name cannot be empty.');
		file.name = nextName; // slug stays stable so existing public URLs keep working
	}
	if (isPublic !== undefined) file.isPublic = !!isPublic;
	file.updatedAt = now();
	db.save();
	return fileView(file);
}

export function deleteFile(user, fileId) {
	const { file } = requireFileForManagement(user, fileId);
	fs.rmSync(path.join(UPLOAD_DIR, file.setId, file.storedName), { force: true });
	db.data.files = db.data.files.filter((f) => f.id !== file.id);
	db.data.shares = db.data.shares.filter((s) => s.fileId !== file.id);
	db.save();
	return { ok: true };
}

export function getPublicFile(setSlug, fileSlug) {
	const set = db.data.sets.find((s) => s.slug === setSlug);
	if (!set) return null;
	const file = db.data.files.find((f) => f.setId === set.id && f.slug === fileSlug);
	if (!file || !file.isPublic) return null;
	return { file, set };
}

export function countDownload(file) {
	file.downloads = (file.downloads || 0) + 1;
	db.save();
}

/* ------------------------------------------------------------------ shares */

export function createShare(user, fileId, body) {
	const { file } = requireFileForManagement(user, fileId);
	let expiresAt = null;
	const raw = body ? body.expiresInDays : null;
	if (raw !== undefined && raw !== null && raw !== '' && raw !== 'never') {
		const days = Number(raw);
		if (!Number.isFinite(days) || days <= 0 || days > 3650) {
			throw new ApiError(400, 'expiresInDays must be between 1 and 3650.');
		}
		expiresAt = new Date(Date.now() + days * 86_400_000).toISOString();
	}
	const plain = token(24);
	const share = {
		id: id(),
		tokenHash: sha256(plain),
		tokenPrefix: plain.slice(0, 8),
		fileId: file.id,
		createdBy: user.id,
		createdAt: now(),
		expiresAt,
		revokedAt: null
	};
	db.data.shares.push(share);
	db.save();
	return {
		id: share.id,
		url: `/share/${plain}`,
		createdAt: share.createdAt,
		expiresAt: share.expiresAt,
		revokedAt: null
	};
}

export function listShares(user, fileId) {
	const { file } = requireFileForManagement(user, fileId);
	return db.data.shares
		.filter((s) => s.fileId === file.id)
		.slice()
		.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
		.map((s) => ({
			id: s.id,
			prefix: s.tokenPrefix,
			createdAt: s.createdAt,
			expiresAt: s.expiresAt,
			revokedAt: s.revokedAt
		}));
}

export function revokeShare(user, shareId) {
	const share = db.data.shares.find((s) => s.id === shareId);
	if (!share) throw new ApiError(404, 'Share link not found.');
	requireFileForManagement(user, share.fileId);
	share.revokedAt = now();
	db.save();
	return { ok: true };
}

export function findShareByToken(plainToken) {
	const hash = sha256(plainToken);
	const share = db.data.shares.find((s) => s.tokenHash === hash);
	if (!share || share.revokedAt) return null;
	if (share.expiresAt && new Date(share.expiresAt).getTime() < Date.now()) return null;
	const file = db.data.files.find((f) => f.id === share.fileId);
	if (!file) return null;
	const set = db.data.sets.find((s) => s.id === file.setId);
	if (!set) return null;
	return { share, file, set };
}

/* -------------------------------------------------------------------- keys */

export function listKeys(user, { all = false } = {}) {
	let keys = db.data.keys;
	if (!(user.role === 'superadmin' && all)) keys = keys.filter((k) => k.userId === user.id);
	return keys
		.slice()
		.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
		.map((k) => {
			const owner = db.data.users.find((u) => u.id === k.userId);
			return {
				id: k.id,
				name: k.name,
				prefix: k.prefix,
				userId: k.userId,
				ownerName: owner ? owner.name : null,
				ownerUsername: owner ? owner.username : null,
				createdAt: k.createdAt,
				lastUsedAt: k.lastUsedAt || null,
				revokedAt: k.revokedAt || null
			};
		});
}

export function createKey(user, body) {
	const name = String((body && body.name) || '').trim();
	if (!name || name.length > 60) throw new ApiError(400, 'Key name is required (1-60 characters).');
	const plain = newApiKey();
	const record = {
		id: id(),
		userId: user.id,
		name,
		keyHash: hashKey(plain),
		prefix: plain.slice(0, 11),
		createdAt: now(),
		lastUsedAt: null,
		revokedAt: null
	};
	db.data.keys.push(record);
	db.save();
	return {
		id: record.id,
		name: record.name,
		prefix: record.prefix,
		key: plain, // shown only once
		createdAt: record.createdAt,
		lastUsedAt: null,
		revokedAt: null
	};
}

export function revokeKey(user, keyId) {
	const key = db.data.keys.find((k) => k.id === keyId);
	if (!key) throw new ApiError(404, 'API key not found.');
	if (key.userId !== user.id && user.role !== 'superadmin') {
		throw new ApiError(404, 'API key not found.');
	}
	key.revokedAt = now();
	db.save();
	return { ok: true };
}

/* ------------------------------------------------------------------- stats */

export function statsFor(user) {
	if (user.role !== 'superadmin') {
		return {
			scope: 'user',
			...usageOf(user.id),
			quotaBytes: user.quotaBytes
		};
	}
	const users = db.data.users.map((u) => ({
		id: u.id,
		name: u.name,
		username: u.username,
		role: u.role,
		quotaBytes: u.quotaBytes,
		...usageOf(u.id)
	}));
	return {
		scope: 'instance',
		totals: {
			userCount: db.data.users.length,
			setCount: db.data.sets.length,
			fileCount: db.data.files.length,
			usedBytes: db.data.files.reduce((sum, f) => sum + (f.size || 0), 0)
		},
		users
	};
}
