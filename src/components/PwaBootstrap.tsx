"use client";

import { useEffect, useRef } from "react";
import { initWebPwaOffline, persistOfflineOwnerUserId } from "@/lib/offlineSessionQueue/pwaBootstrap";

type PwaBootstrapProps = {
  ownerUserId: string | null;
};

/** Registers the PWA service worker and reconnect flush hooks (#558). */
export function PwaBootstrap({ ownerUserId }: PwaBootstrapProps) {
  const ownerUserIdRef = useRef(ownerUserId);
  ownerUserIdRef.current = ownerUserId;

  useEffect(() => {
    return initWebPwaOffline(() => ownerUserIdRef.current);
  }, []);

  useEffect(() => {
    void persistOfflineOwnerUserId(ownerUserId);
  }, [ownerUserId]);

  return null;
}
