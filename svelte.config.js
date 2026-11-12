import adapter from '@sveltejs/adapter-node';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: {
		adapter: adapter(),
		csrf: {
			// The API is consumed by external scripts/apps using API keys. Cookie
			// sessions are same-origin only in practice (SameSite=Lax), and mutating
			// API calls are JSON with an explicit Authorization/key header.
			trustedOrigins: ['*']
		}
	}
};

export default config;
