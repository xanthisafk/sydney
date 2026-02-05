/**
 * Sydney Media Service - Response Utilities
 * Security-first response helpers that prevent information leakage.
 */

const NOT_FOUND_BODY = JSON.stringify({ error: 'Not found' });

/**
 * Return a 404 response. Used for ALL error conditions to prevent
 * information leakage about existence of resources or auth status.
 */
export function notFound(): Response {
	return new Response(NOT_FOUND_BODY, {
		status: 404,
		headers: { 'Content-Type': 'application/json' },
	});
}

/**
 * Return a JSON response with the given status code.
 */
export function jsonResponse<T>(data: T, status = 200): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}

/**
 * Return a JSON error response. In production, all errors should use notFound()
 * instead to prevent information leakage. This is useful for development.
 */
export function errorResponse(message: string, status = 400): Response {
	return new Response(JSON.stringify({ error: message }), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}
