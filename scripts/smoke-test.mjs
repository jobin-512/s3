import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * End-to-end smoke test. Starts an isolated dev server (temp data + uploads,
 * dedicated port) and exercises the entire API: setup, auth, users, sets,
 * multer uploads, private/public access, API keys, share links, quotas,
 * ranges, rename/delete and stats.
 *
 * Run with: npm test
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.SMOKE_PORT || 3210);
const BASE = `http://127.0.0.1:${PORT}`;
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'filevault-smoke-'));
const dataDir = path.join(tmpRoot, 'data');
const uploadsDir = path.join(tmpRoot, 'uploads');

let server;
let passed = 0;

function assert(condition, message) {
	if (!condition) throw new Error(`FAILED: ${message}`);
	passed++;
	console.log(`  \u2713 ${message}`);
}

async function waitForServer() {
	const deadline = Date.now() + 60_000;
	while (Date.now() < deadline) {
		try {
			const res = await fetch(`${BASE}/api/health`);
			if (res.ok) return;
		} catch {
			/* not up yet */
		}
		await new Promise((resolve) => setTimeout(resolve, 400));
	}
	throw new Error('Dev server did not become ready within 60s.');
}

async function call(pathname, { method = 'GET', token, key, cookie, body } = {}) {
	const headers = {};
	if (token) headers.authorization = `Bearer ${token}`;
	if (key) headers['x-api-key'] = key;
	if (cookie) headers.cookie = cookie;
	if (body !== undefined) headers['content-type'] = 'application/json';
	const res = await fetch(`${BASE}${pathname}`, {
		method,
		headers,
		body: body !== undefined ? JSON.stringify(body) : undefined,
		redirect: 'manual'
	});
	const text = await res.text();
	let data = null;
	try {
		data = text ? JSON.parse(text) : null;
	} catch {
		data = null;
	}
	return { res, data, text };
}

async function upload(setId, token, filename, content, isPublic, contentType = 'text/plain') {
	const form = new FormData();
	form.append('files', new Blob([content], { type: contentType }), filename);
	if (isPublic !== undefined) form.append('isPublic', String(isPublic));
	const res = await fetch(`${BASE}/api/sets/${setId}/files`, {
		method: 'POST',
		headers: { authorization: `Bearer ${token}` },
		body: form
	});
	const data = await res.json().catch(() => ({}));
	return { res, data };
}

function sessionCookieFrom(res) {
	const list =
		typeof res.headers.getSetCookie === 'function'
			? res.headers.getSetCookie()
			: [res.headers.get('set-cookie')].filter(Boolean);
	return list.map((c) => c.split(';')[0]).find((c) => c.startsWith('fv_session=')) || '';
}

async function run() {
	const useBuild = process.env.SMOKE_TARGET === 'build';
	if (useBuild && !fs.existsSync(path.join(ROOT, 'build', 'index.js'))) {
		throw new Error('Production build not found. Run "npm run build" first, or omit SMOKE_TARGET.');
	}

	console.log(
		`\nStarting isolated ${useBuild ? 'production' : 'dev'} server on ${BASE} …`
	);
	if (useBuild) {
		server = spawn(process.execPath, ['scripts/start.mjs'], {
			cwd: ROOT,
			env: {
				...process.env,
				PORT: String(PORT),
				DATA_DIR: dataDir,
				UPLOAD_DIR: uploadsDir,
				JWT_SECRET: 'smoke-test-secret-not-for-production',
				APP_NAME: 'FileVault Test'
			},
			stdio: ['ignore', 'pipe', 'pipe']
		});
	} else {
		server = spawn(
			process.execPath,
			['node_modules/vite/bin/vite.js', 'dev', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'],
			{
				cwd: ROOT,
				env: {
					...process.env,
					PORT: String(PORT),
					DATA_DIR: dataDir,
					UPLOAD_DIR: uploadsDir,
					JWT_SECRET: 'smoke-test-secret-not-for-production',
					APP_NAME: 'FileVault Test'
				},
				stdio: ['ignore', 'pipe', 'pipe']
			}
		);
	}
	server.stderr.on('data', (chunk) => process.stderr.write(chunk));
	await waitForServer();
	console.log('Server ready.\n');

	/* ------------------------------------------------------------ bootstrap */
	let { res, data } = await call('/api/status');
	assert(res.status === 200 && data.setupRequired === true, 'status reports first-run setup is required');
	let text = '';

	let page = await fetch(`${BASE}/`, { redirect: 'manual' });
	assert(page.status === 303 && page.headers.get('location') === '/setup', 'root redirects to /setup before bootstrap');

	({ res, data } = await call('/api/setup', {
		method: 'POST',
		body: { name: 'Root Admin', username: 'root', password: 'rootpass123' }
	}));
	assert(res.status === 201 && data.user.role === 'superadmin', 'setup creates the super admin');
	const rootToken = data.token;

	({ res } = await call('/api/setup', {
		method: 'POST',
		body: { name: 'Second', username: 'second', password: 'secondpass123' }
	}));
	assert(res.status === 403, 'setup is locked once a super admin exists');

	({ res, data } = await call('/api/status'));
	assert(data.setupRequired === false, 'status reports setup is complete');

	({ res } = await call('/api/auth/login', {
		method: 'POST',
		body: { username: 'root', password: 'wrong-password' }
	}));
	assert(res.status === 401, 'wrong password is rejected');

	({ res, data } = await call('/api/auth/login', {
		method: 'POST',
		body: { username: 'root', password: 'rootpass123' }
	}));
	assert(res.status === 200 && data.user.role === 'superadmin', 'super admin can log in');
	const rootCookie = sessionCookieFrom(res);
	assert(rootCookie.startsWith('fv_session='), 'login sets an httpOnly session cookie');

	({ res, data } = await call('/api/auth/me', { cookie: rootCookie }));
	assert(res.status === 200 && data.user.username === 'root', 'session cookie authenticates API requests');

	page = await fetch(`${BASE}/app`, {
		headers: { cookie: rootCookie },
		redirect: 'manual'
	});
	const appHtml = await page.text();
	assert(
		page.status === 200 && appHtml.includes('Sets') && appHtml.includes('API keys'),
		'dashboard page renders for an authenticated session'
	);

	page = await fetch(`${BASE}/app`, { redirect: 'manual' });
	assert(
		page.status === 303 && page.headers.get('location') === '/login',
		'dashboard redirects to /login without a session'
	);

	page = await fetch(`${BASE}/login`, {
		headers: { cookie: rootCookie },
		redirect: 'manual'
	});
	assert(page.status === 303 && page.headers.get('location') === '/app', 'login page redirects signed-in users');

	page = await fetch(`${BASE}/setup`, {
		headers: { cookie: rootCookie },
		redirect: 'manual'
	});
	assert(page.status === 303 && page.headers.get('location') === '/app', 'setup page is locked after bootstrap');

	page = await fetch(`${BASE}/`, { redirect: 'manual' });
	assert(
		page.status === 303 && page.headers.get('location') === '/login',
		'root redirects to /login when signed out (setup complete)'
	);

	/* ---------------------------------------------------------------- users */
	({ res, data } = await call('/api/users', {
		method: 'POST',
		token: rootToken,
		body: { name: 'Alice Example', username: 'alice', password: 'alicepass123', quotaMB: 1 }
	}));
	assert(res.status === 201 && data.user.role === 'user', 'super admin creates a normal user');
	const alice = data.user;

	({ res } = await call('/api/users', {
		method: 'POST',
		token: rootToken,
		body: { name: 'Duplicate', username: 'ALICE', password: 'whatever123' }
	}));
	assert(res.status === 409, 'duplicate usernames are rejected case-insensitively');

	({ res, data } = await call('/api/auth/login', {
		method: 'POST',
		body: { username: 'alice', password: 'alicepass123' }
	}));
	assert(res.status === 200, 'normal user can log in');
	let aliceToken = data.token;

	({ res } = await call('/api/users', {
		method: 'POST',
		token: aliceToken,
		body: { name: 'Nope', username: 'nope', password: 'nopepass123' }
	}));
	assert(res.status === 403, 'normal users cannot create users');
	({ res } = await call('/api/users', { token: aliceToken }));
	assert(res.status === 403, 'normal users cannot list users');

	/* ----------------------------------------------------------------- sets */
	({ res, data } = await call('/api/sets', {
		method: 'POST',
		token: aliceToken,
		body: { name: 'Alice Docs', description: 'Files for Alice', isPublic: false }
	}));
	assert(res.status === 201 && data.set.slug === 'alice-docs', 'user creates a set with a stable slug');
	const aliceSet = data.set;

	({ res, data } = await call('/api/sets?all=1', { token: rootToken }));
	assert(res.status === 200 && data.sets.some((s) => s.id === aliceSet.id), 'super admin sees all sets');

	/* ---------------------------------------------------------------- files */
	({ res, data } = await upload(aliceSet.id, aliceToken, 'hello.txt', 'hello world!', false));
	assert(res.status === 201 && data.files.length === 1, 'multer upload stores a file');
	const file = data.files[0];
	assert(file.isPublic === false && file.publicUrl === null, 'uploaded file is private by default');
	assert(fs.readdirSync(path.join(uploadsDir, aliceSet.id)).length === 1, 'file exists on local disk');

	const publicUrl = `/s/${file.setSlug}/${file.slug}`;
	({ res } = await call(publicUrl));
	assert(res.status === 404, 'private file is not reachable through its public URL');

	({ res } = await call(`/api/files/${file.id}/download`));
	assert(res.status === 401, 'private download without credentials is rejected');

	({ res, text } = await call(`/api/files/${file.id}/download`, { token: aliceToken }));
	assert(res.status === 200 && text === 'hello world!', 'owner downloads private file with a Bearer token');

	({ res, text } = await call(`/api/files/${file.id}/download`, { token: rootToken }));
	assert(res.status === 200 && text === 'hello world!', 'super admin can access any private file');

	let aliceKey;
	({ res, data } = await call('/api/keys', {
		method: 'POST',
		token: aliceToken,
		body: { name: 'smoke key' }
	}));
	assert(res.status === 201 && data.key.key.startsWith('fv_'), 'API key is created and returned once');
	aliceKey = data.key;

	({ res } = await call(`/api/files/${file.id}/download`, { key: aliceKey.key }));
	assert(res.status === 200, 'API key (x-api-key header) downloads a private file');
	({ res } = await call(`/api/files/${file.id}/download?api_key=${aliceKey.key}`));
	assert(res.status === 200, 'API key (query parameter) downloads a private file');
	({ res } = await call(`/api/files/${file.id}/download`, { key: 'fv_bad_key' }));
	assert(res.status === 401, 'invalid API key is rejected');

	/* ------------------------------------------------------------ public file */
	({ res, data } = await call(`/api/files/${file.id}`, {
		method: 'PATCH',
		token: aliceToken,
		body: { isPublic: true }
	}));
	assert(res.status === 200 && data.file.isPublic === true, 'owner can make a file public');
	assert(data.file.publicUrl === publicUrl, 'public URL is returned for public files');

	({ res, text } = await call(publicUrl));
	assert(res.status === 200 && text === 'hello world!', 'public file URL works without any key');

	let headRes = await fetch(`${BASE}${publicUrl}`, { method: 'HEAD' });
	assert(headRes.status === 200, 'HEAD requests work on public file URLs');

	let rangeRes = await fetch(`${BASE}${publicUrl}`, { headers: { range: 'bytes=0-4' } });
	assert(rangeRes.status === 206 && (await rangeRes.text()) === 'hello', 'range requests work for media streaming');
	assert(rangeRes.headers.get('content-range') === 'bytes 0-4/12', 'range response reports correct content-range');

	({ res, data } = await call(`/api/sets/${aliceSet.id}/files?q=hello`, { token: aliceToken }));
	assert(res.status === 200 && data.total === 1, 'file search finds a match');
	({ res, data } = await call(`/api/sets/${aliceSet.id}/files?q=zzz`, { token: aliceToken }));
	assert(data.total === 0, 'file search filters non-matches');

	/* --------------------------------------------------------------- sharing */
	({ res, data } = await call(`/api/files/${file.id}/shares`, {
		method: 'POST',
		token: aliceToken,
		body: { expiresInDays: 1 }
	}));
	assert(res.status === 201 && data.share.url.startsWith('/share/'), 'share link is created');
	const shareUrl = data.share.url;

	({ res, text } = await call(shareUrl));
	assert(res.status === 200 && text === 'hello world!', 'share link serves the file without a key');

	({ res } = await call(`/api/shares/${data.share.id}`, { method: 'DELETE', token: rootToken }));
	assert(res.status === 200, 'super admin can revoke a share link');
	({ res } = await call(shareUrl));
	assert(res.status === 404, 'revoked share link no longer works');

	/* --------------------------------------------------------------- quotas */
	const big = Buffer.alloc(2 * 1024 * 1024, 97);
	({ res, data } = await upload(aliceSet.id, aliceToken, 'too-big.bin', big, false));
	assert(res.status === 413, 'upload over the user quota is rejected');
	assert(
		fs.readdirSync(path.join(uploadsDir, aliceSet.id)).length === 1,
		'quota-rejected upload is cleaned off disk'
	);
	({ res, data } = await call(`/api/sets/${aliceSet.id}/files`, { token: aliceToken }));
	assert(data.total === 1, 'quota-rejected file is not recorded');

	/* -------------------------------------------------------- rename + delete */
	({ res, data } = await call(`/api/files/${file.id}`, {
		method: 'PATCH',
		token: aliceToken,
		body: { name: 'renamed.txt' }
	}));
	assert(res.status === 200 && data.file.name === 'renamed.txt', 'file can be renamed');
	assert(data.file.slug === file.slug, 'rename keeps the public URL slug stable');
	({ res } = await call(publicUrl));
	assert(res.status === 200, 'public URL still works after rename');

	({ res } = await call(`/api/files/${file.id}`, { method: 'DELETE', token: aliceToken }));
	assert(res.status === 200, 'owner deletes a file');
	({ res } = await call(publicUrl));
	assert(res.status === 404, 'deleted file is no longer publicly reachable');
	assert(fs.readdirSync(path.join(uploadsDir, aliceSet.id)).length === 0, 'deleted file is removed from disk');

	/* -------------------------------------------------- active content safety */
	({ res, data } = await upload(
		aliceSet.id,
		aliceToken,
		'page.html',
		'<script>alert(1)</script>',
		true,
		'text/html'
	));
	assert(res.status === 201, 'HTML file can be stored as a public file');
	const htmlFile = data.files[0];
	let htmlRes = await fetch(`${BASE}/s/${htmlFile.setSlug}/${htmlFile.slug}`);
	assert(
		htmlRes.status === 200 && (htmlRes.headers.get('content-disposition') || '').startsWith('attachment'),
		'HTML types are forced to download (no stored XSS)'
	);
	await htmlRes.text();
	({ res } = await call(`/api/files/${htmlFile.id}`, { method: 'DELETE', token: aliceToken }));
	assert(res.status === 200, 'test HTML file cleaned up');

	({ res, data } = await upload(
		aliceSet.id,
		aliceToken,
		'logo.svg',
		'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
		true,
		'image/svg+xml'
	));
	assert(res.status === 201, 'SVG file can be stored as a public file');
	const svgFile = data.files[0];
	htmlRes = await fetch(`${BASE}/s/${svgFile.setSlug}/${svgFile.slug}`);
	assert(
		htmlRes.status === 200 && (htmlRes.headers.get('content-disposition') || '').startsWith('attachment'),
		'SVG images are forced to download (no stored XSS)'
	);
	await htmlRes.text();
	({ res } = await call(`/api/files/${svgFile.id}`, { method: 'DELETE', token: aliceToken }));
	assert(res.status === 200, 'test SVG file cleaned up');

	/* --------------------------------------------------- user data transfer */
	({ res, data } = await call('/api/users', {
		method: 'POST',
		token: rootToken,
		body: { name: 'Bob', username: 'bob', password: 'bobpass123', quotaMB: 5 }
	}));
	assert(res.status === 201, 'another user can be created');
	const bob = data.user;

	({ res, data } = await call('/api/auth/login', {
		method: 'POST',
		body: { username: 'bob', password: 'bobpass123' }
	}));
	const bobToken = data.token;
	({ res, data } = await call('/api/sets', {
		method: 'POST',
		token: bobToken,
		body: { name: 'Bob Bucket' }
	}));
	const bobSet = data.set;
	({ res } = await upload(bobSet.id, bobToken, 'bob.txt', 'bob data', true));
	assert(res.status === 201, 'bob uploads a file');

	({ res } = await call(`/api/users/${bob.id}`, { method: 'DELETE', token: rootToken }));
	assert(res.status === 200, 'super admin deletes a user');
	({ res, data } = await call('/api/sets?all=1', { token: rootToken }));
	const transferred = data.sets.find((s) => s.id === bobSet.id);
	assert(transferred && transferred.ownerUsername === 'root', "deleted user's sets transfer to the super admin");
	({ res, data } = await call('/api/users', { token: rootToken }));
	assert(!data.users.some((u) => u.username === 'bob'), 'deleted user is gone');

	/* ------------------------------------------------------- password change */
	({ res } = await call('/api/auth/change-password', {
		method: 'POST',
		token: aliceToken,
		body: { currentPassword: 'wrong', newPassword: 'alicepass456' }
	}));
	assert(res.status === 400, 'password change requires the current password');
	({ res } = await call('/api/auth/change-password', {
		method: 'POST',
		token: aliceToken,
		body: { currentPassword: 'alicepass123', newPassword: 'alicepass456' }
	}));
	assert(res.status === 200, 'user changes their password');
	({ res } = await call('/api/auth/login', {
		method: 'POST',
		body: { username: 'alice', password: 'alicepass123' }
	}));
	assert(res.status === 401, 'old password stops working');
	({ res, data } = await call('/api/auth/login', {
		method: 'POST',
		body: { username: 'alice', password: 'alicepass456' }
	}));
	assert(res.status === 200, 'new password works');
	aliceToken = data.token;

	/* ------------------------------------------------------------ set delete */
	({ res } = await call(`/api/sets/${aliceSet.id}`, { method: 'DELETE', token: aliceToken }));
	assert(res.status === 200, 'owner deletes a set');
	assert(!fs.existsSync(path.join(uploadsDir, aliceSet.id)), 'set directory is removed from disk');
	({ res, data } = await call('/api/sets?all=1', { token: rootToken }));
	assert(!data.sets.some((s) => s.id === aliceSet.id), 'deleted set is gone for the super admin');

	/* ---------------------------------------------------------------- misc */
	({ res, data } = await call('/api/stats', { token: rootToken }));
	assert(res.status === 200 && data.scope === 'instance' && data.totals.userCount === 2, 'super admin stats show instance totals');

	({ res, data } = await call('/api/keys?all=1', { token: rootToken }));
	assert(
		data.keys.some((k) => k.id === aliceKey.id && k.ownerUsername === 'alice'),
		'super admin can audit all API keys'
	);

	let optionsRes = await fetch(`${BASE}/api/status`, { method: 'OPTIONS' });
	assert(
		optionsRes.status === 204 && optionsRes.headers.get('access-control-allow-origin') === '*',
		'API sends CORS headers and answers preflight requests'
	);

	({ res } = await call('/api/auth/logout', { method: 'POST', cookie: rootCookie }));
	assert(res.status === 200, 'logout endpoint responds');

	console.log(`\nAll ${passed} checks passed.\n`);
}

async function shutdown() {
	if (!server) return;
	if (process.platform === 'win32') {
		try {
			execSync(`taskkill /pid ${server.pid} /T /F`, { stdio: 'ignore' });
		} catch {
			/* already gone */
		}
		return;
	}
	await new Promise((resolve) => {
		server.once('exit', resolve);
		try {
			server.kill('SIGTERM');
		} catch {
			resolve();
		}
		setTimeout(resolve, 3000);
	});
}

try {
	await run();
} catch (error) {
	console.error(`\n${error.message}\n`);
	process.exitCode = 1;
} finally {
	await shutdown();
	fs.rmSync(tmpRoot, { recursive: true, force: true });
}
