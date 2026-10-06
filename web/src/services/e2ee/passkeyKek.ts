/**
 * @file passkeyKek.ts
 * @description WebAuthn PRF extension Key Encryption Key (KEK) derivation logic.
 */

import { getPasskeyAuthOptions, getPasskeys } from "../account";
import { bufferToBase64Url } from "../../utils/webauthn";
import { base64UrlToUint8Array } from "./crypto";

export interface DerivedPasskeyKek {
  kek: Uint8Array;
  altKek?: Uint8Array;
  passkeyId?: string;
}

/**
 * Derives a 256-bit Key Encryption Key (KEK) using WebAuthn Passkey assertion.
 * Leverages WebAuthn PRF extension with dual salt evaluation (account + profileId)
 * to guarantee seamless decryption regardless of key wrap scope.
 */
export async function derivePasskeyKek(saltScope: string = "account"): Promise<DerivedPasskeyKek> {
  const authOptions = await getPasskeyAuthOptions();

  // Primary salt is always "account"
  const saltAccount = new Uint8Array(32);
  const encAccount = new TextEncoder().encode("obex-dns-log-e2ee-salt:account");
  saltAccount.set(encAccount.subarray(0, 32));

  // Secondary salt if saltScope is provided and distinct from "account"
  let saltProfile: Uint8Array | undefined;
  if (saltScope && saltScope !== "account") {
    saltProfile = new Uint8Array(32);
    const encProfile = new TextEncoder().encode(`obex-dns-log-e2ee-salt:${saltScope}`);
    saltProfile.set(encProfile.subarray(0, 32));
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prfEval: any = {
    first: saltAccount,
  };
  if (saltProfile) {
    prfEval.second = saltProfile;
  }

  const challengeBytes = base64UrlToUint8Array(authOptions.challenge);

  const credential = (await navigator.credentials.get({
    publicKey: {
      challenge: challengeBytes as BufferSource,
      timeout: 60000,
      userVerification: "preferred",
      rpId: authOptions.rpId || window.location.hostname,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      allowCredentials: (authOptions.allowCredentials || []).map((c: any) => ({
        ...c,
        id: base64UrlToUint8Array(c.id) as BufferSource,
      })),
      extensions: {
        prf: {
          eval: prfEval,
        },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    },
  })) as PublicKeyCredential;

  if (!credential) {
    throw new Error("Passkey assertion was cancelled or failed");
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const extResults = credential.getClientExtensionResults() as any;
  let kekBytes: Uint8Array;
  let altKekBytes: Uint8Array | undefined;

  if (extResults?.prf?.results?.first) {
    kekBytes = new Uint8Array(extResults.prf.results.first);
    if (extResults?.prf?.results?.second) {
      altKekBytes = new Uint8Array(extResults.prf.results.second);
    }
  } else {
    throw new Error(
      "Passkey authenticator does not support WebAuthn PRF extension. Please unlock using your Recovery Key."
    );
  }

  // Match credential ID to registered passkey if possible
  let passkeyId = credential.id;
  const normalizeB64 = (s: string) => (s || "").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const rawIdB64Url = credential.rawId ? bufferToBase64Url(credential.rawId) : "";
  const credIdNorm = normalizeB64(credential.id);
  const rawIdNorm = normalizeB64(rawIdB64Url);

  if (authOptions.allowCredentials && authOptions.allowCredentials.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const match = authOptions.allowCredentials.find((c: any) => {
      const cNorm = normalizeB64(c.id);
      return cNorm === credIdNorm || cNorm === rawIdNorm || c.passkey_id === credential.id;
    });
    if (match?.passkey_id) passkeyId = match.passkey_id;
  }

  if (!passkeyId || passkeyId === credential.id) {
    try {
      const passkeys = await getPasskeys();
      const match = passkeys.find((p) => {
        const pNorm = normalizeB64(p.credential_id);
        return pNorm === credIdNorm || pNorm === rawIdNorm || p.id === credential.id;
      });
      if (match?.id) {
        passkeyId = match.id;
      } else if (passkeys.length > 0) {
        passkeyId = passkeys[0].id;
      }
    } catch (err) {
      console.warn("[E2EE] Could not load passkeys to match credential:", err);
    }
  }

  return { kek: kekBytes, altKek: altKekBytes, passkeyId };
}
