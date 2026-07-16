"use client";

import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";

/**
 * Offline indicator (spec Edge Case): shown when the browser loses its
 * connection. Cached data keeps rendering; search and AI need a connection.
 */
export function OfflineBanner() {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    setOffline(!navigator.onLine);
    const goOffline = () => setOffline(true);
    const goOnline = () => setOffline(false);
    window.addEventListener("offline", goOffline);
    window.addEventListener("online", goOnline);
    return () => {
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online", goOnline);
    };
  }, []);

  if (!offline) return null;

  return (
    <div
      role="status"
      className="flex items-center justify-center gap-2 bg-amber-500/15 px-4 py-1.5 text-sm text-amber-700 dark:text-amber-400"
    >
      <WifiOff className="h-4 w-4" aria-hidden />
      You&apos;re offline — showing saved data. Search and AI need a
      connection.
    </div>
  );
}
