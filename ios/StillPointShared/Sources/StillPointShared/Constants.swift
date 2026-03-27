import Foundation

public enum StillPoint {
    /// Base session duration in seconds (Day 1)
    public static let baseDuration = 60

    /// Seconds added per day
    public static let increment = 10

    /// Visual block duration in seconds
    public static let blockDuration = 10

    /// Calculate session duration for a given day number
    public static func duration(forDay day: Int) -> Int {
        precondition(day >= 1, "Day must be >= 1")
        return baseDuration + (day - 1) * increment
    }

    /// Calculate number of blocks for a given duration
    public static func blockCount(forDuration duration: Int) -> Int {
        Int(ceil(Double(duration) / Double(blockDuration)))
    }
}
