import Foundation

/// Pure ambient sound level logic for #563.
/// Kept in StillPointShared so RMS→dBFS math and summary aggregation
/// are unit-testable without AVFoundation or AVAudioEngine.
public enum AmbientSoundLevelLogic {

    /// dBFS threshold separating "quiet" from "loud" environments.
    /// -40 dBFS is roughly a quiet office hum; anything louder is classified "loud".
    public static let quietLoudThresholdDB: Double = -40.0

    /// Silence floor dBFS applied when RMS is zero (avoids –∞).
    public static let silenceFloorDB: Double = -96.0

    // MARK: - Signal helpers

    /// Compute root-mean-square amplitude from a buffer of linear PCM samples.
    /// Returns 0 for an empty buffer.
    public static func rms(from samples: [Float]) -> Double {
        guard !samples.isEmpty else { return 0 }
        let sumOfSquares = samples.reduce(0.0 as Double) { $0 + Double($1) * Double($1) }
        return sqrt(sumOfSquares / Double(samples.count))
    }

    /// Convert a linear RMS amplitude to dBFS (0 dBFS = full scale).
    /// Clamped to `silenceFloorDB` when `rms ≤ 0`.
    public static func toDBFS(rms: Double) -> Double {
        guard rms > 0 else { return silenceFloorDB }
        return max(silenceFloorDB, 20.0 * log10(rms))
    }

    /// Returns true when `levelDB` is below the quiet/loud threshold.
    public static func isQuiet(
        levelDB: Double,
        threshold: Double = quietLoudThresholdDB
    ) -> Bool {
        levelDB < threshold
    }

    // MARK: - Accumulator

    /// Mutable accumulator that ingests per-tick dBFS levels and produces a final summary.
    /// Analogue of `AttentionTrackingLogic.SustainedState` for ambient sound.
    public struct Accumulator: Equatable, Sendable {
        public private(set) var sampleCount: Int
        private var levelSum: Double
        public private(set) var peakDB: Double
        private var quietCount: Int
        private var loudCount: Int

        public init() {
            sampleCount = 0
            levelSum = 0
            peakDB = silenceFloorDB
            quietCount = 0
            loudCount = 0
        }

        /// Record a single dBFS level reading from one audio buffer tap.
        public mutating func ingest(
            levelDB: Double,
            threshold: Double = quietLoudThresholdDB
        ) {
            sampleCount += 1
            levelSum += levelDB
            if levelDB > peakDB { peakDB = levelDB }
            if AmbientSoundLevelLogic.isQuiet(levelDB: levelDB, threshold: threshold) {
                quietCount += 1
            } else {
                loudCount += 1
            }
        }

        /// Produce the final summary. Returns `nil` when no samples have been ingested.
        public func summary() -> AmbientSoundSummary? {
            guard sampleCount > 0 else { return nil }
            let avgDB = levelSum / Double(sampleCount)
            let total = Double(sampleCount)
            let quietPercent = Int(round(Double(quietCount) / total * 100.0))
            let loudPercent = max(0, 100 - quietPercent)
            return AmbientSoundSummary(
                avgDb: avgDB,
                peakDb: peakDB,
                quietPercent: quietPercent,
                loudPercent: loudPercent,
                sampleCount: sampleCount
            )
        }
    }
}
