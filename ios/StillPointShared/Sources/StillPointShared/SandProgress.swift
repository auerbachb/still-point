import Foundation

/// Sand-carrier timer progress (#662 web model, iOS port #1190).
///
/// Keep in sync with `src/lib/sandProgress.ts`, the web model this file mirrors.
/// Both implementations are checked against `shared/test-fixtures/sandProgress.json`,
/// so a change to either side fails its suite until the other side and the fixture
/// agree.
///
/// Pure logic only: no SwiftUI, no timing. `SandCarrierView` renders the state.
/// Every output derives from elapsed time, so a paused sit holds still and a
/// wall-clock jump moves the scene to the correct position.
public enum SandProgress {
    /// Sit length per carry trip, before clamping the trip count.
    public static let secondsPerTrip: Double = 60

    /// Upper bound on carry trips, so very long sits keep a calm, readable pace.
    public static let maxTrips: Int = 12

    /// Share of each trip spent carrying sand forward; the rest is the empty walk back.
    public static let carryShare: Double = 0.7

    /// Period of one walk-bob cycle, in seconds of sit time.
    public static let walkSeconds: Double = 2

    public struct State: Equatable, Sendable {
        /// Clamped 0...1 fraction of the sit that has elapsed.
        public let fraction: Double
        /// True once the full sit has elapsed (source pile empty).
        public let complete: Bool
        /// Source pile height as a 0...1 fraction of its full height.
        public let sourceFraction: Double
        /// Destination pile height as a 0...1 fraction of its full height.
        public let destinationFraction: Double
        /// Carrier position along the route: 0 at the source, 1 at the destination.
        public let carrierPosition: Double
        /// True while the carrier holds sand on its way to the destination.
        public let carrying: Bool
        /// Walk-cycle phase in [0, 1), derived from elapsed time.
        public let walkPhase: Double
    }

    /// Number of carry trips for a sit of `total` seconds. Always at least one, at
    /// most `maxTrips`. Non-finite or non-positive lengths count as one trip.
    public static func tripCount(total: Double) -> Int {
        guard total.isFinite, total > 0 else { return 1 }
        // JS Math.round for positive values: floor(x + 0.5). Swift's default
        // `.rounded()` also rounds halves up here, but spelling it out keeps the
        // parity rule visible.
        // Clamp as a Double before converting, so a huge total cannot trap on Int.
        let trips = (total / secondsPerTrip + 0.5).rounded(.down)
        return Int(min(Double(maxTrips), max(1, trips)))
    }

    /// Map elapsed sit time to the sand-carrier state.
    ///
    /// `elapsed` and `total` may be non-integers; fractional seconds are kept.
    /// Negative or non-finite elapsed values are treated as zero, and elapsed past
    /// the end clamps to a complete sit. A zero or non-finite total is a complete sit.
    public static func progress(elapsed: Double, total: Double) -> State {
        let safeTotal = total.isFinite && total > 0 ? total : 0
        let safeElapsed = elapsed.isFinite && elapsed > 0 ? elapsed : 0

        let fraction = safeTotal == 0 ? 1 : clamp01(safeElapsed / safeTotal)
        let complete = fraction >= 1

        var carrierPosition = 0.0
        var carrying = false

        if complete {
            // The sit is over and the source is empty. The carrier has just finished
            // its empty return leg, which ends at the source, so it rests there.
            carrierPosition = 0
        } else {
            let tripLength = safeTotal / Double(tripCount(total: safeTotal))
            // JS `%` on doubles matches truncatedRemainder, not Swift's integer `%`.
            let local = safeElapsed.truncatingRemainder(dividingBy: tripLength) / tripLength
            if local < carryShare {
                carrying = true
                carrierPosition = local / carryShare
            } else {
                carrierPosition = 1 - (local - carryShare) / (1 - carryShare)
            }
        }

        return State(
            fraction: fraction,
            complete: complete,
            sourceFraction: 1 - fraction,
            destinationFraction: fraction,
            carrierPosition: clamp01(carrierPosition),
            carrying: carrying,
            walkPhase: safeElapsed.truncatingRemainder(dividingBy: walkSeconds) / walkSeconds
        )
    }

    private static func clamp01(_ value: Double) -> Double {
        if value <= 0 { return 0 }
        if value >= 1 { return 1 }
        return value
    }
}
