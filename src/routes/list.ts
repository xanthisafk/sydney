/**
 * Sydney Media Service - List Route Handlers (Admin Only)
 * Paginated list of all media and individual metadata lookup.
 */

import type { Env, MediaRecord, MediaListItem, ListMediaResponse } from '../types';
import { jsonResponse, notFound } from '../lib/response';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/**
 * GET /list/
 * Paginated list of all media with minimal metadata.
 */
export async function handleListMedia(
	request: Request,
	env: Env
): Promise<Response> {
	const url = new URL(request.url);
	
	// Parse pagination params
	let page = parseInt(url.searchParams.get('page') || '1', 10);
	let limit = parseInt(url.searchParams.get('limit') || String(DEFAULT_LIMIT), 10);

	// Validate and clamp
	if (isNaN(page) || page < 1) page = 1;
	if (isNaN(limit) || limit < 1) limit = DEFAULT_LIMIT;
	if (limit > MAX_LIMIT) limit = MAX_LIMIT;

	const offset = (page - 1) * limit;

	// Get total count
	const countResult = await env.DB.prepare(`
		SELECT COUNT(*) as count FROM media
	`).first<{ count: number }>();

	const total = countResult?.count || 0;

	// Get paginated items
	const result = await env.DB.prepare(`
		SELECT id, filename, content_type, total_bytes, status, created_at
		FROM media
		ORDER BY created_at DESC
		LIMIT ? OFFSET ?
	`).bind(limit, offset).all<MediaListItem>();

	const response: ListMediaResponse = {
		items: result.results || [],
		page,
		limit,
		total,
	};

	return jsonResponse(response);
}

/**
 * GET /list/:id
 * Full metadata for a single media item.
 */
export async function handleGetMediaDetails(
	request: Request,
	env: Env,
	id: string
): Promise<Response> {
	const record = await env.DB.prepare(`
		SELECT * FROM media WHERE id = ?
	`).bind(id).first<MediaRecord>();

	if (!record) {
		return notFound();
	}

	return jsonResponse(record);
}
