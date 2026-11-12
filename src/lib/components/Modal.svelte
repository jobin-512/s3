<script>
	let { title = '', onclose = () => {}, wide = false, children } = $props();

	function onkeydown(event) {
		if (event.key === 'Escape') onclose();
	}

	$effect(() => {
		const previous = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
		return () => {
			document.body.style.overflow = previous;
		};
	});
</script>

<svelte:window onkeydown={onkeydown} />

<div
	class="overlay"
	role="presentation"
	onclick={(event) => {
		if (event.target === event.currentTarget) onclose();
	}}
>
	<div class="modal" class:wide role="dialog" aria-modal="true" aria-label={title}>
		<header>
			<h2>{title}</h2>
			<button class="close" type="button" onclick={onclose} aria-label="Close">✕</button>
		</header>
		<div class="content">
			{@render children()}
		</div>
	</div>
</div>

<style>
	.overlay {
		position: fixed;
		inset: 0;
		z-index: 60;
		display: grid;
		place-items: center;
		padding: 1.25rem;
		background: rgba(3, 7, 14, 0.72);
		backdrop-filter: blur(6px);
		animation: fade 0.15s ease;
	}
	.modal {
		width: min(540px, 100%);
		max-height: min(88vh, 900px);
		display: flex;
		flex-direction: column;
		background: linear-gradient(180deg, #111a2d, #0a101d);
		border: 1px solid var(--border-strong);
		border-radius: 16px;
		box-shadow: var(--shadow);
		animation: pop 0.18s ease;
	}
	.modal.wide {
		width: min(880px, 100%);
	}
	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 1.05rem 1.25rem;
		border-bottom: 1px solid var(--border);
	}
	h2 {
		font-size: 1.02rem;
		letter-spacing: -0.01em;
	}
	.close {
		width: 30px;
		height: 30px;
		border-radius: 8px;
		border: 1px solid transparent;
		background: transparent;
		color: var(--muted);
		cursor: pointer;
		font-size: 0.85rem;
	}
	.close:hover {
		background: rgba(255, 255, 255, 0.06);
		color: var(--text);
	}
	.content {
		padding: 1.25rem;
		overflow-y: auto;
	}
	@keyframes fade {
		from {
			opacity: 0;
		}
	}
	@keyframes pop {
		from {
			opacity: 0;
			transform: translateY(8px) scale(0.99);
		}
	}
</style>
