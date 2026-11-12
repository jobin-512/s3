<script>
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { fly } from 'svelte/transition';
	import Modal from '$lib/components/Modal.svelte';
	import { formatBytes as fmt, formatDate as when } from '$lib/format.js';

	let { data } = $props();
	let isSuper = $derived(data.user.role === 'superadmin');

	/* ------------------------------------------------------------ app state */
	let sets = $state([]);
	let activeSetId = $state(null);
	let activeSet = $derived(sets.find((s) => s.id === activeSetId) ?? null);
	let files = $state([]);
	let totalFiles = $state(0);
	let page = $state(1);
	const pageSize = 20;
	let totalPages = $derived(Math.max(1, Math.ceil(totalFiles / pageSize)));
	let query = $state('');
	let filesLoading = $state(false);
	// svelte-ignore state_referenced_locally
	let usage = $state(data.user.usage);
	let percent = $derived(
		usage.quotaBytes ? Math.min(100, Math.round((usage.usedBytes / usage.quotaBytes) * 100)) : 0
	);

	let uploadPublic = $state(false);
	let uploading = $state(false);
	let dragOver = $state(false);
	let togglingId = $state(null);

	let toast = $state(null);
	let toastTimer;
	let searchTimer;

	/* --------------------------------------------------------------- modals */
	let modal = $state(null);
	let busy = $state(false);
	let formError = $state('');

	let setForm = $state({ name: '', description: '', isPublic: false });
	let editForm = $state({ name: '', description: '', isPublic: false });

	let renameTarget = $state(null);
	let renameValue = $state('');

	let shareTarget = $state(null);
	let sharesList = $state([]);
	let shareDays = $state('7');
	let freshShareUrl = $state('');

	let keys = $state([]);
	let keyName = $state('');
	let freshKey = $state(null);
	let showAllKeys = $state(false);

	let users = $state([]);
	let userForm = $state({ name: '', username: '', password: '', quotaMB: 1024 });
	let editingUser = $state(null);

	let pwForm = $state({ current: '', next: '', confirm: '' });

	onMount(async () => {
		await refreshSets();
		if (sets.length > 0) await selectSet(sets[0].id);
	});

	/* --------------------------------------------------------------- helpers */
	async function request(path, { method = 'GET', body } = {}) {
		const options = { method, credentials: 'same-origin', headers: {} };
		if (body !== undefined) {
			options.headers['content-type'] = 'application/json';
			options.body = JSON.stringify(body);
		}
		const res = await fetch(path, options);
		const text = await res.text();
		let payload = null;
		try {
			payload = text ? JSON.parse(text) : null;
		} catch {
			payload = null;
		}
		if (!res.ok) {
			const error = new Error((payload && payload.error) || `Request failed (${res.status})`);
			error.status = res.status;
			if (res.status === 401) goto('/login');
			throw error;
		}
		return payload;
	}

	function notify(message, type = 'success') {
		toast = { message, type };
		clearTimeout(toastTimer);
		toastTimer = setTimeout(() => (toast = null), 4000);
	}

	async function copy(text) {
		try {
			await navigator.clipboard.writeText(text);
			notify('Copied to clipboard');
		} catch {
			try {
				const area = document.createElement('textarea');
				area.value = text;
				document.body.appendChild(area);
				area.select();
				document.execCommand('copy');
				area.remove();
				notify('Copied to clipboard');
			} catch {
				notify('Could not copy — copy it manually.', 'error');
			}
		}
	}

	function absolute(path) {
		return new URL(path, window.location.origin).href;
	}

	function icon(mime = '') {
		if (mime.startsWith('image/')) return '🖼️';
		if (mime.startsWith('video/')) return '🎬';
		if (mime.startsWith('audio/')) return '🎵';
		if (mime.includes('pdf')) return '📕';
		if (mime.startsWith('text/')) return '📝';
		if (/zip|tar|compressed|gzip/.test(mime)) return '🗜️';
		return '📦';
	}

	/* ------------------------------------------------------------------ sets */
	async function refreshSets() {
		try {
			const res = await request(`/api/sets${isSuper ? '?all=1' : ''}`);
			sets = res.sets;
			if (activeSetId && !sets.some((s) => s.id === activeSetId)) activeSetId = null;
		} catch (error) {
			notify(error.message, 'error');
		}
	}

	async function selectSet(id) {
		activeSetId = id;
		page = 1;
		query = '';
		const set = sets.find((s) => s.id === id);
		if (set) uploadPublic = set.isPublic;
		files = [];
		totalFiles = 0;
		await loadFiles();
	}

	async function loadFiles() {
		if (!activeSetId) return;
		filesLoading = true;
		try {
			const params = new URLSearchParams({ page: String(page), limit: String(pageSize) });
			if (query.trim()) params.set('q', query.trim());
			const res = await request(`/api/sets/${activeSetId}/files?${params}`);
			files = res.files;
			totalFiles = res.total;
			const index = sets.findIndex((s) => s.id === res.set.id);
			if (index !== -1) sets[index] = res.set;
			if (res.usage) usage = res.usage;
		} catch (error) {
			notify(error.message, 'error');
		} finally {
			filesLoading = false;
		}
	}

	function onSearchInput() {
		clearTimeout(searchTimer);
		searchTimer = setTimeout(() => {
			page = 1;
			loadFiles();
		}, 300);
	}

	function openCreateSet() {
		setForm = { name: '', description: '', isPublic: false };
		formError = '';
		modal = 'set';
	}

	async function createSet(event) {
		event.preventDefault();
		formError = '';
		busy = true;
		try {
			const res = await request('/api/sets', {
				method: 'POST',
				body: { ...setForm }
			});
			modal = null;
			await refreshSets();
			await selectSet(res.set.id);
			notify('Set created');
		} catch (error) {
			formError = error.message;
		} finally {
			busy = false;
		}
	}

	function openEditSet() {
		if (!activeSet) return;
		editForm = {
			name: activeSet.name,
			description: activeSet.description || '',
			isPublic: activeSet.isPublic
		};
		formError = '';
		modal = 'editSet';
	}

	async function saveSet(event) {
		event.preventDefault();
		formError = '';
		busy = true;
		try {
			await request(`/api/sets/${activeSet.id}`, { method: 'PATCH', body: { ...editForm } });
			modal = null;
			await refreshSets();
			notify('Set updated');
		} catch (error) {
			formError = error.message;
		} finally {
			busy = false;
		}
	}

	async function removeSet() {
		if (!activeSet) return;
		if (!window.confirm(`Delete set "${activeSet.name}" and every file inside it? This cannot be undone.`)) {
			return;
		}
		try {
			await request(`/api/sets/${activeSet.id}`, { method: 'DELETE' });
			activeSetId = null;
			files = [];
			totalFiles = 0;
			await Promise.all([refreshSets(), refreshUsage()]);
			notify('Set deleted');
		} catch (error) {
			notify(error.message, 'error');
		}
	}

	/* ----------------------------------------------------------------- files */
	function onFileInput(event) {
		const list = Array.from(event.currentTarget.files || []);
		event.currentTarget.value = '';
		if (list.length) uploadFiles(list);
	}

	function onDrop(event) {
		event.preventDefault();
		dragOver = false;
		const list = Array.from(event.dataTransfer?.files || []);
		if (list.length) uploadFiles(list);
	}

	async function uploadFiles(list) {
		if (!activeSet || !list.length) return;
		uploading = true;
		try {
			const form = new FormData();
			for (const file of list) form.append('files', file);
			form.append('isPublic', String(uploadPublic));

			const res = await fetch(`/api/sets/${activeSet.id}/files`, {
				method: 'POST',
				body: form,
				credentials: 'same-origin'
			});
			const payload = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(payload.error || 'Upload failed.');
			notify(`${payload.files.length} file${payload.files.length === 1 ? '' : 's'} uploaded`);
			page = 1;
			await Promise.all([loadFiles(), refreshSets(), refreshUsage()]);
		} catch (error) {
			notify(error.message, 'error');
		} finally {
			uploading = false;
		}
	}

	async function refreshUsage() {
		try {
			const res = await request('/api/auth/me');
			usage = res.user.usage;
		} catch {
			/* ignore */
		}
	}

	async function togglePublic(file) {
		if (togglingId) return;
		togglingId = file.id;
		try {
			const res = await request(`/api/files/${file.id}`, {
				method: 'PATCH',
				body: { isPublic: !file.isPublic }
			});
			await loadFiles();
			notify(
				res.file.isPublic
					? 'File is now public — anyone with its link can download it without a key.'
					: 'File is now private — an API key or signed-in session is required.'
			);
		} catch (error) {
			notify(error.message, 'error');
		} finally {
			togglingId = null;
		}
	}

	function triggerDownload(file) {
		const link = document.createElement('a');
		link.href = `/api/files/${file.id}/download?download=1`;
		link.download = file.name;
		document.body.appendChild(link);
		link.click();
		link.remove();
	}

	function previewFile(file) {
		window.open(`/api/files/${file.id}/download`, '_blank', 'noopener');
	}

	function openRename(file) {
		renameTarget = file;
		renameValue = file.name;
		formError = '';
		modal = 'rename';
	}

	async function saveRename(event) {
		event.preventDefault();
		if (!renameTarget) return;
		formError = '';
		busy = true;
		try {
			await request(`/api/files/${renameTarget.id}`, {
				method: 'PATCH',
				body: { name: renameValue }
			});
			modal = null;
			await loadFiles();
			notify('File renamed');
		} catch (error) {
			formError = error.message;
		} finally {
			busy = false;
		}
	}

	async function removeFile(file) {
		if (!window.confirm(`Delete "${file.name}"? This cannot be undone.`)) return;
		try {
			await request(`/api/files/${file.id}`, { method: 'DELETE' });
			await Promise.all([loadFiles(), refreshSets(), refreshUsage()]);
			notify('File deleted');
		} catch (error) {
			notify(error.message, 'error');
		}
	}

	/* ---------------------------------------------------------------- shares */
	async function openShare(file) {
		shareTarget = file;
		sharesList = [];
		freshShareUrl = '';
		shareDays = '7';
		formError = '';
		modal = 'share';
		try {
			const res = await request(`/api/files/${file.id}/shares`);
			sharesList = res.shares;
		} catch (error) {
			formError = error.message;
		}
	}

	async function createShareLink() {
		if (!shareTarget) return;
		busy = true;
		formError = '';
		try {
			const res = await request(`/api/files/${shareTarget.id}/shares`, {
				method: 'POST',
				body: { expiresInDays: shareDays === 'never' ? null : Number(shareDays) }
			});
			freshShareUrl = absolute(res.share.url);
			sharesList = (await request(`/api/files/${shareTarget.id}/shares`)).shares;
			await copy(freshShareUrl);
		} catch (error) {
			formError = error.message;
		} finally {
			busy = false;
		}
	}

	async function revokeShareLink(share) {
		if (!window.confirm('Revoke this share link? Anyone using it will lose access.')) return;
		try {
			await request(`/api/shares/${share.id}`, { method: 'DELETE' });
			sharesList = (await request(`/api/files/${shareTarget.id}/shares`)).shares;
			if (freshShareUrl.includes(`/share/${share.prefix}`)) freshShareUrl = '';
			notify('Share link revoked');
		} catch (error) {
			notify(error.message, 'error');
		}
	}

	/* ------------------------------------------------------------------ keys */
	async function openKeys() {
		modal = 'keys';
		formError = '';
		keyName = '';
		freshKey = null;
		await loadKeys();
	}

	async function loadKeys() {
		try {
			const res = await request(`/api/keys${isSuper && showAllKeys ? '?all=1' : ''}`);
			keys = res.keys;
		} catch (error) {
			notify(error.message, 'error');
		}
	}

	async function toggleAllKeys(event) {
		showAllKeys = event.currentTarget.checked;
		await loadKeys();
	}

	async function createKey(event) {
		event.preventDefault();
		formError = '';
		if (!keyName.trim()) {
			formError = 'Give the key a name so you can identify it later.';
			return;
		}
		busy = true;
		try {
			const res = await request('/api/keys', { method: 'POST', body: { name: keyName.trim() } });
			freshKey = res.key;
			keyName = '';
			await loadKeys();
			notify('API key created');
		} catch (error) {
			formError = error.message;
		} finally {
			busy = false;
		}
	}

	async function revokeKeyItem(key) {
		if (!window.confirm(`Revoke API key "${key.name}"? Apps using it will stop working.`)) return;
		try {
			await request(`/api/keys/${key.id}`, { method: 'DELETE' });
			if (freshKey && freshKey.id === key.id) freshKey = null;
			await loadKeys();
			notify('API key revoked');
		} catch (error) {
			notify(error.message, 'error');
		}
	}

	/* ----------------------------------------------------------------- users */
	async function openUsers() {
		modal = 'users';
		formError = '';
		editingUser = null;
		await loadUsers();
	}

	async function loadUsers() {
		try {
			const res = await request('/api/users');
			users = res.users;
		} catch (error) {
			notify(error.message, 'error');
		}
	}

	async function createUser(event) {
		event.preventDefault();
		formError = '';
		busy = true;
		try {
			await request('/api/users', { method: 'POST', body: { ...userForm } });
			userForm = { name: '', username: '', password: '', quotaMB: 1024 };
			await loadUsers();
			notify('User created');
		} catch (error) {
			formError = error.message;
		} finally {
			busy = false;
		}
	}

	function startEditUser(user) {
		editingUser = {
			id: user.id,
			name: user.name,
			quotaMB: user.quotaBytes == null ? '' : Math.round(user.quotaBytes / 1048576)
		};
	}

	async function saveEditUser(event) {
		event.preventDefault();
		busy = true;
		try {
			await request(`/api/users/${editingUser.id}`, {
				method: 'PATCH',
				body: {
					name: editingUser.name,
					quotaMB: editingUser.quotaMB === '' ? null : Number(editingUser.quotaMB)
				}
			});
			editingUser = null;
			await loadUsers();
			notify('User updated');
		} catch (error) {
			notify(error.message, 'error');
		} finally {
			busy = false;
		}
	}

	async function resetUserPassword(user) {
		const password = window.prompt(`New password for @${user.username} (minimum 8 characters):`);
		if (!password) return;
		if (password.length < 8) {
			notify('Password must be at least 8 characters.', 'error');
			return;
		}
		try {
			await request(`/api/users/${user.id}`, { method: 'PATCH', body: { password } });
			notify('Password updated');
		} catch (error) {
			notify(error.message, 'error');
		}
	}

	async function removeUser(user) {
		if (
			!window.confirm(
				`Delete user "${user.username}"? Their sets and files will be transferred to you, and their API keys will be revoked.`
			)
		) {
			return;
		}
		try {
			await request(`/api/users/${user.id}`, { method: 'DELETE' });
			await Promise.all([loadUsers(), refreshSets()]);
			notify('User deleted');
		} catch (error) {
			notify(error.message, 'error');
		}
	}

	/* -------------------------------------------------------------- password */
	function openPassword() {
		pwForm = { current: '', next: '', confirm: '' };
		formError = '';
		modal = 'password';
	}

	async function changePassword(event) {
		event.preventDefault();
		formError = '';
		if (pwForm.next.length < 8) {
			formError = 'New password must be at least 8 characters.';
			return;
		}
		if (pwForm.next !== pwForm.confirm) {
			formError = 'New passwords do not match.';
			return;
		}
		busy = true;
		try {
			await request('/api/auth/change-password', {
				method: 'POST',
				body: { currentPassword: pwForm.current, newPassword: pwForm.next }
			});
			modal = null;
			notify('Password updated');
		} catch (error) {
			formError = error.message;
		} finally {
			busy = false;
		}
	}

	async function logout() {
		try {
			await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
		} catch {
			/* ignore */
		}
		await goto('/login');
	}

	function subtitleCount(count) {
		return `${count} file${count === 1 ? '' : 's'}`;
	}
</script>

<header class="topbar">
	<div class="brand">
		<span class="logo">◧</span>
		<span>
			{data.appName}
			<small>file storage</small>
		</span>
	</div>

	<div class="top-actions">
		{#if !isSuper}
			<div class="usage" title="Your storage usage">
				<div class="meter">
					<span style={`width: ${percent}%`}></span>
				</div>
				<span class="faint">{fmt(usage.usedBytes)} / {fmt(usage.quotaBytes)}</span>
			</div>
		{:else}
			<span class="badge admin">Super admin</span>
		{/if}

		<button class="btn ghost sm" type="button" onclick={openKeys}>API keys</button>
		{#if isSuper}
			<button class="btn ghost sm" type="button" onclick={openUsers}>Users</button>
		{/if}
		<button class="btn ghost sm" type="button" onclick={openPassword}>Password</button>

		<div class="userchip" title={`Signed in as @${data.user.username}`}>
			<span class="avatar">{data.user.name.slice(0, 1).toUpperCase()}</span>
			<span class="userinfo">
				<span>{data.user.name}</span>
				<span class="faint">@{data.user.username}</span>
			</span>
		</div>

		<button class="btn ghost sm" type="button" onclick={logout}>Sign out</button>
	</div>
</header>

<div class="shell">
	<aside class="sidebar">
		<div class="sidebar-head">
			<span>Sets</span>
			<button class="btn sm" type="button" onclick={openCreateSet}>+ New set</button>
		</div>

		<div class="set-list">
			{#each sets as set (set.id)}
				<button
					class="set-item"
					class:active={set.id === activeSetId}
					type="button"
					onclick={() => selectSet(set.id)}
				>
					<span class="set-icon">▣</span>
					<span class="set-meta">
						<span class="set-name truncate">{set.name}</span>
						<span class="faint">
							{subtitleCount(set.stats.fileCount)} · {fmt(set.stats.totalBytes)}
						</span>
						{#if isSuper && set.ownerId !== data.user.id}
							<span class="badge owner">@{set.ownerUsername}</span>
						{/if}
					</span>
				</button>
			{:else}
				<p class="hint sidebar-empty">No sets yet — create one to start uploading.</p>
			{/each}
		</div>

		<div class="sidebar-foot">
			<div class="usage-card">
				<div class="row" style="justify-content: space-between">
					<span class="faint">Storage</span>
					<span>{fmt(usage.usedBytes)}</span>
				</div>
				{#if usage.quotaBytes != null}
					<div class="meter" style="width: 100%">
						<span style="width: {percent}%"></span>
					</div>
					<span class="faint">of {fmt(usage.quotaBytes)} quota</span>
				{:else}
					<span class="faint">Unlimited storage</span>
				{/if}
				<span class="faint">{subtitleCount(usage.fileCount)} in {usage.setCount} set{usage.setCount === 1 ? '' : 's'}</span>
			</div>
			<p class="hint">
				API access: send <code class="mono">x-api-key</code> (or <code class="mono">?api_key=</code>).
				Public files need no key.
			</p>
		</div>
	</aside>

	<main class="main">
		{#if activeSet}
			<div class="set-head">
				<div>
					<div class="row" style="flex-wrap: wrap">
						<h1>{activeSet.name}</h1>
						<span class="badge" class:public={activeSet.isPublic} class:private={!activeSet.isPublic}>
							{activeSet.isPublic ? 'new files public' : 'new files private'}
						</span>
					</div>
					<p class="muted">{activeSet.description || 'No description yet.'}</p>
					<p class="faint mono">/{activeSet.slug} · {subtitleCount(activeSet.stats.fileCount)} · {fmt(activeSet.stats.totalBytes)}</p>
				</div>
				<div class="row">
					<button class="btn sm" type="button" onclick={openEditSet}>Set settings</button>
					<button class="btn danger sm" type="button" onclick={removeSet}>Delete set</button>
				</div>
			</div>

			<div
				class="upload-zone"
				class:dragover={dragOver}
				role="region"
				aria-label="File upload area"
				ondragover={(event) => {
					event.preventDefault();
					dragOver = true;
				}}
				ondragleave={() => (dragOver = false)}
				ondrop={onDrop}
			>
				<input id="file-input" type="file" multiple hidden onchange={onFileInput} />
				<div class="upload-row">
					<span class="upload-icon">↑</span>
					<div>
						<strong>Drop files here</strong>
						<span class="muted">or</span>
						<button
							class="link-btn"
							type="button"
							onclick={() => document.getElementById('file-input')?.click()}
						>
							browse
						</button>
					</div>
					{#if uploading}
						<span class="row"><span class="spinner"></span><span class="faint">Uploading…</span></span>
					{/if}
				</div>
				<div class="upload-foot">
					<label class="check">
						<input type="checkbox" bind:checked={uploadPublic} />
						<span>Upload as public — anyone with the link can download without a key</span>
					</label>
					<span class="hint">Up to {data.limits.maxFiles} files per upload · {data.limits.maxUploadMB} MB max per file</span>
				</div>
			</div>

			<div class="toolbar">
				<input
					type="search"
					placeholder="Search files in this set…"
					bind:value={query}
					oninput={onSearchInput}
				/>
				<button class="btn sm" type="button" onclick={() => { page = 1; loadFiles(); }}>
					Refresh
				</button>
			</div>

			<div class="card file-card">
				{#if filesLoading && files.length === 0}
					<div class="empty"><span class="spinner"></span></div>
				{:else if files.length === 0}
					<div class="empty">
						<div class="big">🗂️</div>
						<h3>{query ? 'No matching files' : 'This set is empty'}</h3>
						<p>{query ? 'Try a different search term.' : 'Drop files above to upload them into this set.'}</p>
					</div>
				{:else}
					<div class="table-wrap">
						<table>
							<thead>
								<tr>
									<th>Name</th>
									<th>Size</th>
									<th>Visibility</th>
									<th>Downloads</th>
									<th>Uploaded</th>
									<th></th>
								</tr>
							</thead>
							<tbody>
								{#each files as file (file.id)}
									<tr>
										<td>
											<div class="file-name">
												<span class="file-icon">{icon(file.mimeType)}</span>
												<span class="grow">
													<button class="link-btn truncate file-title" type="button" onclick={() => previewFile(file)}>
														{file.name}
													</button>
													{#if file.publicUrl}
														<span class="faint mono truncate">/s/{file.setSlug}/{file.slug}</span>
													{:else}
														<span class="faint">private · API key required</span>
													{/if}
												</span>
											</div>
										</td>
										<td class="faint">{fmt(file.size)}</td>
										<td>
											<div class="visibility-cell">
												<button
													class="toggle-badge"
													type="button"
													title={file.isPublic ? 'Click to make private' : 'Click to make public'}
													onclick={() => togglePublic(file)}
													disabled={togglingId === file.id}
												>
													<span class="badge" class:public={file.isPublic} class:private={!file.isPublic}>
														{file.isPublic ? 'Public' : 'Private'}
													</span>
												</button>
												<button
													class="link-btn visibility-action"
													type="button"
													disabled={togglingId === file.id}
													onclick={() => togglePublic(file)}
												>
													{#if togglingId === file.id}
														Updating…
													{:else}
														{file.isPublic ? 'Make private' : 'Make public'}
													{/if}
												</button>
											</div>
										</td>
										<td class="faint">{file.downloads}</td>
										<td class="faint">{when(file.createdAt)}</td>
										<td>
											<div class="row actions">
												<button class="btn ghost sm" type="button" title="Download" onclick={() => triggerDownload(file)}>⤓</button>
												{#if file.publicUrl}
													<button class="btn ghost sm" type="button" title="Copy public link" onclick={() => copy(absolute(file.publicUrl))}>🔗</button>
												{/if}
												<button class="btn ghost sm" type="button" title="Share link" onclick={() => openShare(file)}>↗</button>
												<button class="btn ghost sm" type="button" title="Rename" onclick={() => openRename(file)}>✎</button>
												<button class="btn ghost sm" type="button" title="Delete" onclick={() => removeFile(file)}>🗑</button>
											</div>
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>

					<div class="pager">
						<span class="hint">{totalFiles} file{totalFiles === 1 ? '' : 's'} total</span>
						<div class="row">
							<button class="btn sm" type="button" disabled={page <= 1} onclick={() => { page -= 1; loadFiles(); }}>Previous</button>
							<span class="hint">Page {page} of {totalPages}</span>
							<button class="btn sm" type="button" disabled={page >= totalPages} onclick={() => { page += 1; loadFiles(); }}>Next</button>
						</div>
					</div>
				{/if}
			</div>
		{:else}
			<div class="empty welcome">
				<div class="big">📦</div>
				<h3>Welcome to {data.appName}</h3>
				<p>Sets are like buckets: create one, upload files, then share public links or use API keys for private access.</p>
				<button class="btn primary" type="button" onclick={openCreateSet}>Create your first set</button>
			</div>
		{/if}
	</main>
</div>

<!-- ------------------------------------------------------------------ modals -->
{#if modal === 'set'}
	<Modal title="New set" onclose={() => (modal = null)}>
		<form class="modal-form" onsubmit={createSet}>
			{#if formError}<div class="alert">{formError}</div>{/if}
			<label class="field">
				Set name
				<input type="text" bind:value={setForm.name} placeholder="e.g. Marketing assets" required maxlength="80" />
			</label>
			<label class="field">
				Description (optional)
				<textarea bind:value={setForm.description} maxlength="500" placeholder="What belongs in this set?"></textarea>
			</label>
			<label class="check">
				<input type="checkbox" bind:checked={setForm.isPublic} />
				<span>New uploads default to <strong>public</strong> — no API key needed to download</span>
			</label>
			<div class="actions">
				<button class="btn ghost" type="button" onclick={() => (modal = null)}>Cancel</button>
				<button class="btn primary" disabled={busy}>
					{#if busy}<span class="spinner"></span>{/if}Create set
				</button>
			</div>
		</form>
	</Modal>
{/if}

{#if modal === 'editSet' && activeSet}
	<Modal title="Set settings" onclose={() => (modal = null)}>
		<form class="modal-form" onsubmit={saveSet}>
			{#if formError}<div class="alert">{formError}</div>{/if}
			<label class="field">
				Set name
				<input type="text" bind:value={editForm.name} required maxlength="80" />
			</label>
			<label class="field">
				Description
				<textarea bind:value={editForm.description} maxlength="500"></textarea>
			</label>
			<label class="check">
				<input type="checkbox" bind:checked={editForm.isPublic} />
				<span>New uploads default to public</span>
			</label>
			<p class="hint">The set URL <code class="mono">/{activeSet.slug}</code> stays stable when renaming.</p>
			<div class="actions">
				<button class="btn ghost" type="button" onclick={() => (modal = null)}>Cancel</button>
				<button class="btn primary" disabled={busy}>
					{#if busy}<span class="spinner"></span>{/if}Save changes
				</button>
			</div>
		</form>
	</Modal>
{/if}

{#if modal === 'rename' && renameTarget}
	<Modal title="Rename file" onclose={() => (modal = null)}>
		<form class="modal-form" onsubmit={saveRename}>
			{#if formError}<div class="alert">{formError}</div>{/if}
			<label class="field">
				File name
				<input type="text" bind:value={renameValue} required maxlength="200" />
			</label>
			<p class="hint">The public URL keeps its current slug, so existing links stay valid.</p>
			<div class="actions">
				<button class="btn ghost" type="button" onclick={() => (modal = null)}>Cancel</button>
				<button class="btn primary" disabled={busy}>
					{#if busy}<span class="spinner"></span>{/if}Save
				</button>
			</div>
		</form>
	</Modal>
{/if}

{#if modal === 'share' && shareTarget}
	<Modal title={`Share "${shareTarget.name}"`} onclose={() => (modal = null)} wide>
		<div class="modal-form">
			{#if formError}<div class="alert">{formError}</div>{/if}
			<p class="hint">
				Share links work without an API key, even for private files. They expire or can be
				revoked at any time.
			</p>

			{#if freshShareUrl}
				<div>
					<div class="code-box">
						<code>{freshShareUrl}</code>
						<button class="btn sm" type="button" onclick={() => copy(freshShareUrl)}>Copy</button>
					</div>
					<p class="hint">Copy it now — the full link is shown only once.</p>
				</div>
			{/if}

			<div class="share-row">
				<label class="field grow">
					Link expiry
					<select bind:value={shareDays}>
						<option value="1">1 day</option>
						<option value="7">7 days</option>
						<option value="30">30 days</option>
						<option value="90">90 days</option>
						<option value="never">Never expires</option>
					</select>
				</label>
				<button class="btn primary" type="button" onclick={createShareLink} disabled={busy}>
					{#if busy}<span class="spinner"></span>{/if}Create link
				</button>
			</div>

			<hr class="divider" />

			<h3 class="section-title">Existing links</h3>
			{#if sharesList.length === 0}
				<p class="hint">No share links created yet.</p>
			{:else}
				<div class="list">
					{#each sharesList as share (share.id)}
						<div class="list-row">
							<div class="grow">
								<span class="mono">/share/{share.prefix}…</span>
								<span class="faint">
									{share.revokedAt
										? 'Revoked'
										: share.expiresAt
											? `Expires ${when(share.expiresAt)}`
											: 'Never expires'}
									· created {when(share.createdAt)}
								</span>
							</div>
							{#if share.revokedAt}
								<span class="badge private">revoked</span>
							{:else}
								<button class="btn danger sm" type="button" onclick={() => revokeShareLink(share)}>Revoke</button>
							{/if}
						</div>
					{/each}
				</div>
			{/if}
		</div>
	</Modal>
{/if}

{#if modal === 'keys'}
	<Modal title="API keys" onclose={() => (modal = null)} wide>
		<div class="modal-form">
			<p class="hint">
				Send a key as <code class="mono">x-api-key: fv_…</code> or <code class="mono">?api_key=fv_…</code>.
				Keys unlock your private files; public files need no key. Treat keys like passwords.
			</p>

			{#if freshKey}
				<div class="fresh-key">
					<div class="row" style="justify-content: space-between">
						<strong>{freshKey.name}</strong>
						<span class="badge public">new key</span>
					</div>
					<div class="code-box">
						<code>{freshKey.key}</code>
						<button class="btn sm" type="button" onclick={() => copy(freshKey.key)}>Copy</button>
					</div>
					<p class="hint">This key is shown once. Store it somewhere safe.</p>
				</div>
			{/if}

			<form class="share-row" onsubmit={createKey}>
				<label class="field grow">
					New key name
					<input type="text" bind:value={keyName} maxlength="60" placeholder="e.g. CI pipeline" />
				</label>
				<button class="btn primary" disabled={busy}>
					{#if busy}<span class="spinner"></span>{/if}Create key
				</button>
			</form>
			{#if formError}<p class="error-text">{formError}</p>{/if}

			{#if isSuper}
				<label class="check">
					<input type="checkbox" checked={showAllKeys} onchange={toggleAllKeys} />
					<span>Show API keys for all users</span>
				</label>
			{/if}

			<div class="list">
				{#each keys as key (key.id)}
					<div class="list-row" class:dimmed={key.revokedAt}>
						<div class="grow">
							<span>
								<strong>{key.name}</strong>
								{#if isSuper && showAllKeys}
									<span class="badge owner">@{key.ownerUsername}</span>
								{/if}
							</span>
							<span class="faint mono">{key.prefix}…</span>
							<span class="faint">
								Created {when(key.createdAt)} · last used {key.lastUsedAt ? when(key.lastUsedAt) : 'never'}
							</span>
						</div>
						{#if key.revokedAt}
							<span class="badge private">revoked</span>
						{:else}
							<button class="btn danger sm" type="button" onclick={() => revokeKeyItem(key)}>Revoke</button>
						{/if}
					</div>
				{:else}
					<p class="hint">No API keys yet.</p>
				{/each}
			</div>
		</div>
	</Modal>
{/if}

{#if modal === 'users'}
	<Modal title="Users" onclose={() => (modal = null)} wide>
		<div class="modal-form">
			<p class="hint">
				Only the super admin can create users. Deleting a user transfers their sets and files to
				you and revokes their API keys.
			</p>

			<form class="user-create" onsubmit={createUser}>
				<label class="field">
					Full name
					<input type="text" bind:value={userForm.name} required maxlength="80" placeholder="Jane Doe" />
				</label>
				<label class="field">
					Username
					<input type="text" bind:value={userForm.username} required minlength="3" maxlength="32" pattern="[a-zA-Z0-9_.-]+" placeholder="jane" />
				</label>
				<label class="field">
					Password
					<input type="password" bind:value={userForm.password} required minlength="8" placeholder="Min. 8 characters" />
				</label>
				<label class="field">
					Quota (MB)
					<input type="number" min="0" bind:value={userForm.quotaMB} placeholder="1024" />
				</label>
				<button class="btn primary" disabled={busy}>
					{#if busy}<span class="spinner"></span>{/if}Create user
				</button>
			</form>
			{#if formError}<p class="error-text">{formError}</p>{/if}

			<hr class="divider" />

			<div class="list">
				{#each users as user (user.id)}
					<div class="user-row">
						<div class="user-main">
							<div class="row">
								<strong>{user.name}</strong>
								<span class="badge" class:admin={user.role === 'superadmin'}>{user.role}</span>
							</div>
							<span class="faint">
								@{user.username} · {subtitleCount(user.usage.fileCount)} · {fmt(user.usage.usedBytes)} used{#if user.quotaBytes != null} of {fmt(user.quotaBytes)}{:else} (unlimited){/if}
							</span>
						</div>

						{#if editingUser && editingUser.id === user.id}
							<form class="user-edit" onsubmit={saveEditUser}>
								<input type="text" bind:value={editingUser.name} required maxlength="80" placeholder="Name" />
								<input type="number" min="0" bind:value={editingUser.quotaMB} placeholder="Quota MB (blank = unlimited)" />
								<button class="btn primary sm">Save</button>
								<button class="btn ghost sm" type="button" onclick={() => (editingUser = null)}>Cancel</button>
							</form>
						{:else if user.role === 'superadmin'}
							<span class="badge private">you</span>
						{:else}
							<div class="row user-actions">
								<button class="btn sm" type="button" onclick={() => startEditUser(user)}>Edit</button>
								<button class="btn sm" type="button" onclick={() => resetUserPassword(user)}>Reset password</button>
								<button class="btn danger sm" type="button" onclick={() => removeUser(user)}>Delete</button>
							</div>
						{/if}
					</div>
				{:else}
					<p class="hint">No users found.</p>
				{/each}
			</div>
		</div>
	</Modal>
{/if}

{#if modal === 'password'}
	<Modal title="Change password" onclose={() => (modal = null)}>
		<form class="modal-form" onsubmit={changePassword}>
			{#if formError}<div class="alert">{formError}</div>{/if}
			<label class="field">
				Current password
				<input type="password" bind:value={pwForm.current} required autocomplete="current-password" />
			</label>
			<div class="grid-2">
				<label class="field">
					New password
					<input type="password" bind:value={pwForm.next} required minlength="8" autocomplete="new-password" />
				</label>
				<label class="field">
					Confirm new password
					<input type="password" bind:value={pwForm.confirm} required minlength="8" autocomplete="new-password" />
				</label>
			</div>
			<div class="actions">
				<button class="btn ghost" type="button" onclick={() => (modal = null)}>Cancel</button>
				<button class="btn primary" disabled={busy}>
					{#if busy}<span class="spinner"></span>{/if}Update password
				</button>
			</div>
		</form>
	</Modal>
{/if}

{#if toast}
	<div class="toast" class:error={toast.type === 'error'} transition:fly={{ y: 18, duration: 180 }} role="status">
		<span class="grow">{toast.message}</span>
		<button class="btn ghost sm" type="button" onclick={() => (toast = null)}>✕</button>
	</div>
{/if}

<style>
	.topbar {
		position: sticky;
		top: 0;
		z-index: 30;
		display: flex;
		align-items: center;
		gap: 1rem;
		padding: 0.7rem 1.5rem;
		background: rgba(7, 11, 18, 0.82);
		backdrop-filter: blur(16px);
		border-bottom: 1px solid var(--border);
	}
	.brand {
		display: flex;
		align-items: center;
		gap: 0.65rem;
		font-weight: 750;
		letter-spacing: -0.02em;
		font-size: 0.98rem;
	}
	.brand small {
		display: block;
		font-size: 0.62rem;
		color: var(--faint);
		font-weight: 600;
		letter-spacing: 0.12em;
		text-transform: uppercase;
	}
	.logo {
		width: 36px;
		height: 36px;
		border-radius: 10px;
		display: grid;
		place-items: center;
		background: linear-gradient(135deg, var(--accent), #06b6d4);
		color: #fff;
		font-size: 1.1rem;
		box-shadow: 0 6px 18px rgba(99, 102, 241, 0.35);
	}
	.top-actions {
		margin-left: auto;
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 0.35rem;
		flex-wrap: wrap;
	}
	.usage {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.74rem;
		margin-right: 0.4rem;
	}
	.meter {
		width: 88px;
		height: 6px;
		border-radius: 99px;
		background: #1e293b;
		overflow: hidden;
	}
	.meter span {
		display: block;
		height: 100%;
		border-radius: 99px;
		background: linear-gradient(90deg, #6366f1, #22d3ee);
	}
	.userchip {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.25rem 0.55rem 0.25rem 0.3rem;
		border: 1px solid var(--border);
		border-radius: 12px;
		background: rgba(15, 23, 42, 0.5);
	}
	.avatar {
		width: 29px;
		height: 29px;
		border-radius: 9px;
		display: grid;
		place-items: center;
		background: linear-gradient(135deg, #6366f1, #06b6d4);
		font-size: 0.78rem;
		font-weight: 750;
		color: #fff;
	}
	.userinfo {
		display: flex;
		flex-direction: column;
		line-height: 1.15;
		font-size: 0.78rem;
	}
	.userinfo .faint {
		font-size: 0.7rem;
	}

	.shell {
		display: grid;
		grid-template-columns: 290px minmax(0, 1fr);
		gap: 1.35rem;
		padding: 1.25rem 1.5rem 3rem;
		max-width: 1600px;
		margin: 0 auto;
		align-items: start;
	}
	.sidebar {
		position: sticky;
		top: 78px;
		display: flex;
		flex-direction: column;
		gap: 0.8rem;
		max-height: calc(100vh - 100px);
	}
	.sidebar-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.15rem 0.2rem;
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.09em;
		color: var(--faint);
		font-weight: 700;
	}
	.set-list {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		overflow-y: auto;
		padding-right: 2px;
	}
	.set-item {
		display: flex;
		gap: 0.65rem;
		align-items: flex-start;
		text-align: left;
		width: 100%;
		padding: 0.6rem 0.65rem;
		border-radius: 11px;
		border: 1px solid transparent;
		background: transparent;
		color: var(--text);
		cursor: pointer;
		transition:
			background 0.15s ease,
			border-color 0.15s ease;
	}
	.set-item:hover {
		background: rgba(255, 255, 255, 0.04);
	}
	.set-item.active {
		background: linear-gradient(135deg, rgba(99, 102, 241, 0.16), rgba(6, 182, 212, 0.08));
		border-color: rgba(99, 102, 241, 0.35);
	}
	.set-icon {
		flex: none;
		width: 32px;
		height: 32px;
		border-radius: 9px;
		background: #0b1220;
		border: 1px solid var(--border);
		display: grid;
		place-items: center;
		color: #a5b4fc;
		font-size: 0.9rem;
	}
	.set-meta {
		display: flex;
		flex-direction: column;
		gap: 0.08rem;
		min-width: 0;
		flex: 1;
	}
	.set-name {
		font-weight: 650;
		font-size: 0.87rem;
	}
	.set-meta .faint {
		font-size: 0.7rem;
	}
	.set-meta .badge {
		align-self: flex-start;
		margin-top: 0.2rem;
	}
	.sidebar-empty {
		padding: 0.5rem 0.25rem;
	}
	.sidebar-foot {
		margin-top: auto;
		display: grid;
		gap: 0.55rem;
	}
	.usage-card {
		background: rgba(15, 23, 42, 0.7);
		border: 1px solid var(--border);
		border-radius: 12px;
		padding: 0.75rem;
		display: grid;
		gap: 0.45rem;
		font-size: 0.75rem;
	}
	.main {
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	.set-head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.3rem 0.2rem 0;
		flex-wrap: wrap;
	}
	.set-head h1 {
		font-size: 1.5rem;
	}
	.set-head p {
		font-size: 0.84rem;
		margin-top: 0.15rem;
	}
	.set-head .badge {
		align-self: center;
	}
	.upload-zone {
		border: 1px dashed #334155;
		border-radius: var(--radius);
		background: rgba(15, 23, 42, 0.5);
		padding: 1rem 1.1rem;
		display: flex;
		flex-direction: column;
		gap: 0.65rem;
		transition:
			border-color 0.15s ease,
			background 0.15s ease;
	}
	.upload-zone.dragover {
		border-color: var(--accent);
		background: var(--accent-soft);
	}
	.upload-row {
		display: flex;
		align-items: center;
		gap: 0.7rem;
		font-size: 0.9rem;
		flex-wrap: wrap;
	}
	.upload-icon {
		width: 34px;
		height: 34px;
		border-radius: 10px;
		display: grid;
		place-items: center;
		background: var(--accent-soft);
		color: #c7d2fe;
		font-size: 1rem;
		font-weight: 700;
	}
	.upload-row strong {
		color: var(--text);
	}
	.upload-row .muted {
		margin: 0 0.25rem;
	}
	.upload-foot {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		flex-wrap: wrap;
	}
	.link-btn {
		background: none;
		border: 0;
		padding: 0;
		color: #a5b4fc;
		font: inherit;
		cursor: pointer;
		text-align: left;
	}
	.link-btn:hover {
		text-decoration: underline;
	}
	.toolbar {
		display: flex;
		gap: 0.6rem;
		align-items: center;
	}
	.toolbar input {
		flex: 1;
		max-width: 380px;
	}
	.file-card {
		overflow: hidden;
	}
	.table-wrap {
		overflow-x: auto;
	}
	.file-name {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		min-width: 220px;
	}
	.file-icon {
		width: 32px;
		height: 32px;
		border-radius: 8px;
		background: #0b1220;
		border: 1px solid var(--border);
		display: grid;
		place-items: center;
		flex: none;
	}
	.file-name .grow {
		display: flex;
		flex-direction: column;
		gap: 0.05rem;
		min-width: 0;
	}
	.file-title {
		max-width: 380px;
		font-weight: 550;
		color: var(--text);
	}
	.file-name .faint {
		font-size: 0.68rem;
		max-width: 340px;
	}
	.actions {
		justify-content: flex-end;
		gap: 0.1rem;
	}
	.visibility-cell {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.3rem;
	}
	.toggle-badge {
		background: none;
		border: 0;
		padding: 0;
		cursor: pointer;
	}
	.toggle-badge:disabled {
		opacity: 0.6;
		cursor: wait;
	}
	.visibility-action {
		font-size: 0.72rem;
		font-weight: 600;
		white-space: nowrap;
	}
	.visibility-action:disabled {
		opacity: 0.6;
		cursor: wait;
		text-decoration: none;
	}
	.pager {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.75rem;
		padding: 0.7rem 0.9rem;
		border-top: 1px solid var(--border);
		flex-wrap: wrap;
	}
	.welcome {
		min-height: 55vh;
		gap: 0.75rem;
	}
	.modal-form {
		display: grid;
		gap: 1rem;
	}
	.share-row {
		display: flex;
		align-items: flex-end;
		gap: 0.6rem;
		flex-wrap: wrap;
	}
	.share-row .grow {
		flex: 1;
		min-width: 180px;
	}
	.section-title {
		font-size: 0.95rem;
	}
	.list {
		display: grid;
		gap: 0.4rem;
	}
	.list-row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.65rem 0.75rem;
		background: rgba(255, 255, 255, 0.02);
		border: 1px solid var(--border);
		border-radius: 10px;
		flex-wrap: wrap;
	}
	.list-row .grow {
		display: flex;
		flex-direction: column;
		gap: 0.08rem;
		font-size: 0.85rem;
	}
	.list-row.dimmed {
		opacity: 0.55;
	}
	.code-box {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		background: #070d18;
		border: 1px solid var(--border);
		border-radius: 9px;
		padding: 0.55rem 0.65rem;
		word-break: break-all;
	}
	.code-box code {
		flex: 1;
		font-family: ui-monospace, 'Cascadia Code', Consolas, monospace;
		font-size: 0.76rem;
	}
	.fresh-key {
		display: grid;
		gap: 0.5rem;
		padding: 0.8rem;
		border: 1px solid rgba(52, 211, 153, 0.35);
		background: rgba(16, 185, 129, 0.06);
		border-radius: 12px;
	}
	.user-create {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr)) auto;
		gap: 0.6rem;
		align-items: end;
	}
	.user-row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.65rem 0.75rem;
		background: rgba(255, 255, 255, 0.02);
		border: 1px solid var(--border);
		border-radius: 10px;
		flex-wrap: wrap;
	}
	.user-main {
		display: flex;
		flex-direction: column;
		gap: 0.12rem;
		font-size: 0.86rem;
		min-width: 220px;
		flex: 1;
	}
	.user-main .faint {
		font-size: 0.72rem;
	}
	.user-edit {
		display: flex;
		gap: 0.4rem;
		align-items: center;
		flex-wrap: wrap;
	}
	.user-edit input[type='text'] {
		width: 130px;
	}
	.user-edit input[type='number'] {
		width: 180px;
	}
	.user-actions {
		gap: 0.3rem;
	}
	.toast {
		position: fixed;
		bottom: 1.25rem;
		right: 1.25rem;
		z-index: 100;
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.75rem 1rem;
		border-radius: 12px;
		background: #0f172a;
		border: 1px solid #334155;
		box-shadow: var(--shadow);
		font-size: 0.87rem;
		max-width: min(440px, calc(100vw - 2rem));
	}
	.toast.error {
		border-color: #7f1d1d;
		background: #1a0d0d;
		color: #fecaca;
	}
	.grid-2 {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.8rem;
	}

	@media (max-width: 1100px) {
		.user-create {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
		.user-create .btn {
			grid-column: span 2;
		}
	}
	@media (max-width: 980px) {
		.shell {
			grid-template-columns: 1fr;
		}
		.sidebar {
			position: static;
			max-height: none;
		}
		.set-list {
			flex-direction: row;
			overflow-x: auto;
			padding-bottom: 0.25rem;
		}
		.set-item {
			min-width: 215px;
		}
		.sidebar-foot {
			display: none;
		}
		.userinfo {
			display: none;
		}
	}
	@media (max-width: 700px) {
		.topbar {
			padding: 0.6rem 0.8rem;
		}
		.shell {
			padding: 0.9rem 0.8rem 2rem;
		}
		.usage {
			display: none;
		}
		.set-head {
			flex-direction: column;
		}
		.toolbar {
			flex-wrap: wrap;
		}
		.toolbar input {
			max-width: none;
		}
		.grid-2 {
			grid-template-columns: 1fr;
		}
		.user-create {
			grid-template-columns: 1fr;
		}
		.user-create .btn {
			grid-column: span 1;
		}
	}
</style>
