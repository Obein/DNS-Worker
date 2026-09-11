import { Env, User, ExecutionContext } from "../../types";
import { handleMeRequest } from "./me";
import { handleSecurityRequest } from "./security";
import { handleSessionsRequest } from "./sessions";

/**
 * Handle personal account requests to /api/account/... by delegating to specialized handlers.
 */
export async function handlePersonalAccountRequest(
  request: Request,
  env: Env,
  user: User,
  pathParts: string[],
  ctx: ExecutionContext
): Promise<Response> {
  const action = pathParts[2];

  // Delegate basic account info and lifecycle actions
  if (action === 'me' || action === 'delete' || action === 'logs') {
    return handleMeRequest(request, env, user, pathParts, ctx);
  }

  // Delegate password updates, TOTP and Passkey settings, MFA settings, and recovery keys
  if (action === 'password' || action === 'totp' || action === 'passkeys' || action === 'mfa' || action === 'migrate-password' || action === 'pin' || action === 'recovery-keys') {
    return handleSecurityRequest(request, env, user, pathParts, ctx);
  }

  // Delegate session lists/revocation and activity log querying
  if (action === 'activity' || action === 'sessions') {
    return handleSessionsRequest(request, env, user, pathParts, ctx);
  }

  return new Response("Not Found", { status: 404 });
}
