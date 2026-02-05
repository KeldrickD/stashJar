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
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const c of clientList) {
        if (c.url.includes(self.location.origin) && "focus" in c) {
          c.navigate(url);
          return c.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
