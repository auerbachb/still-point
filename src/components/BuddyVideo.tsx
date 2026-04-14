"use client";

/**
 * Daily call-object embed for buddy sessions (#105). #106 can mount this when a `roomUrl` is
 * available (from server after `createRoom`), passing each participant's display name.
 */

import {
  DailyAudio,
  DailyProvider,
  DailyVideo,
  useDaily,
  useDailyError,
  useMeetingState,
  useParticipantIds,
} from "@daily-co/daily-react";
import type { CSSProperties } from "react";
import { useCallback, useEffect, useState } from "react";

export type BuddyVideoProps = {
  /** Full Daily room URL from the REST API (`createRoom`). */
  roomUrl: string;
  /** Shown to other participants (Daily `userName`). */
  displayName: string;
  /** When true (default), joins on mount and leaves on unmount. */
  autoConnect?: boolean;
  className?: string;
  style?: CSSProperties;
};

const shell: CSSProperties = {
  width: "100%",
  borderRadius: "12px",
  overflow: "hidden",
  border: "1px solid var(--border-2)",
  background: "var(--surface-1)",
  minHeight: "200px",
};

const msg: CSSProperties = {
  margin: 0,
  padding: "var(--s4)",
  textAlign: "center",
  fontSize: "13px",
  color: "var(--fg-2)",
  lineHeight: 1.5,
};

const grid: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
  gap: "var(--s2)",
  padding: "var(--s3)",
};

function ParticipantTiles() {
  const ids = useParticipantIds({ filter: useCallback(() => true, []) });
  return (
    <div style={grid}>
      {ids.map((sessionId) => (
        <div
          key={sessionId}
          style={{
            aspectRatio: "4 / 3",
            borderRadius: "8px",
            overflow: "hidden",
            background: "var(--surface-2)",
          }}
        >
          <DailyVideo
            sessionId={sessionId}
            type="video"
            automirror
            fit="cover"
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        </div>
      ))}
    </div>
  );
}

function BuddyVideoInner({
  roomUrl,
  displayName,
  autoConnect = true,
  className,
  style,
}: BuddyVideoProps) {
  const daily = useDaily();
  const meetingState = useMeetingState();
  const { meetingError } = useDailyError();
  const [joinError, setJoinError] = useState<string | null>(null);

  useEffect(() => {
    if (!autoConnect) return;
    const url = roomUrl.trim();
    if (!url) {
      setJoinError("Missing room URL");
      return;
    }

    let cancelled = false;
    setJoinError(null);

    const run = async () => {
      if (!daily) return;
      try {
        await daily.join({ url, userName: displayName });
      } catch (e) {
        if (!cancelled) {
          setJoinError(e instanceof Error ? e.message : "Could not join the video room");
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
      void daily?.leave().catch(() => {
        /* ignore teardown errors */
      });
    };
  }, [autoConnect, roomUrl, displayName, daily]);

  if (!autoConnect) {
    return (
      <div className={className} style={{ ...shell, ...style }}>
        <p style={msg}>Video is off (autoConnect is false).</p>
      </div>
    );
  }

  const trimmedUrl = roomUrl.trim();
  if (!trimmedUrl) {
    return (
      <div className={className} style={{ ...shell, ...style }}>
        <p role="alert" style={msg}>
          A Daily room URL is required.
        </p>
      </div>
    );
  }

  if (joinError) {
    return (
      <div className={className} style={{ ...shell, ...style }}>
        <p role="alert" style={msg}>
          {joinError}
        </p>
      </div>
    );
  }

  if (meetingState === "error" && meetingError) {
    const detail =
      typeof meetingError.errorMsg === "string" && meetingError.errorMsg
        ? meetingError.errorMsg
        : "Video call error";
    return (
      <div className={className} style={{ ...shell, ...style }}>
        <p role="alert" style={msg}>
          {detail}
        </p>
      </div>
    );
  }

  if (
    meetingState === "new" ||
    meetingState === "loading" ||
    meetingState === "loaded" ||
    meetingState === "joining-meeting" ||
    meetingState === null
  ) {
    return (
      <div className={className} style={{ ...shell, ...style }}>
        <p style={msg}>Connecting to video…</p>
      </div>
    );
  }

  if (meetingState === "left-meeting") {
    return (
      <div className={className} style={{ ...shell, ...style }}>
        <p style={msg}>Video disconnected.</p>
      </div>
    );
  }

  if (meetingState === "joined-meeting") {
    return (
      <div className={className} style={{ ...shell, ...style }}>
        <DailyAudio />
        <ParticipantTiles />
      </div>
    );
  }

  return (
    <div className={className} style={{ ...shell, ...style }}>
      <p style={msg}>Video unavailable.</p>
    </div>
  );
}

export function BuddyVideo(props: BuddyVideoProps) {
  return (
    <DailyProvider>
      <BuddyVideoInner {...props} />
    </DailyProvider>
  );
}
