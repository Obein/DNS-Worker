import { Env, User, ExecutionContext } from "../../../types";
import { handlePasswordRequest } from "./password";
import { handleTotpAndMfaRequest } from "./totp";
import { handlePinRequest } from "./pin";
import { handlePasskeysRequest } from "./passkeys";
import { handleRecoveryKeysRequest } from "./recoveryKeys";

export * from "./reauth";
export * from "./password";
export * from "./totp";
export * from "./pin";
export * from "./passkeys";
export * from "./recoveryKeys";

/**
 * Handle security credentials requests to /api/account/password, /api/account/totp/...,
 * /api/account/passkeys/..., /api/account/mfa/..., /api/account/pin, and /api/account/recovery-keys/...
 * by dispatching to specialized sub-handlers.
 *
 * @param request - Inbound HTTP Request.
 * @param env - Cloudflare Worker environment bindings.
 * @param user - Current authenticated user.
 * @param pathParts - URL pathname components.
 * @param ctx - Execution context.
 * @returns Response indicating operation outcome.
 */
export async function handleSecurityRequest(
  request: Request,
  env: Env,
  user: User,
  pathParts: string[],
  ctx: ExecutionContext
): Promise<Response> {
  const action = pathParts[2];

  switch (action) {
    case "password":
    case "migrate-password":
      return handlePasswordRequest(request, env, user, pathParts, ctx);

    case "totp":
    case "mfa":
      return handleTotpAndMfaRequest(request, env, user, pathParts, ctx);

    case "pin":
      return handlePinRequest(request, env, user, pathParts, ctx);

    case "passkeys":
      return handlePasskeysRequest(request, env, user, pathParts, ctx);

    case "recovery-keys":
      return handleRecoveryKeysRequest(request, env, user, pathParts, ctx);

    default:
      return new Response("Not Found", { status: 404 });
  }
}

