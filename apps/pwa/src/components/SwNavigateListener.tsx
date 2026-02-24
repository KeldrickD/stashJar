"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Listens for NAVIGATE messages from the service worker (notification click).
 * When the user taps a push notification and a window is already open, the SW
 * posts this message so we navigate in-app instead of opening a new tab.
 */
export function SwNavigateListener() {
  const router = useRouter();

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const data = event.data;
      if (data?.type === "NAVIGATE" && typeof data.url === "string") {
        const raw = data.url.trim();
        if (!raw) return;
        let url = raw;
        if (raw.startsWith("http://") || raw.startsWith("https://")) {
          const parsed = new URL(raw);
          if (parsed.origin !== window.location.origin) return;
          url = `${parsed.pathname}${parsed.search}${parsed.hash}`;
        } else if (!raw.startsWith("/")) {
          url = `/${raw.replace(/^\/+/, "")}`;
        }
        router.replace(url);
      }
    };
    if (typeof navigator !== "undefined" && navigator.serviceWorker) {
      navigator.serviceWorker.addEventListener("message", handler);
      return () => navigator.serviceWorker.removeEventListener("message", handler);
    }
  }, [router]);

  return null;
}
