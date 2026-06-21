/**
 * Simple PBKDF2 implementation using Web Crypto API for Cloudflare Workers
 * - Uses SHA-256 with 100,000 iterations for password hashing (configurable)
 * - Generates a random 16-byte salt for each password
 * - Stores the salt and hash together in a base64-encoded string
 * - Provides functions for hashing and verifying passwords
 *
 * Note: In a production environment, consider using a well-established library like bcrypt or argon2. 
 * @param password - The plaintext password to hash.
 * @param version - The hashing version to use (default 1). Version 2 uses fewer iterations for faster hashing.
 * @returns A base64-encoded string containing the salt and hash for storage.
 */
export async function hashPassword(password: string, version: number = 1): Promise<string> {
  const encoder = new TextEncoder();
  const passwordBuffer = encoder.encode(password);
  
  // Generate a random salt
  const salt = crypto.getRandomValues(new Uint8Array(16));
  
  // Import the password as a key
  const baseKey = await crypto.subtle.importKey(
    "raw",
    passwordBuffer,
    "PBKDF2",
    false,
    ["deriveBits", "deriveKey"]
  );
  
  const iterations = version === 2 ? 1000 : 100000;
  
  // Derive the hash
  const hashBuffer = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: salt,
      iterations: iterations,
      hash: "SHA-256"
    },
    baseKey,
    256
  );
  
  // Combine salt and hash for storage (base64)
  const combined = new Uint8Array(salt.length + hashBuffer.byteLength);
  combined.set(salt);
  combined.set(new Uint8Array(hashBuffer), salt.length);
  
  return btoa(String.fromCharCode(...combined));
}

export async function verifyPassword(password: string, storedHash: string, version: number = 1): Promise<boolean> {
  const encoder = new TextEncoder();
  const passwordBuffer = encoder.encode(password);
  
  // Decode the stored hash
  const combined = new Uint8Array(
    atob(storedHash)
      .split("")
      .map((c) => c.charCodeAt(0))
  );
  
  const salt = combined.slice(0, 16);
  const originalHash = combined.slice(16);
  
  const baseKey = await crypto.subtle.importKey(
    "raw",
    passwordBuffer,
    "PBKDF2",
    false,
    ["deriveBits", "deriveKey"]
  );
  
  const iterations = version === 2 ? 1000 : 100000;
  
  const testHash = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: salt,
      iterations: iterations,
      hash: "SHA-256"
    },
    baseKey,
    256
  );
  
  const testHashArray = new Uint8Array(testHash);
  if (testHashArray.length !== originalHash.length) return false;
  
  // Constant-time comparison
  let result = 0;
  for (let i = 0; i < testHashArray.length; i++) {
    result |= testHashArray[i] ^ originalHash[i];
  }
  return result === 0;
}


/**
 * Generates a secure random ID of the specified length.
 */
export function generateId(length: number): string {
  const byteLength = Math.ceil(length / 2);
  const bytes = new Uint8Array(byteLength);
  
  crypto.getRandomValues(bytes);
  
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, length);
}
