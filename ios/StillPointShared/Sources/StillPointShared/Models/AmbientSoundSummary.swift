import Foundation

/// Summary of ambient sound level captured during a solo sit (#563).
/// Persisted as a single jsonb column on the sessions table.
/// Note: `avgDb` / `peakDb` are dBFS values — 0 dBFS is full scale, more negative is quieter.
public struct AmbientSoundSummary: Codable, Equatable, Sendable {
    /// Average sound level in dBFS over the entire sit.
    public let avgDb: Double
    /// Peak sound level in dBFS observed at any point during the sit.
    public let peakDb: Double
    /// Percentage of samples classified as "quiet" (below the quiet/loud threshold).
    public let quietPercent: Int
    /// Percentage of samples classified as "loud" (at or above the quiet/loud threshold).
    public let loudPercent: Int
    /// Total number of level readings taken during the sit.
    public let sampleCount: Int

    public init(
        avgDb: Double,
        peakDb: Double,
        quietPercent: Int,
        loudPercent: Int,
        sampleCount: Int
    ) {
        self.avgDb = avgDb
        self.peakDb = peakDb
        self.quietPercent = quietPercent
        self.loudPercent = loudPercent
        self.sampleCount = sampleCount
    }
}
