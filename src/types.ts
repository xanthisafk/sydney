/**
 * Sydney Media Service - TypeScript Types
 */

/** Environment bindings from wrangler.jsonc */
export interface Env {
	DB: D1Database;
	MASTER_PASSWORD: string;
	S3_ACCESS_KEY_ID: string;
	S3_SECRET_ACCESS_KEY: string;
	S3_BUCKET: string;
	S3_ENDPOINT: string;
	S3_REGION: string;
}

/** Media record as stored in D1 */
export interface MediaRecord {
	id: string;
	object_key: string;
	filename: string;
	content_type: string;
	total_bytes: number;
	checksum: string | null;
	status: 'pending' | 'complete' | 'failed';
	created_at: string;
	confirmed_at: string | null;
}

/** Minimal media info for list responses */
export interface MediaListItem {
	id: string;
	filename: string;
	content_type: string;
	total_bytes: number;
	status: string;
	created_at: string;
}

// ============================================
// Upload Flow Types
// ============================================

export interface UploadInitRequest {
	filename: string;
	content_type: string;
	total_bytes: number;
	checksum?: string;
}

export interface UploadInitResponse {
	id: string;
	upload_url: string;
	object_key: string;
}

export interface UploadConfirmRequest {
	id: string;
}

export interface UploadConfirmResponse {
	success: boolean;
	error?: string;
}

// ============================================
// List Flow Types
// ============================================

export interface ListMediaResponse {
	items: MediaListItem[];
	page: number;
	limit: number;
	total: number;
}
