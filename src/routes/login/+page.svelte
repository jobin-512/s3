<script>
	import AuthCard from '$lib/components/AuthCard.svelte';
	import { goto } from '$app/navigation';

	let { data } = $props();
	let username = $state('');
	let password = $state('');
	let error = $state('');
	let busy = $state(false);

	async function submit(event) {
		event.preventDefault();
		error = '';
		busy = true;
		try {
			const res = await fetch('/api/auth/login', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ username, password })
			});
			const payload = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(payload.error || 'Login failed.');
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
	title="Sign in"
	subtitle="Use the account created for you by the super admin."
>
	<form class="stack" onsubmit={submit}>
		{#if error}<div class="alert">{error}</div>{/if}

		<label class="field">
			Username
			<input
				type="text"
				bind:value={username}
				placeholder="your-username"
				required
				autocomplete="username"
			/>
		</label>

		<label class="field">
			Password
			<input
				type="password"
				bind:value={password}
				placeholder="Your password"
				required
				autocomplete="current-password"
			/>
		</label>

		<button class="btn primary block" disabled={busy}>
			{#if busy}<span class="spinner"></span> Signing in…{:else}Sign in{/if}
		</button>
	</form>
</AuthCard>
