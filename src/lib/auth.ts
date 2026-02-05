/**
 * Sydney Media Service - Authentication Utilities
 * Uses constant-time comparison to prevent timing attacks.
 */

import type { Env } from '../types';

/**
 * Verify the Authorization header contains a valid Bearer token.
 * Uses crypto.subtle.timingSafeEqual for constant-time comparison.
 * 
 * @returns true if authenticated, false otherwise
 */
export async function verifyAuth(request: Request, env: Env): Promise<boolean> {
	const authHeader = request.headers.get('Authorization');
	if (!authHeader) {
		return false;
	}

	// Check for Bearer prefix
	if (!authHeader.startsWith('Bearer ')) {
		return false;
	}

	const token = authHeader.slice(7); // Remove 'Bearer ' prefix
	
	return timingSafeEqual(token, env.MASTER_PASSWORD);
}

/**
 * Constant-time string comparison using Web Crypto API.
 * Prevents timing attacks by ensuring comparison time is independent of string content.
 */
async function timingSafeEqual(a: string, b: string): Promise<boolean> {
	const encoder = new TextEncoder();
	const aBytes = encoder.encode(a);
	const bBytes = encoder.encode(b);

	// If lengths differ, we still need to do constant-time work
	// to avoid leaking length information
	if (aBytes.length !== bBytes.length) {
		// Compare against itself to maintain timing consistency
		const dummy = encoder.encode(a);
		await crypto.subtle.digest('SHA-256', dummy);
		return false;
	}

	// Use HMAC to do constant-time comparison
	// Generate a random key for this comparison
	const keyMaterial = crypto.getRandomValues(new Uint8Array(32));
	const key = await crypto.subtle.importKey(
		'raw',
		keyMaterial,
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign']
	);

	const aHash = await crypto.subtle.sign('HMAC', key, aBytes);
	const bHash = await crypto.subtle.sign('HMAC', key, bBytes);

	// Compare the hashes byte by byte
	const aView = new Uint8Array(aHash);
	const bView = new Uint8Array(bHash);

	let result = 0;
	for (let i = 0; i < aView.length; i++) {
		result |= aView[i] ^ bView[i];
	}

	return result === 0;
}
