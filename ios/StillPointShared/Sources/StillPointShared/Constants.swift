import Foundation

public enum SessionType: String, Codable, Sendable {
    case standard
    case quick
    /// Open-ended breath-counting sit. Does not advance the day counter.
    case breath
}

/// #240: which daily progression a standard sit belongs to. `primary` is the
/// original (now 10-minute-capped) track; `second` is the opt-in track that
/// restarts at one minute and ramps +10s/day alongside it.
public enum Track: String, Codable, Sendable {
    case primary
    case second
}

public enum StillPoint {
    /// Base session duration in seconds (Day 1)
    public static let baseDuration = 60

    /// Fixed duration in seconds for quick-minute sits.
    public static let quickDuration = 60

    /// Seconds added per day
    public static let increment = 10

    /// Visual block duration in seconds
    public static let blockDuration = 10

    /// #240: a standard sit tops out at ten minutes. The primary track reaches
    /// this cap on `forkDay` and then holds steady — the "10-minute track" the
    /// dual-track fork keeps while a second track ramps up alongside it.
    public static let maxDuration = 600

    /// #240: the day a standard sit first reaches the 10-minute cap
    /// (60 + 54·10 = 600). Derived so it stays correct if the constants change.
    public static let forkDay = (maxDuration - baseDuration) / increment + 1

    /// Calculate session duration for a given day number.
    ///
    /// Clamps `day` to `>= 1` so production code never traps on bad upstream data
    /// (e.g. a server returning `0`). A debug-only `assert` still surfaces
    /// the upstream bug during development. #240: capped at ten minutes so both
    /// tracks hold at 10 minutes once they reach `forkDay`.
    public static func duration(forDay day: Int) -> Int {
        assert(day >= 1, "Day must be >= 1, got \(day)")
        let safeDay = max(day, 1)
        return min(maxDuration, baseDuration + (safeDay - 1) * increment)
    }

    /// #240: once the primary track has passed the 10-minute mark
    /// (`currentDay > forkDay`, i.e. the day-55 ten-minute sit is behind them)
    /// the user may opt into a second daily track.
    public static func isDualTrackEligible(currentDay: Int) -> Bool {
        currentDay > forkDay
    }

    /// #240: advance the independent second-track counter after a session save.
    /// The second track has no recovery ramp: a completed standard sit bumps it
    /// by one; anything else leaves it unchanged.
    public static func advanceSecondTrackDay(sessionType: SessionType, completed: Bool, secondTrackDay: Int) -> Int {
        shouldAdvanceDay(sessionType: sessionType, completed: completed) ? secondTrackDay + 1 : secondTrackDay
    }

    public static func duration(for sessionType: SessionType, day: Int) -> Int {
        switch sessionType {
        case .quick:
            return quickDuration
        case .breath:
            // Breath sessions are open-ended; 0 is a sentinel (value unused during session).
            return 0
        case .standard:
            return duration(forDay: day)
        }
    }

    public static func shouldAdvanceDay(sessionType: SessionType, completed: Bool) -> Bool {
        completed && sessionType == .standard
    }

    /// Calculate number of blocks for a given duration
    public static func blockCount(forDuration duration: Int) -> Int {
        Int(ceil(Double(duration) / Double(blockDuration)))
    }

    /// Resolve the effective `currentDay` for the UI, clamped to `>= 1`.
    ///
    /// The server can transiently return `0` or a negative `currentDay`; both
    /// would otherwise propagate into `duration(forDay:)` and crash callers.
    /// `nil` (no signed-in user) defaults to day 1.
    public static func clampedCurrentDay(for user: UserDTO?) -> Int {
        max(user?.currentDay ?? 1, 1)
    }
}
