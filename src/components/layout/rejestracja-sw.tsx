"use client";

import { useEffect } from "react";

/** Rejestruje service worker PWA (public/sw.js): tylko strona offline, bez danych (etap 4). */
export function RejestracjaSw() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((e: unknown) => {
      console.warn("[pwa] service worker nie zarejestrowany:", e);
    });
  }, []);
  return null;
}
