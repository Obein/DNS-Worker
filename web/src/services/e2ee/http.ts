/**
 * @file http.ts
 * @description HTTP network client for E2EE account and profile endpoints.
 */

import { profileFetch } from '../profiles';
import type { ProfileE2eeStatus } from './types';

export interface WrappedKeyResponse {
  encryptedSk: string;
  iv: string;
}

export interface RecoveryWrappedKeyResponse {
  encryptedSk: string;
  iv: string;
  salt: string;
}

/**
 * Fetches user account-level E2EE configuration with profile fallback.
 */
export async function fetchUserE2eeStatus(): Promise<ProfileE2eeStatus> {
  try {
    const res = await fetch('/api/account/e2ee/status');
    if (res.ok) {
      return (await res.json()) as ProfileE2eeStatus;
    }
  } catch {
    // Fallback
  }

  // Fallback: check profile list
  try {
    const profilesRes = await fetch('/api/profiles');
    if (profilesRes.ok) {
      const profiles = await profilesRes.json();
      if (profiles && profiles.length > 0) {
        return await fetchProfileE2eeStatus(profiles[0].id);
      }
    }
  } catch (err) {
    console.warn('[E2EE HTTP] Fallback status check failed:', err);
  }

  return {
    enabled: false,
    publicKey: null,
    wrappedPasskeys: [],
    hasRecoveryKey: false,
    userPasskeyCount: 0,
    createdAt: null
  };
}

/**
 * Fetches E2EE configuration and status for a specific profile.
 */
export async function fetchProfileE2eeStatus(profileId: string): Promise<ProfileE2eeStatus> {
  const res = await profileFetch(`/api/profiles/${profileId}/e2ee/status`);
  if (!res.ok) {
    throw new Error(`Failed to fetch E2EE status: ${await res.text()}`);
  }
  return (await res.json()) as ProfileE2eeStatus;
}

/**
 * Activates already enrolled E2EE on the account.
 */
export async function postEnableUserE2ee(): Promise<void> {
  const res = await fetch('/api/account/e2ee/enable', { method: 'POST' });
  if (!res.ok) {
    throw new Error(`Failed to enable user E2EE: ${await res.text()}`);
  }
}

/**
 * Posts initial E2EE public key and wrapped private key payload for account.
 */
export async function postInitUserE2ee(payload: Record<string, any>): Promise<void> {
  const res = await fetch('/api/account/e2ee/init', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    throw new Error(`Failed to initialize user E2EE: ${await res.text()}`);
  }
}

/**
 * Posts initial E2EE public key and wrapped private key payload for a profile.
 */
export async function postInitProfileE2ee(profileId: string, payload: Record<string, any>): Promise<void> {
  const res = await profileFetch(`/api/profiles/${profileId}/e2ee/init`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    throw new Error(`Failed to enable E2EE: ${await res.text()}`);
  }
}

/**
 * Fetches wrapped private key for a given Passkey from account or profile endpoint.
 */
export async function fetchWrappedKey(targetPasskeyId?: string, profileId?: string): Promise<WrappedKeyResponse> {
  const query = targetPasskeyId ? `?passkey_id=${encodeURIComponent(targetPasskeyId)}` : '';

  if (profileId) {
    let res = await fetch(`/api/profiles/${profileId}/e2ee/wrapped-key${query}`);
    if (!res.ok) {
      res = await fetch(`/api/account/e2ee/wrapped-key${query}`);
    }
    if (!res.ok) {
      throw new Error(`Failed to fetch wrapped key: ${await res.text()}`);
    }
    return (await res.json()) as WrappedKeyResponse;
  }

  let res = await fetch(`/api/account/e2ee/wrapped-key${query}`);
  if (!res.ok) {
    const profilesRes = await fetch('/api/profiles');
    if (profilesRes.ok) {
      const profiles = await profilesRes.json();
      if (profiles && profiles.length > 0) {
        res = await fetch(`/api/profiles/${profiles[0].id}/e2ee/wrapped-key${query}`);
      }
    }
  }

  if (!res.ok) {
    throw new Error(`Failed to fetch wrapped key: ${await res.text()}`);
  }

  return (await res.json()) as WrappedKeyResponse;
}

/**
 * Fetches recovery wrapped private key payload.
 */
export async function fetchRecoveryWrappedKey(): Promise<RecoveryWrappedKeyResponse> {
  const res = await fetch('/api/account/e2ee/recovery-wrapped-key');
  if (!res.ok) {
    throw new Error(`Failed to fetch recovery wrapped key: ${await res.text()}`);
  }
  return (await res.json()) as RecoveryWrappedKeyResponse;
}

/**
 * Uploads a wrapped key for a newly registered Passkey.
 */
export async function postWrapKey(payload: { passkeyId: string; encryptedSk: string; iv: string }): Promise<boolean> {
  const res = await fetch('/api/account/e2ee/wrap', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return res.ok;
}

/**
 * Uploads a newly wrapped private key under a rotated Recovery Key.
 */
export async function postWrapRecoveryKey(payload: { encryptedSk: string; iv: string; salt: string }): Promise<boolean> {
  const res = await fetch('/api/account/e2ee/wrap-recovery', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return res.ok;
}

/**
 * Disables E2EE across user account.
 */
export async function deleteUserE2ee(): Promise<void> {
  const res = await fetch('/api/account/e2ee', { method: 'DELETE' });
  if (!res.ok) {
    throw new Error(`Failed to disable E2EE: ${await res.text()}`);
  }
}

/**
 * Disables E2EE for a profile.
 */
export async function deleteProfileE2ee(profileId: string): Promise<void> {
  const res = await profileFetch(`/api/profiles/${profileId}/e2ee`, { method: 'DELETE' });
  if (!res.ok) {
    throw new Error(`Failed to disable E2EE: ${await res.text()}`);
  }
}
