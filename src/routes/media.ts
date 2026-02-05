/**
 * Sydney Media Service - Media Route Handlers
 * Handles streaming media delivery and deletion.
 * Uses Cloudflare Cache API to avoid repeated B2 signed URL requests.
 */

import type { Env, MediaRecord } from '../types';
import { createPresignedDeleteUrl, createPresignedGetUrl } from '../lib/presign';
import { notFound } from '../lib/response';

// Maximum bytes per range request (50MB)
const MAX_RANGE_BYTES = 50 * 1024 * 1024;

// Cache TTL: 30 days in seconds
const CACHE_TTL = 30 * 24 * 60 * 60;

/**
 * GET /media/:id
 * Stream media directly from B2 with Range header support.
 * Uses Cloudflare Cache API to cache responses and avoid repeated B2 requests.
 */
export async function handleGetMedia(
	request: Request,
	env: Env,
	ctx: ExecutionContext, // Added for waitUntil
	id: string
): Promise<Response> {
	// Lookup record in D1
	const record = await env.DB.prepare(`
		SELECT * FROM media WHERE id = ? AND status = 'complete'
	`).bind(id).first<MediaRecord>();

	if (!record) {
		return notFound();
	}

	// Parse Range header
	const rangeHeader = request.headers.get('Range');
	let parsedRange: { start: number; end: number } | null = null;

	if (rangeHeader) {
		parsedRange = parseRangeHeader(rangeHeader, record.total_bytes);
		if (!parsedRange) {
			// Invalid or multi-range request
			return notFound();
		}
	}

	// Create a cache key based on media ID and range (not the signed URL)
	const cacheKeyUrl = new URL(request.url);
	cacheKeyUrl.search = ''; // Remove query params from cache key
	if (parsedRange) {
		cacheKeyUrl.searchParams.set('range', `${parsedRange.start}-${parsedRange.end}`);
	}
	const cacheKey = new Request(cacheKeyUrl.toString(), {
		method: 'GET',
	});

	// Try to get from Cloudflare Cache
	const cache = caches.default;
	let response = await cache.match(cacheKey);

	if (response) {
		// Cache HIT - return cached response with HIT header
		const newHeaders = new Headers(response.headers);
		newHeaders.set('X-Worker-Cache', 'HIT');
		return new Response(response.body, {
			status: response.status,
			statusText: response.statusText,
			headers: newHeaders
		});
	}

	// Cache MISS - fetch from B2 with presigned URL
	const objectUrl = await createPresignedGetUrl(env, record.object_key);

	// Create fetch headers
	const fetchHeaders = new Headers();
	if (parsedRange) {
		fetchHeaders.set('Range', `bytes=${parsedRange.start}-${parsedRange.end}`);
	}

	// Fetch from B2 - this returns a ReadableStream
	let upstreamResponse: Response;
	try {
		upstreamResponse = await fetch(objectUrl, {
			method: 'GET',
			headers: fetchHeaders,
		});
	} catch {
		return notFound();
	}

	if (!upstreamResponse.ok && upstreamResponse.status !== 206) {
		return notFound();
	}

	// Build response headers
	const responseHeaders = new Headers();
	responseHeaders.set('Content-Type', record.content_type);
	responseHeaders.set('Accept-Ranges', 'bytes');

	// Copy relevant headers from upstream
	const contentLength = upstreamResponse.headers.get('Content-Length');
	if (contentLength) {
		responseHeaders.set('Content-Length', contentLength);
	}

	const contentRange = upstreamResponse.headers.get('Content-Range');
	if (contentRange) {
		responseHeaders.set('Content-Range', contentRange);
	}

	// Cache headers - tell browsers and CDN to cache aggressively
	responseHeaders.set('Cache-Control', `public, max-age=${CACHE_TTL}, immutable`);

	// Create the response to store in cache
	// We do NOT add X-Worker-Cache here so the cached version is "pure"
	response = new Response(upstreamResponse.body, {
		status: upstreamResponse.status,
		headers: responseHeaders,
	});

	// Clone and store in Cloudflare Cache
	const responseToCache = response.clone();
	ctx.waitUntil(cache.put(cacheKey, responseToCache));

	// Return response with MISS header
	const missHeaders = new Headers(response.headers);
	missHeaders.set('X-Worker-Cache', 'MISS');
	
	// We already read the body for cloning? No, Request/Response cloning works with streams if done correctly.
	// But response.clone() works. 
	// To return a modified header version, we need another new Response or clone.
	// Since we already used `response` for `responseToCache` (clone 1), we can use `response` body if we haven't read it?
	// Actually, `response` body is used by `responseToCache`? No, `response.clone()` splits the stream.
	// So `response` is still usable.
	
	return new Response(response.body, {
		status: response.status,
		headers: missHeaders
	});
}

/**
 * DELETE /media/:id
 * Delete media from B2 and D1.
 * Also purges the cache for this media ID.
 */
export async function handleDeleteMedia(
	request: Request,
	env: Env,
	id: string
): Promise<Response> {
	// Lookup record in D1
	const record = await env.DB.prepare(`
		SELECT * FROM media WHERE id = ?
	`).bind(id).first<MediaRecord>();

	if (!record) {
		return notFound();
	}

	// Generate presigned DELETE URL and execute
	const deleteUrl = await createPresignedDeleteUrl(env, record.object_key);

	let deleteResponse: Response;
	try {
		deleteResponse = await fetch(deleteUrl, { method: 'DELETE' });
	} catch {
		return notFound();
	}

	// Only delete from D1 if B2 confirms deletion (2xx or 404 if already gone)
	if (!deleteResponse.ok && deleteResponse.status !== 404) {
		return notFound();
	}

	// Delete from D1
	try {
		await env.DB.prepare(`DELETE FROM media WHERE id = ?`).bind(id).run();
	} catch {
		return notFound();
	}

	// Purge cache for this media ID
	const cache = caches.default;
	const cacheKeyUrl = new URL(request.url);
	cacheKeyUrl.search = '';
	await cache.delete(new Request(cacheKeyUrl.toString()));

	return new Response(null, { status: 204 });
}

/**
 * Parse and validate Range header.
 * Rejects multi-range requests and clamps max range length.
 * 
 * @returns null for invalid/multi-range, otherwise {start, end}
 */
function parseRangeHeader(
	rangeHeader: string,
	totalBytes: number
): { start: number; end: number } | null {
	// Basic format check
	if (!rangeHeader.startsWith('bytes=')) {
		return null;
	}

	const rangeSpec = rangeHeader.slice(6);

	// Reject multi-range (contains comma)
	if (rangeSpec.includes(',')) {
		return null;
	}

	const match = rangeSpec.match(/^(\d*)-(\d*)$/);
	if (!match) {
		return null;
	}

	const [, startStr, endStr] = match;

	let start: number;
	let end: number;

	if (startStr === '') {
		// Suffix range: -500 means last 500 bytes
		const suffix = parseInt(endStr, 10);
		if (isNaN(suffix) || suffix <= 0) {
			return null;
		}
		start = Math.max(0, totalBytes - suffix);
		end = totalBytes - 1;
	} else if (endStr === '') {
		// Open range: 500- means from 500 to end
		start = parseInt(startStr, 10);
		end = totalBytes - 1;
	} else {
		start = parseInt(startStr, 10);
		end = parseInt(endStr, 10);
	}

	// Validate bounds
	if (isNaN(start) || isNaN(end) || start < 0 || end < start || start >= totalBytes) {
		return null;
	}

	// Clamp end to total bytes
	end = Math.min(end, totalBytes - 1);

	// Clamp range length to prevent DoS
	const rangeLength = end - start + 1;
	if (rangeLength > MAX_RANGE_BYTES) {
		end = start + MAX_RANGE_BYTES - 1;
	}

	return { start, end };
}
