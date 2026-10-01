"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/Card";
import type { PushState } from "@/server/engine-client";
import { getJson } from "@/queries/fetch-json";

/** The browser's form of the server's public key. */
function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const padded = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** A name for this device in the list, from the browser's description of itself. */
function deviceLabel(): string {
  const ua = navigator.userAgent;
  const device = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : /Mac/.test(ua) ? "Mac" : "Device";
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "browser";
  return `${device} · ${browser}`;
}

async function post(body: Record<string, unknown>): Promise<{ ok?: boolean; reached?: number }> {
  const res = await fetch("/api/admin/push", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = (await res.json().catch(() => ({}))) as { error?: string; message?: string; ok?: boolean; reached?: number };
  if (!res.ok) throw new Error(json.message ?? json.error ?? `Failed (${res.status})`);
  return json;
}

type DeviceState = "checking" | "unsupported" | "needsInstall" | "blocked" | "off" | "on";

/**
 * Push notifications on this device: a sent pick that isn't placed within 3 minutes. Works in Chrome, Edge and Firefox,
 * on Android, and on an iPhone once the site is added to the Home Screen and opened from there.
 */
export function NotificationsCard() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["push"], queryFn: ({ signal }) => getJson<PushState>("/api/admin/push", "notification settings", signal) });
  const [device, setDevice] = useState<DeviceState>("checking");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      if (!("serviceWorker" in navigator) || !("Notification" in window)) {
        setDevice("unsupported");
        return;
      }
      // An iPhone only offers push to the site once it's on the Home Screen.
      if (!("PushManager" in window)) {
        setDevice(/iPhone|iPad/.test(navigator.userAgent) ? "needsInstall" : "unsupported");
        return;
      }
      if (Notification.permission === "denied") {
        setDevice("blocked");
        return;
      }
      const reg = await navigator.serviceWorker.getRegistration("/");
      const sub = await reg?.pushManager.getSubscription();
      setDevice(sub ? "on" : "off");
    })().catch(() => setDevice("unsupported"));
  }, []);

  async function turnOn() {
    if (!data) return;
    setBusy(true);
    setNote(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setDevice(permission === "denied" ? "blocked" : "off");
        return;
      }
      const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      await navigator.serviceWorker.ready;
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(data.publicKey) }));
      await post({ action: "subscribe", subscription: sub.toJSON(), label: deviceLabel() });
      setDevice("on");
      setNote("On. Use “Send a test” to check it arrives.");
      void qc.invalidateQueries({ queryKey: ["push"] });
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Could not turn notifications on.");
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    setBusy(true);
    setNote(null);
    try {
      const reg = await navigator.serviceWorker.getRegistration("/");
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await post({ action: "unsubscribe", endpoint: sub.endpoint });
        await sub.unsubscribe();
      }
      setDevice("off");
      void qc.invalidateQueries({ queryKey: ["push"] });
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Could not turn notifications off.");
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    setNote(null);
    try {
      const r = await post({ action: "test" });
      setNote(r.reached ? `Sent to ${r.reached} device${r.reached === 1 ? "" : "s"}.` : "No device took it: turn notifications on first.");
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Could not send the test.");
    } finally {
      setBusy(false);
    }
  }

  const devices = data?.devices.length ?? 0;
  const button = "rounded-md px-3 py-2 text-sm font-medium disabled:opacity-50";
  return (
    <Card
      title="Notifications"
      subtitle="A notification when a sent pick has no bet on Betfair 3 minutes later, so a betting software problem is caught on the first pick."
    >
      <p className="text-xs text-ink-muted">
        {device === "checking" && "Checking this device…"}
        {device === "unsupported" && "This browser can’t receive notifications. Use Chrome, Edge or Firefox, or the app on your phone."}
        {device === "needsInstall" && "On iPhone: tap Share → Add to Home Screen, open the app from there, then turn notifications on in it."}
        {device === "blocked" && "Notifications are blocked for this site. Allow them in the browser’s site settings, then come back."}
        {device === "off" && "Off on this device."}
        {device === "on" && <span className="text-hit">On for this device.</span>}
        {` ${devices} device${devices === 1 ? "" : "s"} set up in all.`}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {device === "off" && (
          <button type="button" onClick={() => void turnOn()} disabled={busy || !data} className={`${button} bg-accent text-accent-ink`}>
            Turn on for this device
          </button>
        )}
        {device === "on" && (
          <button type="button" onClick={() => void turnOff()} disabled={busy} className={`${button} border border-line text-ink`}>
            Turn off for this device
          </button>
        )}
        {devices > 0 && (
          <button type="button" onClick={() => void test()} disabled={busy} className={`${button} border border-line text-ink`}>
            Send a test
          </button>
        )}
      </div>
      {note && <p className="mt-2 text-xs text-ink-muted">{note}</p>}
    </Card>
  );
}
