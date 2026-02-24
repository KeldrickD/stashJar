// Minimal service worker for Web Push. Register from app so pushManager.subscribe works.
self.addEventListener("push", (event) => {
  let data = { title: "My Stash Jar", body: "Reminder", deeplink: "/" };
  if (event.data) {
    try {
      data = { ...data, ...event.data.json() };
    } catch (_) {}
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      data: { deeplink: data.deeplink ?? "/" },
      tag: "stash-reminder",
      renotify: true,
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.deeplink ?? "/";
  const fullUrl = url.startsWith("http") ? url : new URL(url, self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const c of clientList) {
        if (c.url.startsWith(self.location.origin) && "focus" in c) {
          c.postMessage({ type: "NAVIGATE", url });
          c.focus();
          return;
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(fullUrl);
    })
  );
});
