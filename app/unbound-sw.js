"use strict";

const UNBOUND_SW_VERSION = "v1.00";

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      caches.keys().then((names) =>
        Promise.all(
          names
            .filter((name) => String(name || "").startsWith("unbound-"))
            .map((name) => caches.delete(name))
        )
      )
    ])
  );
});

// Intentionally no fetch handler.
// UNBOUND AI does not cache chats, API responses, authentication state,
// account pages, uploaded files, or other private content for offline use.

self.addEventListener("message", (event) => {
  if (event?.data?.type === "UNBOUND_SW_VERSION" && event.source) {
    event.source.postMessage({
      type: "UNBOUND_SW_VERSION",
      version: UNBOUND_SW_VERSION,
      offlineCaching: false
    });
  }
});
