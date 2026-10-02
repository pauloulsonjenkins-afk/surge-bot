// Service worker: shows the admin's push notifications (sent by the engine, server/push.ts) and opens the page a
// notification points to when it's tapped. Nothing is cached here.
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "Goal Brewing Alerts", body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "Goal Brewing Alerts", {
      body: data.body || "",
      tag: data.tag,
      renotify: Boolean(data.tag),
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { url: data.url || "/", fixPickId: data.fixPickId },
      // A pick not placed because Betfair spells a team differently can be fixed from the notification itself.
      actions: data.fixPickId ? [{ action: "fix", title: "Add name & send" }] : [],
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
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
