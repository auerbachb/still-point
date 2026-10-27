import Foundation

public enum SessionType: String, Codable, Sendable {
    case standard
    case quick
    /// Open-ended breath-counting sit. Does not advance the day counter.
    case breath
    /// #765: a timed single-focus activity (reading, writing, listening), not a
    /// meditation sit. It has its own goal (`StillPoint.focusDuration(forDay:)`,
    /// stepped by `UserDTO.focusActivityDay`) and never counts toward meditation
    /// progression, the streak or the widget rows.
    case focus
}

/// #837: what a focus session was for. A label only: every category shares the
/// one focus goal. Mirrors web `FOCUS_CATEGORIES` (`src/lib/constants.ts`).
public enum FocusCategory: String, Codable, Sendable, CaseIterable {
    case reading
    case writing
    case listening

    /// The category's name as the picker and History show it. Mirrors web
    /// `FOCUS_ACTIVITIES` (`src/lib/focusActivityContent.ts`).
    public var displayLabel: String {
        switch self {
        case .reading: return "Reading"
        case .writing: return "Writing"
        case .listening: return "Listening"
        }
    }

    /// History's label for a focus session: "Focus · Reading". A session with no
    /// category (saved before #837, or one this build does not know, which
    /// `SessionDTO` decodes as nil) reads "Focus". Mirrors web `focusSessionLabel`.
    public static func sessionLabel(for category: FocusCategory?) -> String {
        guard let category else { return "Focus" }
        return "Focus \u{00B7} \(category.displayLabel)"
    }
}

/// #765: a daily ramp — `base` seconds on day 1, `increment` more each later day,
/// held at `cap`. Mirrors web `DurationRampConfig` (`src/lib/constants.ts`).
public struct DurationRampConfig: Equatable, Sendable {
    public let base: Int
    public let increment: Int
    public let cap: Int

    public init(base: Int, increment: Int, cap: Int) {
        self.base = base
        self.increment = increment
        self.cap = cap
    }
}

/// #240: which daily progression a standard sit belongs to. `primary` is the
/// original (now 10-minute-capped) track; `second` is the opt-in track that
/// restarts at one minute and ramps +10s/day alongside it.
public enum Track: String, Codable, Sendable {
    case primary
    case second
}

/// #708: which time of day the long (primary) session is designated.
/// The short (second) track is the opposite. A label only — a sit checks its
/// designated row even when it happens at the other time of day.
public enum SessionPeriod: String, Codable, Sendable, CaseIterable, Hashable {
    case am
    case pm

    /// Widget row label. Short on purpose so the gutter does not truncate.
    public var widgetLabel: String {
        switch self {
        case .am: return "AM"
        case .pm: return "PM"
        }
    }

    /// Settings picker label for the long session.
    public var settingsLabel: String {
        switch self {
        case .am: return "Morning"
        case .pm: return "Evening"
        }
    }

    public var opposite: SessionPeriod {
        switch self {
        case .am: return .pm
        case .pm: return .am
        }
    }

    /// Period designated for `track` when the long session uses `longSession`.
    public static func period(for track: Track, longSession: SessionPeriod) -> SessionPeriod {
        switch track {
        case .primary: return longSession
        case .second: return longSession.opposite
        }
    }

    /// Dual-track widget rows, morning first, then evening.
    public static func orderedTracks(longSession: SessionPeriod) -> [Track] {
        switch longSession {
        case .am: return [.primary, .second]
        case .pm: return [.second, .primary]
        }
    }
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

    /// #765: the meditation ramp (#240) as a config: one minute, +10s a day,
    /// capped at ten minutes. Mirrors web `MEDITATION_DURATION_CONFIG`.
    public static let meditationDurationConfig = DurationRampConfig(
        base: baseDuration,
        increment: increment,
        cap: maxDuration
    )

    /// #765: the focus goal, and the single place to tune it. One minute to start,
    /// +1 minute per completed focus session, capped at two hours, with no
    /// recovery ramp. Duplicated from web `FOCUS_DURATION_CONFIG` on purpose (the
    /// platforms share no code); `shared/test-fixtures/focusDuration.json` keeps
    /// the two equal.
    public static let focusDurationConfig = DurationRampConfig(base: 60, increment: 60, cap: 7200)

    /// Seconds on `day` of a ramp. Days below 1 behave as day 1. Mirrors web
    /// `rampDurationForDay`.
    public static func rampDuration(forDay day: Int, config: DurationRampConfig) -> Int {
        min(config.cap, config.base + (max(day, 1) - 1) * config.increment)
    }

    /// Calculate session duration for a given day number.
    ///
    /// Clamps `day` to `>= 1` so production code never traps on bad upstream data
    /// (e.g. a server returning `0`). A debug-only `assert` still surfaces
    /// the upstream bug during development. #240: capped at ten minutes so both
    /// tracks hold at 10 minutes once they reach `forkDay`.
    public static func duration(forDay day: Int) -> Int {
        assert(day >= 1, "Day must be >= 1, got \(day)")
        return rampDuration(forDay: day, config: meditationDurationConfig)
    }

    /// #765: the focus goal (seconds) on a given `focusActivityDay`. Days below 1
    /// behave as day 1, as on web (`focusDurationForDay`), so unlike
    /// `duration(forDay:)` there is no debug assert.
    public static func focusDuration(forDay day: Int) -> Int {
        rampDuration(forDay: day, config: focusDurationConfig)
    }

    /// #765: only a completed focus session steps the focus goal. Mirrors web
    /// `shouldAdvanceFocusDay`.
    public static func shouldAdvanceFocusDay(sessionType: SessionType, completed: Bool) -> Bool {
        completed && sessionType == .focus
    }

    /// #765: advance the focus goal counter after a session save. One counter is
    /// shared by every focus category, with no recovery ramp and no once-a-day
    /// limit: each completed focus session bumps it by one, and anything else (an
    /// ended-early focus session, any meditation sit) leaves it unchanged. Mirrors
    /// web `advanceFocusActivityDay` and the server's `focus_activity_day` step.
    public static func advanceFocusActivityDay(sessionType: SessionType, completed: Bool, focusActivityDay: Int) -> Int {
        shouldAdvanceFocusDay(sessionType: sessionType, completed: completed) ? focusActivityDay + 1 : focusActivityDay
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

    /// For `.focus`, pass the user's `focusActivityDay` as `day`, not the
    /// meditation day: the result is the focus goal.
    public static func duration(for sessionType: SessionType, day: Int) -> Int {
        switch sessionType {
        case .quick:
            return quickDuration
        case .breath:
            // Breath sessions are open-ended; 0 is a sentinel (value unused during session).
            return 0
        case .standard:
            return duration(forDay: day)
        case .focus:
            return focusDuration(forDay: day)
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
