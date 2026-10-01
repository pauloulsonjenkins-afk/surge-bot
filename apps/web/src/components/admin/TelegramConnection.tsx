"use client";

import { useEffect, useRef, useState } from "react";

type LoginStatus = "idle" | "connecting" | "awaiting_code" | "awaiting_password" | "logged_in" | "error";

interface Chat {
  id: string;
  title: string;
  kind: "channel" | "group" | "bot" | "person";
}

async function postJson<T>(url: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Request failed (${res.status}).`);
  return data;
}

export default function TelegramConnection() {
  const [phoneNumber, setPhoneNumber] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<LoginStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [sessionString, setSessionString] = useState<string | null>(null);
  const [chats, setChats] = useState<Chat[] | null>(null);
  const [watching, setWatching] = useState<{ chatId: string; note: string } | null>(null);
  const [busy, setBusy] = useState(false);
  // Whether the engine is reading alerts now (from its saved session), so a working connection isn't shown as a login form.
  const [listener, setListener] = useState<{ watching: string | null; lastAlertAt: string | null } | null>(null);
  const [relogin, setRelogin] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    void fetch("/api/admin/telegram/login/status")
      .then((r) => r.json())
      .then((d: { listener?: { watching: string | null; lastAlertAt: string | null } }) => setListener(d.listener ?? null))
      .catch(() => {});
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  function startPolling() {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch("/api/admin/telegram/login/status");
        const data = await res.json();
        setStatus(data.status);
        setError(data.error ?? null);
        if (data.sessionString) setSessionString(data.sessionString);
        if (data.status === "logged_in" || data.status === "error") {
          if (pollRef.current) clearInterval(pollRef.current);
          if (data.status === "logged_in") void loadChats();
        }
      } catch {
        // transient — next poll will retry
      }
    }, 1500);
  }

  async function loadChats() {
    try {
      const data = await (await fetch("/api/admin/telegram/login/chats")).json();
      if (data.error) throw new Error(data.error);
      setChats(data.chats);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load chats.");
    }
  }

  async function submitPhone() {
    setBusy(true);
    setError(null);
    try {
      await postJson("/api/admin/telegram/login/start", { phoneNumber });
      setStatus("connecting");
      startPolling();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start login.");
    } finally {
      setBusy(false);
    }
  }

  async function submitCode() {
    setBusy(true);
    setError(null);
    try {
      await postJson("/api/admin/telegram/login/code", { code });
      setCode("");
      setStatus("connecting");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit code.");
    } finally {
      setBusy(false);
    }
  }

  async function submitPassword() {
    setBusy(true);
    setError(null);
    try {
      await postJson("/api/admin/telegram/login/password", { password });
      setPassword("");
      setStatus("connecting");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit password.");
    } finally {
      setBusy(false);
    }
  }

  async function watchChat(chatId: string) {
    setBusy(true);
    setError(null);
    try {
      const result = await postJson<{ chatId: string; note: string }>("/api/admin/telegram/login/watch", {
        chatId,
      });
      setWatching(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start watching that chat.");
    } finally {
      setBusy(false);
    }
  }

  if (listener?.watching && status === "idle" && !relogin) {
    const last = listener.lastAlertAt
      ? new Date(listener.lastAlertAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" })
      : null;
    return (
      <div>
        <h3 className="text-sm font-medium text-ink">Telegram connection</h3>
        <p className="mt-1 text-xs text-hit">Connected: reading your alerts{last ? `, last one stored ${last}` : ""}.</p>
        <button type="button" onClick={() => setRelogin(true)} className="mt-3 rounded-md border border-line px-3 py-1.5 text-xs font-medium text-ink">
          Log in again
        </button>
        <p className="mt-1 text-xs text-ink-muted">Only needed if Telegram signed the engine out, or to watch a different chat.</p>
      </div>
    );
  }

  return (
    <div>
      <h3 className="text-sm font-medium text-ink">Telegram connection</h3>
      <p className="mt-1 text-xs text-ink-muted">
        Log in with your own Telegram account so the engine can read your alerts from the group/channel
        you’re already in.
      </p>

      {error && (
        <p className="mt-4 rounded-md border border-destructive bg-surface-2 px-3 py-2 text-sm text-destructive">{error}</p>
      )}

      {watching ? (
        <div className="mt-4 space-y-3">
          <p className="rounded-md border border-line bg-surface-2 px-3 py-2 text-sm text-ink">
            Now watching chat {watching.chatId}. Picks from it will appear on the Picks tab.
          </p>
          <p className="text-sm text-ink-muted">{watching.note}</p>
          {sessionString && (
            <div>
              <p className="mb-1 text-xs font-medium text-ink-muted">TELEGRAM_SESSION value — copy this into the env var:</p>
              <textarea
                readOnly
                value={sessionString}
                className="w-full rounded-md border border-line bg-surface-2 p-2 font-mono text-xs text-ink"
                rows={4}
                onFocus={(e) => e.currentTarget.select()}
              />
            </div>
          )}
        </div>
      ) : status === "logged_in" && chats ? (
        <div className="mt-4 space-y-2">
          <p className="text-sm text-ink-muted">
            Pick the chat your alerts land in — look for the personal alerts bot (labelled “bot” below), not
            a group.
          </p>
          <ul className="divide-y divide-line rounded-lg border border-line">
            {chats.map((c) => (
              <li key={c.id} className="flex items-center justify-between px-3 py-2">
                <span className="text-sm text-ink">
                  {c.title} <span className="text-xs text-ink-muted">({c.kind})</span>
                </span>
                <button
                  disabled={busy}
                  onClick={() => watchChat(c.id)}
                  className="rounded-md bg-accent px-3 py-1 text-xs font-medium text-accent-ink disabled:opacity-50"
                >
                  Watch
                </button>
              </li>
            ))}
          </ul>
          {chats.length === 0 && <p className="text-sm text-ink-muted">No chats found on this account.</p>}
          {sessionString && (
            <div className="mt-2">
              <p className="mb-1 text-xs font-medium text-ink-muted">
                TELEGRAM_SESSION value — save this as an env var too, alongside your chosen chat’s id:
              </p>
              <textarea
                readOnly
                value={sessionString}
                className="w-full rounded-md border border-line bg-surface-2 p-2 font-mono text-xs text-ink"
                rows={4}
                onFocus={(e) => e.currentTarget.select()}
              />
            </div>
          )}
        </div>
      ) : status === "awaiting_code" ? (
        <div className="mt-4 space-y-2">
          <label className="block text-sm text-ink-muted">Code sent to your Telegram app</label>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="12345"
            className="w-full rounded-md border border-line px-3 py-2 text-sm text-ink"
          />
          <button
            disabled={busy || !code}
            onClick={submitCode}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-ink disabled:opacity-50"
          >
            Submit code
          </button>
        </div>
      ) : status === "awaiting_password" ? (
        <div className="mt-4 space-y-2">
          <label className="block text-sm text-ink-muted">Two-factor password (your Telegram cloud password)</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-md border border-line px-3 py-2 text-sm text-ink"
          />
          <button
            disabled={busy || !password}
            onClick={submitPassword}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-ink disabled:opacity-50"
          >
            Submit password
          </button>
        </div>
      ) : status === "connecting" ? (
        <p className="mt-4 text-sm text-ink-muted">Connecting…</p>
      ) : (
        <div className="mt-4 space-y-2">
          <label className="block text-sm text-ink-muted">Phone number (international format, e.g. +447700900000)</label>
          <input
            value={phoneNumber}
            onChange={(e) => setPhoneNumber(e.target.value)}
            placeholder="+447700900000"
            className="w-full rounded-md border border-line px-3 py-2 text-sm text-ink"
          />
          <button
            disabled={busy || !phoneNumber}
            onClick={submitPhone}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-ink disabled:opacity-50"
          >
            Log in
          </button>
          <p className="text-xs text-ink-muted">
            Requires TELEGRAM_API_ID and TELEGRAM_API_HASH to already be set as env vars on the engine.
          </p>
        </div>
      )}
    </div>
  );
}
