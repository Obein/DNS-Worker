/**
 * Verify Cloudflare Turnstile token
 */
export async function verifyTurnstile(token: string, secret: string, ip: string): Promise<boolean> {
  if (!token || !secret) return false;
  try {
    const params = new URLSearchParams();
    params.append('secret', secret);
    params.append('response', token);
    params.append('remoteip', ip);
    const result = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: params,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });
    const outcome = await result.json() as any;
    return !!outcome.success;
  } catch (e) {
    return false;
  }
}
