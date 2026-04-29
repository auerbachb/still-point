import Foundation

public enum SessionType: String, Codable, Sendable {
    case standard
    case quick
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

    /// Calculate session duration for a given day number.
    ///
    /// Clamps `day` to `>= 1` so production code never traps on bad upstream data
    /// (e.g. a server returning `0`). A debug-only `assert` still surfaces
    /// the upstream bug during development.
    public static func duration(forDay day: Int) -> Int {
        assert(day >= 1, "Day must be >= 1, got \(day)")
        let safeDay = max(day, 1)
        return baseDuration + (safeDay - 1) * increment
    }

    public static func duration(for sessionType: SessionType, day: Int) -> Int {
        sessionType == .quick ? quickDuration : duration(forDay: day)
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
