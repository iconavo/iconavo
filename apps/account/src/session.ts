// Кто вошёл — для своих адресов сервиса (кабинет, обратная связь): сеанс Better Auth по cookie запроса.

import type { Auth } from "./auth.js";
import { failure } from "./http.js";

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
  locale?: unknown;
}

export async function sessionUser(
  request: Request,
  auth: Auth,
): Promise<SessionUser | undefined> {
  const session = await auth.api.getSession({ headers: request.headers });
  return (session?.user as SessionUser | undefined) ?? undefined;
}

export const unauthorized = () => failure(401, "UNAUTHORIZED", "Sign in first");
