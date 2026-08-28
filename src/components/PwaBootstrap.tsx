"use client";

import { useEffect, useRef } from "react";
import { initWebPwaOffline, persistOfflineOwnerUserId } from "@/lib/offlineSessionQueue/pwaBootstrap";

type PwaBootstrapProps = {
  ownerUserId: string | null;
  /**
   * #666: called after a reconnect flush actually uploaded a queued sit, so the
   * caller can re-read the user. Held in a ref like `ownerUserId` because the
   * listeners are registered exactly once — a prop identity change must not tear
   * down and re-register the service-worker wiring.
   */
  onSynced?: () => void;
};

/** Registers the PWA service worker and reconnect flush hooks (#558). */
export function PwaBootstrap({ ownerUserId, onSynced }: PwaBootstrapProps) {
  const ownerUserIdRef = useRef(ownerUserId);
  ownerUserIdRef.current = ownerUserId;
  const onSyncedRef = useRef(onSynced);
  onSyncedRef.current = onSynced;

  useEffect(() => {
    return initWebPwaOffline(
      () => ownerUserIdRef.current,
      () => onSyncedRef.current?.(),
    );
  }, []);

  useEffect(() => {
    void persistOfflineOwnerUserId(ownerUserId);
  }, [ownerUserId]);

  return null;
}
