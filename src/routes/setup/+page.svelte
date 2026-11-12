<script>
	import AuthCard from '$lib/components/AuthCard.svelte';
	import { goto } from '$app/navigation';

	let { data } = $props();
	let name = $state('');
	let username = $state('');
	let password = $state('');
	let confirm = $state('');
	let error = $state('');
	let busy = $state(false);

	async function submit(event) {
		event.preventDefault();
		error = '';
		if (password !== confirm) {
			error = 'Passwords do not match.';
			return;
		}
		if (password.length < 8) {
			error = 'Password must be at least 8 characters.';
			return;
		}
		busy = true;
		try {
			const res = await fetch('/api/setup', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ name, username, password })
			});
			const payload = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(payload.error || 'Setup failed.');
			await goto('/app');
		} catch (err) {
			error = err.message;
		} finally {
			busy = false;
		}
	}
</script>

<AuthCard
	appName={data.appName}
	title="Create the super admin"
	subtitle="Welcome! This is the first run, so create the account that will manage users, sets and files."
>
	<form class="stack" onsubmit={submit}>
		{#if error}<div class="alert">{error}</div>{/if}

		<label class="field">
			Full name
			<input
				type="text"
				bind:value={name}
				placeholder="Jane Doe"
				required
				maxlength="80"
				autocomplete="name"
			/>
		</label>

		<label class="field">
			Username
			<input
				type="text"
				bind:value={username}
				placeholder="admin"
				required
				minlength="3"
				maxlength="32"
				pattern="[a-zA-Z0-9_.-]+"
				autocomplete="username"
			/>
		</label>

		<div class="grid-2">
			<label class="field">
				Password
				<input
					type="password"
					bind:value={password}
					placeholder="Min. 8 characters"
					required
					minlength="8"
					autocomplete="new-password"
				/>
			</label>
			<label class="field">
				Confirm password
				<input
					type="password"
					bind:value={confirm}
					placeholder="Repeat password"
					required
					minlength="8"
					autocomplete="new-password"
				/>
			</label>
		</div>

		<p class="hint">After this step, only this super admin can create new users.</p>

		<button class="btn primary block" disabled={busy}>
			{#if busy}<span class="spinner"></span> Creating account…{:else}Create super admin{/if}
		</button>
	</form>
</AuthCard>

<style>
	.grid-2 {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.8rem;
	}
	@media (max-width: 520px) {
		.grid-2 {
			grid-template-columns: 1fr;
		}
	}
</style>
