"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { LockedFeature } from "@/components/members/ui";
import { useMembersAction, useMembersAlerts, useMembersMe } from "@/queries/use-members";
import { currentSubscription, deviceLabel, deviceState, subscribeDevice, type DeviceState } from "@/lib/push-device";

/**
 * App alerts: choose up to 2 strategies and get a notification on this phone or browser for each of their alerts, with
 * the match, the bet and the price. Information only: nothing is bet.
 */
export function AppAlertsCard() {
  const me = useMembersMe();
  const { data, isLoading } = useMembersAlerts();
  const choose = useMembersAction<{ keys: string[] }>("alerts/choose");
  const addDevice = useMembersAction("alerts/device");
  const removeDevice = useMembersAction("alerts/device/remove");
  const test = useMembersAction<Record<string, never>, { reached?: number }>("alerts/test");
  const [device, setDevice] = useState<DeviceState>("checking");
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const s = await deviceState();
      setDevice(s);
      if (s === "on") setEndpoint((await currentSubscription())?.endpoint ?? null);
    })().catch(() => setDevice("unsupported"));
  }, []);

  if (isLoading || !data) return <Skeleton className="h-40 w-full" />;
  const a = data.alerts;
  if (a.locked) {
    return <LockedFeature me={me.data} feature="app_alerts" title="App alerts" pitch="Pick 2 strategies and get a notification on your phone the moment one of them alerts: the match, the bet and the price." />;
  }

  // The browser may already be subscribed (for another account on this device): "on" here means on for THIS member.
  const onHere = device === "on" && endpoint !== null && a.devices.some((d) => d.endpoint === endpoint);
  const busy = choose.isPending || addDevice.isPending || removeDevice.isPending || test.isPending;

  function toggle(key: string) {
    setNote(null);
    const next = a.chosen.includes(key) ? a.chosen.filter((k) => k !== key) : [...a.chosen, key];
    if (next.length > a.max) return setNote(`Choose up to ${a.max}. Untick one first.`);
    choose.mutate({ keys: next }, { onError: (e) => setNote(e.message) });
  }

  async function turnOn() {
    setNote(null);
    try {
      const sub = await subscribeDevice(a.publicKey);
      if (!sub) {
        setDevice(Notification.permission === "denied" ? "blocked" : "off");
        return;
      }
      await addDevice.mutateAsync({ subscription: sub.toJSON(), label: deviceLabel() });
      setDevice("on");
      setEndpoint(sub.endpoint);
      setNote("On. Use “Send a test” to check it arrives.");
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Could not turn notifications on.");
    }
  }

  async function turnOff() {
    setNote(null);
    // Only this account's link to the device is removed: the browser's subscription may serve another account here.
    if (endpoint) await removeDevice.mutateAsync({ endpoint }).catch((e: Error) => setNote(e.message));
  }

  const button = "rounded-md px-3 py-2 text-sm font-medium disabled:opacity-50";
  return (
    <Card title="App alerts" subtitle={`Choose up to ${a.max} strategies. Each time one alerts, you get a notification with the match, the bet and the price. Alerts only: nothing is bet for you.`}>
      {a.options.length === 0 ? (
        <p className="text-sm text-ink-muted">No strategies to choose from yet.</p>
      ) : (
        <ul className="grid gap-1.5 sm:grid-cols-2">
          {a.options.map((o) => {
            const on = a.chosen.includes(o.key);
            return (
              <li key={o.key}>
                <label className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm ${on ? "border-accent bg-accent/10 text-ink" : "border-line text-ink"}`}>
                  <input type="checkbox" checked={on} disabled={busy || (!on && a.chosen.length >= a.max)} onChange={() => toggle(o.key)} />
                  {o.name}
                </label>
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-2 text-xs text-ink-muted">
        {a.chosen.length} of {a.max} chosen.
      </p>

      <div className="mt-4 border-t border-line pt-3">
        <p className="text-xs text-ink-muted">
          {device === "checking" && "Checking this device…"}
          {device === "unsupported" && "This browser can’t receive notifications. Use Chrome, Edge or Firefox, or the app on your phone."}
          {device === "needsInstall" && "On iPhone: tap Share → Add to Home Screen, open GoalBrew from there, then turn notifications on in it."}
          {device === "blocked" && "Notifications are blocked for this site. Allow them in the browser’s site settings, then come back."}
          {(device === "off" || (device === "on" && !onHere)) && "Notifications are off on this device."}
          {onHere && <span className="text-hit">Notifications are on for this device.</span>}
          {` ${a.devices.length} device${a.devices.length === 1 ? "" : "s"} set up in all.`}
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {(device === "off" || (device === "on" && !onHere)) && (
            <button type="button" onClick={() => void turnOn()} disabled={busy} className={`${button} bg-accent text-accent-ink`}>
              Turn on for this device
            </button>
          )}
          {onHere && (
            <button type="button" onClick={() => void turnOff()} disabled={busy} className={`${button} border border-line text-ink`}>
              Turn off for this device
            </button>
          )}
          {a.devices.length > 0 && (
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                test.mutate({}, { onSuccess: (r) => setNote(r.reached ? `Sent to ${r.reached} device${r.reached === 1 ? "" : "s"}.` : "No device took it: turn notifications on first."), onError: (e) => setNote(e.message) })
              }
              className={`${button} border border-line text-ink`}
            >
              Send a test
            </button>
          )}
        </div>
        {note && <p className="mt-2 text-xs text-ink-muted">{note}</p>}
      </div>
    </Card>
  );
}
