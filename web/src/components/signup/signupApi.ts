import { hashTotpToken } from "../../utils/auth";

/**
 * Checks if a username is already taken.
 *
 * @param username - The username to check.
 * @returns A promise resolving to a boolean indicating if it exists.
 */
export async function checkUsernameDuplicateApi(
  username: string
): Promise<boolean> {
  const res = await fetch(
    `/api/auth/check-username?username=${encodeURIComponent(username)}`
  );
  if (!res.ok) throw new Error("Duplicate check failed");
  const data = (await res.json()) as { exists: boolean };
  return data.exists;
}

/**
 * Starts the TOTP 2FA setup process on the backend.
 *
 * @returns A promise resolving to the setup secret and URI.
 */
export async function startSignupTotpSetupApi(): Promise<{
  secret: string;
  uri: string;
}> {
  const res = await fetch("/api/account/totp/setup");
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

/**
 * Confirms and activates the 2FA using the verification token code.
 *
 * @param secret - The TOTP secret key.
 * @param token - The 6-digit TOTP token input.
 * @returns A promise resolving to the list of recovery keys.
 */
export async function confirmSignupTotpApi(
  secret: string,
  token: string
): Promise<{ recovery_keys: string[] }> {
  const rawToken = token.replace(/\s/g, "");
  const salt = crypto.randomUUID();
  const hashHex = await hashTotpToken(rawToken, salt);

  const res = await fetch("/api/account/totp/confirm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      secret,
      totpTokenHash: hashHex,
      salt
    })
  });

  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

/**
 * Submits the registration payload to create the account.
 *
 * @param payload - Username, password, and CAPTCHA token.
 * @returns A promise resolving to the raw response object.
 */
export async function signupSubmitApi(payload: {
  username: string;
  password: string;
  turnstileToken: string | null;
}): Promise<Response> {
  return fetch("/api/auth/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}
