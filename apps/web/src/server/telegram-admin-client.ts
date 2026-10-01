/**
 * Server-only calls to the engine's /internal/telegram/login/* endpoints.
 * Same pattern as engine-client.ts's fetchRecentPicks: ENGINE_BASE_URL and
 * ADMIN_INTERNAL_KEY stay on the server, never imported into client code.
 */

export interface TelegramChat {
  id: string;
  title: string;
  kind: "channel" | "group" | "bot" | "person";
}

export interface TelegramLoginStatus {
  status: "idle" | "connecting" | "awaiting_code" | "awaiting_password" | "logged_in" | "error";
  error: string | null;
  /** Only until the chat to watch is chosen: the engine doesn't keep it after that. */
  sessionString: string | null;
  /** Whether the engine is reading alerts now, and when it last stored one (missing on an older engine). */
  listener?: { watching: string | null; lastAlertAt: string | null };
}

function engineConfig(): { baseUrl: string; internalKey: string } {
  const baseUrl = process.env.ENGINE_BASE_URL;
  const internalKey = process.env.ADMIN_INTERNAL_KEY;
  if (!baseUrl || !internalKey) {
    throw new Error("ENGINE_BASE_URL and ADMIN_INTERNAL_KEY must both be set on this component.");
  }
  return { baseUrl, internalKey };
}

async function engineRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const { baseUrl, internalKey } = engineConfig();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const res = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${internalKey}`,
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...(init?.headers ?? {}),
      },
      cache: "no-store",
      signal: controller.signal,
    });
    const data = (await res.json()) as T & { error?: string };
    if (!res.ok) {
      throw new Error((data as { error?: string }).error ?? `Engine responded ${res.status}.`);
    }
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

export function telegramLoginStart(phoneNumber: string): Promise<{ status: string }> {
  return engineRequest("/internal/telegram/login/start", {
    method: "POST",
    body: JSON.stringify({ phoneNumber }),
  });
}

export function telegramSubmitCode(code: string): Promise<{ status: string; accepted: boolean }> {
  return engineRequest("/internal/telegram/login/code", {
    method: "POST",
    body: JSON.stringify({ code }),
  });
}

export function telegramSubmitPassword(password: string): Promise<{ status: string; accepted: boolean }> {
  return engineRequest("/internal/telegram/login/password", {
    method: "POST",
    body: JSON.stringify({ password }),
  });
}

export function telegramLoginStatus(): Promise<TelegramLoginStatus> {
  return engineRequest("/internal/telegram/login/status");
}

export function telegramListChats(): Promise<{ chats: TelegramChat[] }> {
  return engineRequest("/internal/telegram/login/chats");
}

export function telegramWatchChat(
  chatId: string,
): Promise<{ status: string; chatId: string; sessionString: string | null; note: string }> {
  return engineRequest("/internal/telegram/login/watch", {
    method: "POST",
    body: JSON.stringify({ chatId }),
  });
}
