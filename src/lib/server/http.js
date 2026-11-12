/**
 * Small helpers for JSON API responses in SvelteKit endpoints.
 */

export class ApiError extends Error {
	constructor(status, message, extra = {}) {
		super(message);
		this.status = status;
		this.extra = extra;
	}
}

export function ok(data, status = 200) {
	return new Response(JSON.stringify(data), {
		status,
		headers: { 'content-type': 'application/json; charset=utf-8' }
	});
}

/** Wraps an endpoint handler and turns ApiError / unexpected errors into JSON. */
export function api(handler) {
	return async (event) => {
		try {
			return await handler(event);
		} catch (err) {
			if (err instanceof ApiError) {
				return ok({ error: err.message, ...err.extra }, err.status);
			}
			console.error('[api]', err);
			return ok({ error: 'Internal server error.' }, 500);
		}
	};
}

export async function readJson(request) {
	try {
		const body = await request.json();
		if (!body || typeof body !== 'object') throw new Error('not an object');
		return body;
	} catch {
		throw new ApiError(400, 'Invalid JSON body.');
	}
}

export async function readJsonOptional(request) {
	try {
		const body = await request.json();
		return body && typeof body === 'object' ? body : {};
	} catch {
		return {};
	}
}
