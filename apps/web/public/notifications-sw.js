self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const hasVisibleClient = clients.some(
        (client) =>
          "visibilityState" in client &&
          typeof client.visibilityState === "string" &&
          client.visibilityState === "visible",
      );
      if (hasVisibleClient) {
        return;
      }

      const payload = event.data?.json() ?? {};
      const title =
        typeof payload.title === "string" && payload.title.length > 0
          ? payload.title
          : "Turn complete";
      const options = payload.options && typeof payload.options === "object" ? payload.options : {};
      return self.registration.showNotification(title, options);
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const targetUrl = event.notification?.data?.url;
  if (!targetUrl) {
    return;
  }

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const absoluteTargetUrl = new URL(targetUrl, self.location.origin).href;

      for (const client of clients) {
        if (!("focus" in client)) {
          continue;
        }
        if ("navigate" in client) {
          return client
            .navigate(absoluteTargetUrl)
            .then((navigatedClient) => (navigatedClient ?? client).focus());
        }
        return client.focus();
      }

      return self.clients.openWindow(absoluteTargetUrl);
    }),
  );
});
