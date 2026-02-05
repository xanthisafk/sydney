/**
 * Sydney Media Service - Upload Route Handlers
 * Handles presigned URL generation for direct B2 uploads.
 */

import type { Env, UploadInitRequest, UploadInitResponse, UploadConfirmRequest, UploadConfirmResponse, MediaRecord } from '../types';
import { createPresignedPutUrl, createPresignedGetUrl } from '../lib/presign';
import { jsonResponse, notFound } from '../lib/response';

/**
 * POST /upload/new
 * Initialize a new upload: create pending record, return presigned PUT URL.
 */
export async function handleUploadInit(
	request: Request,
	env: Env
): Promise<Response> {
	let body: UploadInitRequest;
	try {
		body = await request.json();
	} catch {
		return notFound();
	}

	// Validate required fields
	if (!body.filename || !body.content_type || !body.total_bytes) {
		return notFound();
	}

	// Validate filename - basic sanitization
	const sanitizedFilename = sanitizeFilename(body.filename);
	if (!sanitizedFilename) {
		return notFound();
	}

	// Generate unique ID and object key
	const id = crypto.randomUUID();
	const objectKey = `${id}-${sanitizedFilename}`;

	// Insert pending record into D1
	try {
		await env.DB.prepare(`
			INSERT INTO media (id, object_key, filename, content_type, total_bytes, checksum, status)
			VALUES (?, ?, ?, ?, ?, ?, 'pending')
		`).bind(
			id,
			objectKey,
			sanitizedFilename,
			body.content_type,
			body.total_bytes,
			body.checksum || null
		).run();
	} catch {
		return notFound();
	}

	// Generate presigned PUT URL
	const uploadUrl = await createPresignedPutUrl(
		env,
		objectKey,
		body.content_type,
		body.total_bytes
	);

	const response: UploadInitResponse = {
		id,
		upload_url: uploadUrl,
		object_key: objectKey,
	};

	return jsonResponse(response);
}

/**
 * POST /upload/confirm
 * Verify upload completed successfully, mark as complete in D1.
 */
export async function handleUploadConfirm(
	request: Request,
	env: Env
): Promise<Response> {
	let body: UploadConfirmRequest;
	try {
		body = await request.json();
	} catch (e: any) {
		return jsonResponse({ error: 'JSON parse error: ' + e.message }, 200);
	}

	if (!body.id) {
		return jsonResponse({ error: 'Missing ID' }, 200);
	}

	// Lookup pending record
	const record = await env.DB.prepare(`
		SELECT * FROM media WHERE id = ? AND status = 'pending'
	`).bind(body.id).first<MediaRecord>();

	if (!record) {
		return jsonResponse({ error: 'Record not found or not pending', id: body.id }, 200);
	}

	// GET request (1 byte) to verify object exists in B2
	// HEAD requests sometimes fail with 403 on B2/S3 due to signature quirks, GET is more robust
	const getUrl = await createPresignedGetUrl(env, record.object_key);
	
	let checkResponse: Response;
	try {
		checkResponse = await fetch(getUrl, { 
			method: 'GET',
			headers: { 'Range': 'bytes=0-0' }
		});
	} catch (e: any) {
		const response: UploadConfirmResponse = {
			success: false,
			error: 'B2 verification request threw: ' + e.message,
		};
		return new Response(JSON.stringify({ 
			...response, 
			debug: { checkUrl: getUrl } 
		}), { status: 200, headers: { 'Content-Type': 'application/json' }});
	}

	if (!checkResponse.ok && checkResponse.status !== 206) {
		const response: UploadConfirmResponse = {
			success: false,
			error: `Object verification failed (B2 status ${checkResponse.status})`,
		};
		return new Response(JSON.stringify({ 
			...response, 
			debug: { 
				checkUrl: getUrl, 
				status: checkResponse.status,
				statusText: checkResponse.statusText
			} 
		}), { status: 200, headers: { 'Content-Type': 'application/json' }});
	}

	// TODO: Verify checksum if header is available (x-amz-checksum-sha256 or similar)

	// Mark as complete
	try {
		await env.DB.prepare(`
			UPDATE media 
			SET status = 'complete', confirmed_at = datetime('now')
			WHERE id = ?
		`).bind(body.id).run();
	} catch {
		return notFound();
	}

	const response: UploadConfirmResponse = {
		success: true,
	};

	return jsonResponse(response);
}

/**
 * Sanitize filename for use in object keys.
 * Removes path traversal, special chars, etc.
 */
function sanitizeFilename(filename: string): string {
	// Remove path components
	let name = filename.split(/[\\/]/).pop() || '';
	
	// Remove leading dots (hidden files)
	name = name.replace(/^\.+/, '');
	
	// Replace unsafe characters
	name = name.replace(/[^a-zA-Z0-9._-]/g, '_');
	
	// Limit length
	if (name.length > 200) {
		const ext = name.split('.').pop() || '';
		const base = name.slice(0, 200 - ext.length - 1);
		name = ext ? `${base}.${ext}` : base;
	}
	
	return name || '';
}
