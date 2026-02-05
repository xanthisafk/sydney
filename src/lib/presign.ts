/**
 * Sydney Media Service - AWS Signature V4 Presigned URL Generator
 * Works with any S3-compatible storage (AWS S3, Backblaze B2, Cloudflare R2, MinIO, etc.)
 * 
 * No external dependencies - uses Web Crypto API only.
 */

import type { Env } from '../types';

const ALGORITHM = 'AWS4-HMAC-SHA256';
const SERVICE = 's3';
const EXPIRES_SECONDS = 3600; // 1 hour

/**
 * Generate a presigned PUT URL for uploading an object.
 */
export async function createPresignedPutUrl(
	env: Env,
	objectKey: string,
	contentType: string,
	contentLength: number
): Promise<string> {
	return createPresignedUrl(env, 'PUT', objectKey, {
		'content-type': contentType,
		'content-length': contentLength.toString(),
	});
}

/**
 * Generate a presigned GET URL for downloading an object.
 */
export async function createPresignedGetUrl(
	env: Env,
	objectKey: string
): Promise<string> {
	return createPresignedUrl(env, 'GET', objectKey);
}

/**
 * Generate a presigned DELETE URL for removing an object.
 */
export async function createPresignedDeleteUrl(
	env: Env,
	objectKey: string
): Promise<string> {
	return createPresignedUrl(env, 'DELETE', objectKey);
}

/**
 * Generate a presigned HEAD URL for checking if an object exists.
 */
export async function createPresignedHeadUrl(
	env: Env,
	objectKey: string
): Promise<string> {
	return createPresignedUrl(env, 'HEAD', objectKey);
}

/**
 * Core presigned URL generator using AWS Signature V4.
 */
async function createPresignedUrl(
	env: Env,
	method: string,
	objectKey: string,
	signedHeaders: Record<string, string> = {}
): Promise<string> {
	const now = new Date();
	const amzDate = formatAmzDate(now);
	const dateStamp = amzDate.slice(0, 8);
	
	const region = env.S3_REGION;
	const host = `${env.S3_BUCKET}.${env.S3_ENDPOINT}`;
	const credentialScope = `${dateStamp}/${region}/${SERVICE}/aws4_request`;
	const credential = `${env.S3_ACCESS_KEY_ID}/${credentialScope}`;

	// Build canonical headers string
	const allHeaders: Record<string, string> = {
		host,
		...signedHeaders,
	};
	
	const sortedHeaderKeys = Object.keys(allHeaders).sort();
	const canonicalHeaders = sortedHeaderKeys
		.map(key => `${key.toLowerCase()}:${allHeaders[key].trim()}`)
		.join('\n') + '\n';
	const signedHeadersList = sortedHeaderKeys.map(k => k.toLowerCase()).join(';');

	// Query parameters for presigned URL
	const queryParams: Record<string, string> = {
		'X-Amz-Algorithm': ALGORITHM,
		'X-Amz-Credential': credential,
		'X-Amz-Date': amzDate,
		'X-Amz-Expires': EXPIRES_SECONDS.toString(),
		'X-Amz-SignedHeaders': signedHeadersList,
	};

	const canonicalQueryString = Object.keys(queryParams)
		.sort()
		.map(key => `${encodeURIComponent(key)}=${encodeURIComponent(queryParams[key])}`)
		.join('&');

	// Build canonical request
	const canonicalUri = '/' + encodeURIComponent(objectKey).replace(/%2F/g, '/');
	const canonicalRequest = [
		method,
		canonicalUri,
		canonicalQueryString,
		canonicalHeaders,
		signedHeadersList,
		'UNSIGNED-PAYLOAD', // For presigned URLs
	].join('\n');

	// Create string to sign
	const hashedCanonicalRequest = await sha256Hex(canonicalRequest);
	const stringToSign = [
		ALGORITHM,
		amzDate,
		credentialScope,
		hashedCanonicalRequest,
	].join('\n');

	// Calculate signing key
	const signingKey = await getSignatureKey(
		env.S3_SECRET_ACCESS_KEY,
		dateStamp,
		region,
		SERVICE
	);

	// Calculate signature
	const signature = await hmacSha256Hex(signingKey, stringToSign);

	// Build final URL
	const url = new URL(`https://${host}${canonicalUri}`);
	url.search = `${canonicalQueryString}&X-Amz-Signature=${signature}`;

	return url.toString();
}

// ============================================
// Helper Functions
// ============================================

function formatAmzDate(date: Date): string {
	return date.toISOString().replace(/[:-]|\.\d{3}/g, '');
}

async function sha256Hex(message: string): Promise<string> {
	const encoder = new TextEncoder();
	const data = encoder.encode(message);
	const hashBuffer = await crypto.subtle.digest('SHA-256', data);
	return bufferToHex(hashBuffer);
}

async function hmacSha256(key: ArrayBuffer | Uint8Array, message: string): Promise<ArrayBuffer> {
	const encoder = new TextEncoder();
	const cryptoKey = await crypto.subtle.importKey(
		'raw',
		key,
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign']
	);
	return crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(message));
}

async function hmacSha256Hex(key: ArrayBuffer, message: string): Promise<string> {
	const result = await hmacSha256(key, message);
	return bufferToHex(result);
}

async function getSignatureKey(
	secretKey: string,
	dateStamp: string,
	region: string,
	service: string
): Promise<ArrayBuffer> {
	const encoder = new TextEncoder();
	const kDate = await hmacSha256(encoder.encode('AWS4' + secretKey), dateStamp);
	const kRegion = await hmacSha256(kDate, region);
	const kService = await hmacSha256(kRegion, service);
	const kSigning = await hmacSha256(kService, 'aws4_request');
	return kSigning;
}

function bufferToHex(buffer: ArrayBuffer): string {
	const bytes = new Uint8Array(buffer);
	return Array.from(bytes)
		.map(b => b.toString(16).padStart(2, '0'))
		.join('');
}
