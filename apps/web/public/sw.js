// Service worker: shows the admin's push notifications (sent by the engine, server/push.ts) and opens the page a
// notification points to when it's tapped. Nothing is cached here.
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "GoalBrew", body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "GoalBrew", {
      body: data.body || "",
      tag: data.tag,
      renotify: Boolean(data.tag),
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { url: data.url || "/", fixPickId: data.fixPickId, muteSlice: data.muteSlice },
      // A pick not placed because Betfair spells a team differently can be fixed from the notification itself; a
      // Golden alert's slice can be muted from it.
      actions: data.fixPickId ? [{ action: "fix", title: "Add name & send" }] : data.muteSlice ? [{ action: "mute", title: "Mute these" }] : [],
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const muteSlice = event.notification.data && event.notification.data.muteSlice;
  if (event.action === "mute" && muteSlice) {
    // Switches that Golden slice's alert notifications off (signed-in cookie included); switch it back on from Golden.
    event.waitUntil(
      fetch("/api/admin/golden", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ action: "notify", strategyKey: muteSlice.strategyKey, id: muteSlice.id, on: false }),
      })
        .then((res) =>
          self.registration.showNotification(res.ok ? "Muted" : "Couldn't mute it", {
            body: res.ok ? `No more alerts for ${muteSlice.name}. Switch them back on from Golden.` : "Open Golden to switch it off there.",
            tag: "golden-mute",
            icon: "/icons/icon-192.png",
            badge: "/icons/icon-192.png",
            data: { url: "/more/admin/golden" },
          }),
        )
        .catch(() =>
          self.registration.showNotification("Couldn't mute it", { body: "No connection. Open Golden to switch it off there.", tag: "golden-mute", data: { url: "/more/admin/golden" } }),
        ),
    );
    return;
  }
  const fixPickId = event.notification.data && event.notification.data.fixPickId;
  if (event.action === "fix" && fixPickId) {
    // Adds Betfair's spelling to Match names and re-sends the bet, then says how it went (signed-in cookie included).
    event.waitUntil(
      fetch("/api/admin/betfair/unplaced/fix", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ id: fixPickId }),
      })
        .then((res) => res.json().then((b) => ({ ok: res.ok, b })))
        .then(({ ok, b }) =>
          self.registration.showNotification(ok ? "Name added" : "Couldn't fix it", {
            body: ok ? b.message || "Sent again." : b.error || "Open Sending to fix it there.",
            tag: "unplaced-fix",
            icon: "/icons/icon-192.png",
            badge: "/icons/icon-192.png",
            data: { url: "/more/admin/sending" },
          }),
        )
        .catch(() =>
          self.registration.showNotification("Couldn't fix it", {
            body: "No connection. Open Sending to fix it there.",
            tag: "unplaced-fix",
            data: { url: "/more/admin/sending" },
          }),
        ),
    );
    return;
  }
  const url = new URL((event.notification.data && event.notification.data.url) || "/", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if ("focus" in w) {
          w.navigate(url);
          return w.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
