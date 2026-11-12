<script>
	let { appName = 'FileVault', title, subtitle, children } = $props();
</script>

<div class="auth-page">
	<div class="auth-card card">
		<div class="brand">
			<span class="logo">◧</span>
			<span>{appName}</span>
		</div>
		<h1>{title}</h1>
		{#if subtitle}<p class="sub">{subtitle}</p>{/if}
		{@render children()}
		<p class="auth-foot faint">Self-hosted S3-style file storage</p>
	</div>
</div>

<style>
	.auth-page {
		min-height: 100vh;
		display: grid;
		place-items: center;
		padding: 2rem 1rem;
	}
	.auth-card {
		width: min(460px, 100%);
		padding: 2.1rem;
		box-shadow: var(--shadow);
		background: linear-gradient(180deg, rgba(17, 26, 45, 0.95), rgba(10, 16, 29, 0.98));
	}
	.brand {
		display: flex;
		align-items: center;
		gap: 0.65rem;
		margin-bottom: 1.7rem;
		font-weight: 750;
		letter-spacing: -0.02em;
		font-size: 1.02rem;
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
	h1 {
		font-size: 1.4rem;
		margin-bottom: 0.35rem;
	}
	.sub {
		color: var(--muted);
		font-size: 0.88rem;
		margin-bottom: 1.5rem;
	}
	.auth-foot {
		margin-top: 1.6rem;
		text-align: center;
		font-size: 0.72rem;
		letter-spacing: 0.03em;
	}
</style>
