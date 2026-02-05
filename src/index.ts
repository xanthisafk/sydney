/**
 * Sydney Media Service - Main Router
 * Minimal streaming media service on Cloudflare Workers.
 * 
 * Hard constraints:
 * - Never buffer uploads/downloads
 * - Never encode/transcode
 * - CPU < 10ms
 * - All errors → 404
 */

import type { Env } from './types';
import { verifyAuth } from './lib/auth';
import { notFound } from './lib/response';
import { handleUploadInit, handleUploadConfirm } from './routes/upload';
import { handleGetMedia, handleDeleteMedia } from './routes/media';
import { handleListMedia, handleGetMediaDetails } from './routes/list';

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		try {
			return await handleRequest(request, env, ctx);
		} catch {
			// All errors return 404 to prevent information leakage
			return notFound();
		}
	},
} satisfies ExportedHandler<Env>;

async function handleRequest(
	request: Request,
	env: Env,
	ctx: ExecutionContext
): Promise<Response> {
	const url = new URL(request.url);
	const path = url.pathname;
	const method = request.method;

	// Route: GET /media/:id (PUBLIC - no auth required)
	const mediaGetMatch = path.match(/^\/media\/([a-f0-9-]{36})$/);
	if (method === 'GET' && mediaGetMatch) {
		const id = mediaGetMatch[1];
		return handleGetMedia(request, env, ctx, id);
	}

	// All other routes require authentication
	const isAuthenticated = await verifyAuth(request, env);
	if (!isAuthenticated) {
		return notFound();
	}

	// Route: POST /upload/new
	if (method === 'POST' && path === '/upload/new') {
		return handleUploadInit(request, env);
	}

	// Route: POST /upload/confirm
	if (method === 'POST' && path === '/upload/confirm') {
		return handleUploadConfirm(request, env);
	}

	// Route: DELETE /media/:id
	const mediaDeleteMatch = path.match(/^\/media\/([a-f0-9-]{36})$/);
	if (method === 'DELETE' && mediaDeleteMatch) {
		const id = mediaDeleteMatch[1];
		return handleDeleteMedia(request, env, id);
	}

	// Route: GET /list/ (admin)
	if (method === 'GET' && (path === '/list' || path === '/list/')) {
		return handleListMedia(request, env);
	}

	// Route: GET /list/:id (admin)
	const listDetailMatch = path.match(/^\/list\/([a-f0-9-]{36})$/);
	if (method === 'GET' && listDetailMatch) {
		const id = listDetailMatch[1];
		return handleGetMediaDetails(request, env, id);
	}

	// No matching route
	return new Response(JSON.stringify({
		error: 'Route not found',
		path: path,
		method: method,
		availableRoutes: [
			'POST /upload/new',
			'POST /upload/confirm',
			'GET /media/:id',
			'DELETE /media/:id',
			'GET /list/'
		]
	}), {
		status: 404,
		headers: { 'Content-Type': 'application/json' }
	});
}
