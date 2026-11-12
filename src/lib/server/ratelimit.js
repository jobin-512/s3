/**
 * Minimal in-memory rate limiter (per process). Good enough for login/setup
 * brute-force protection on a single-instance deployment.
 */
const buckets = new Map();

export function rateLimit(key, { windowMs = 15 * 60 * 1000, limit = 20 } = {}) {
	const current = Date.now();
	let bucket = buckets.get(key);
	if (!bucket || current > bucket.resetAt) {
		bucket = { count: 0, resetAt: current + windowMs };
		buckets.set(key, bucket);
	}
	bucket.count += 1;
	if (bucket.count > limit) {
		return { ok: false, retryAfter: Math.ceil((bucket.resetAt - current) / 1000) };
	}
	return { ok: true, remaining: limit - bucket.count };
}

// Opportunistic cleanup so the map cannot grow forever.
setInterval(() => {
	const current = Date.now();
	for (const [k, b] of buckets) if (current > b.resetAt) buckets.delete(k);
}, 10 * 60 * 1000).unref?.();
