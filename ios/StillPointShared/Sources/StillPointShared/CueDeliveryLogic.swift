import Foundation

/// #1176: a sit's sounds play on time or not at all.
///
/// A haptic-mode sit with the bell on rang one late, odd-sounding chime. Two
/// paths could produce it, and this type holds the rules that close both:
///
/// - **The tick loop owed a bell long after its minute.** The solo clock reads
///   wall time, so when the app is suspended (screen locked in a sit with no
///   continuous sound — haptic mode keeps no audio playing to hold the app
///   awake) the first tick back jumps past one or more minute boundaries.
///   `SessionTickLogic.chimeStep` used to strike for the newest one regardless
///   of how long ago it passed. `isOnTime(dueAt:now:)` drops it.
/// - **A synthesized sound rendered long after it was asked for.** The engine
///   pulls a source node only while it runs. A node attached while the engine
///   could not run (start failed, paused by backgrounding) stayed attached
///   until a cleanup timer on a clock that stops while the device sleeps, so a
///   later `engine.start()` could play it — from the top, or from the middle
///   of its decay. `shouldRenderSynthesizedCue` silences it instead.
///
/// Pure, so `swift test` holds it on macOS; `AudioEngine` needs a device.
public enum CueDeliveryLogic {

    /// How late a sound may still play. Above a 0.05 s solo tick and web's 1 Hz
    /// background-tab throttling, well under the minute between bells — late
    /// enough to be noticed as a separate event is too late to mark its minute.
    public static let maxLatenessSeconds: Double = 1.5

    /// Seconds into the sit at which the bell for `completedBlockIndex` is due:
    /// the end of that minute block.
    public static func minuteBellDueAt(completedBlockIndex: Int) -> Double {
        Double(completedBlockIndex + 1) * 60
    }

    /// Whether a cue due at `dueAt` may still play at `now` (both in seconds on
    /// the same clock). A cue more than `maxLatenessSeconds` late is dropped.
    public static func isOnTime(dueAt: Double, now: Double) -> Bool {
        now - dueAt <= maxLatenessSeconds
    }

    /// Whether a synthesized sound may render audio on this render callback.
    ///
    /// - Parameters:
    ///   - requestedAtNanos: When the sound was asked for, on a monotonic
    ///     clock that keeps counting while the device sleeps.
    ///   - nowNanos: The same clock, read in the render callback.
    ///   - hasStarted: Whether earlier callbacks already rendered some of it.
    ///   - durationSeconds: The sound's length.
    ///
    /// A sound that has not started may begin only within `maxLatenessSeconds`
    /// of the request. One that has started may finish only within its own
    /// length plus that budget, so a strike the engine paused mid-decay never
    /// resumes minutes later as a headless fragment.
    public static func shouldRenderSynthesizedCue(
        requestedAtNanos: UInt64,
        nowNanos: UInt64,
        hasStarted: Bool,
        durationSeconds: Double
    ) -> Bool {
        // A clock read before the request (should not happen on a monotonic
        // clock) counts as on time rather than silencing the sound.
        guard nowNanos > requestedAtNanos else { return true }
        let elapsed = Double(nowNanos - requestedAtNanos) / 1_000_000_000
        let budget = hasStarted ? durationSeconds + maxLatenessSeconds : maxLatenessSeconds
        return elapsed <= budget
    }

    /// Whether the main mixer's sample rate matches the hardware's.
    ///
    /// An engine that stopped across a route or hardware change can keep the
    /// old rate until it is rebuilt; a sound synthesized at that rate plays on
    /// the new hardware off-pitch or distorted. An unknown rate (0 — inactive
    /// session) is not a mismatch: `AudioRecoveryLogic.isUsableRenderFormat`
    /// owns that case.
    public static func renderFormatMatchesHardware(
        mixerSampleRate: Double,
        hardwareSampleRate: Double
    ) -> Bool {
        guard mixerSampleRate > 0, hardwareSampleRate > 0 else { return true }
        return abs(mixerSampleRate - hardwareSampleRate) < 1
    }
}
