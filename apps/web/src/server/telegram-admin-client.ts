/** Server-only calls to the engine's /internal/telegram/login/* routes (Settings > Telegram). */
import { engineCall } from "./engine-client";

interface TelegramChat {
  id: string;
  title: string;
  kind: "channel" | "group" | "bot" | "person";
}

interface TelegramLoginStatus {
  status: "idle" | "connecting" | "awaiting_code" | "awaiting_password" | "logged_in" | "error";
  error: string | null;
  /** Only until the chat to watch is chosen: the engine doesn't keep it after that. */
  sessionString: string | null;
  /** Whether the engine is reading alerts now, and when it last stored one (missing on an older engine). */
  listener?: { watching: string | null; lastAlertAt: string | null };
}

/** The engine's Telegram sign-in steps wait on Telegram itself, so they get longer than the usual 8 s. */
const post = <T>(path: string, body: unknown) => engineCall<T>(path, "Telegram sign-in", { method: "POST", body, timeoutMs: 15_000 });
const get = <T>(path: string) => engineCall<T>(path, "Telegram sign-in", { timeoutMs: 15_000 });

export function telegramLoginStart(phoneNumber: string): Promise<{ status: string }> {
  return post("/internal/telegram/login/start", { phoneNumber });
}

export function telegramSubmitCode(code: string): Promise<{ status: string; accepted: boolean }> {
  return post("/internal/telegram/login/code", { code });
}

export function telegramSubmitPassword(password: string): Promise<{ status: string; accepted: boolean }> {
  return post("/internal/telegram/login/password", { password });
}

export function telegramLoginStatus(): Promise<TelegramLoginStatus> {
  return get("/internal/telegram/login/status");
}

export function telegramListChats(): Promise<{ chats: TelegramChat[] }> {
  return get("/internal/telegram/login/chats");
}

export function telegramWatchChat(
  chatId: string,
): Promise<{ status: string; chatId: string; sessionString: string | null; note: string }> {
  return post("/internal/telegram/login/watch", { chatId });
}
