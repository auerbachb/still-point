import CoreHaptics
import UIKit
import StillPointShared

/// #849: plays a sit's haptic cues. The one player behind the solo sit
/// (`SessionTimerEngine`) and the Buddy sit (`BuddySessionViewModel`).
///
/// `HapticCueLogic` decides when a cue is owed and how strong it is, and
/// `HapticPlayback` how each strength feels. This type only vibrates the phone:
/// Core Haptics first, because it plays beside the session audio engine and
/// UIKit generators stay silent once that engine is running (#794). The UIKit
/// generators are the fallback on hardware without Core Haptics.
///
/// The solo and Buddy copies this replaced differed in two ways. Each owner
/// keeps its own choice until it is decided whether the difference is
/// intended or drift:
///
/// - **Auto-shutdown:** `init(isAutoShutdownEnabled:)`. Buddy turns it on.
///   Solo keeps the framework default, which is off.
/// - **Stopping when haptics are turned off mid-sit:** `stop()`. Buddy calls
///   it. Solo never does, so its engine stays up for the whole sit.
///
/// No actor isolation, like `SessionTimerEngine`. Both owners call it on the
/// main thread, and the engine's reset handler hops back to main.
final class HapticCuePlayer {
    /// #712: the two generators behind `HapticCueLogic.Intensity`. Held for the
    /// owner's life rather than built per cue — a generator has to be
    /// `prepare()`d to fire promptly, and one created at the moment of the
    /// marker arrives noticeably after it.
    private let gentleHaptic = UIImpactFeedbackGenerator(style: .light)
    private let pronouncedHaptic = UINotificationFeedbackGenerator()
    private let isAutoShutdownEnabled: Bool
    private var coreHapticEngine: CHHapticEngine?

    /// - Parameter isAutoShutdownEnabled: Lets Core Haptics stop the engine's
    ///   hardware while it sits idle between cues. No default, so each owner
    ///   states its choice.
    init(isAutoShutdownEnabled: Bool) {
        self.isAutoShutdownEnabled = isAutoShutdownEnabled
    }

    /// Primes both generators and starts the engine. Cheap, and an unprepared
    /// generator fires late enough that the tap no longer reads as marking the
    /// minute it belongs to.
    func prepare() {
        gentleHaptic.prepare()
        pronouncedHaptic.prepare()
        startCoreHapticsIfNeeded()
    }

    /// Plays a cue at the strength `HapticCueLogic` assigns it. Core Haptics
    /// first, so a sit with sound on still vibrates. UIKit is the fallback.
    func fire(_ cue: HapticCueLogic.Cue) {
        if coreHapticEngine == nil {
            startCoreHapticsIfNeeded()
        }
        if playCoreHaptic(cue) { return }
        switch HapticCueLogic.intensity(for: cue) {
        case .gentle:
            gentleHaptic.impactOccurred()
            gentleHaptic.prepare()
        case .pronounced:
            pronouncedHaptic.notificationOccurred(.success)
        }
    }

    /// Stops and drops the engine. The next `prepare()` or cue builds a new one.
    func stop() {
        coreHapticEngine?.stop(completionHandler: nil)
        coreHapticEngine = nil
    }

    private func startCoreHapticsIfNeeded() {
        guard HapticPlayback.prefersCoreHaptics(
            hardwareSupportsCoreHaptics: CHHapticEngine.capabilitiesForHardware().supportsHaptics
        ) else { return }
        if let coreHapticEngine {
            try? coreHapticEngine.start()
            return
        }
        do {
            let engine = try CHHapticEngine()
            engine.playsHapticsOnly = true
            // Off is the framework default, so an owner passing false gets the
            // engine it had before this player existed.
            engine.isAutoShutdownEnabled = isAutoShutdownEnabled
            engine.resetHandler = { [weak self] in
                DispatchQueue.main.async {
                    try? self?.coreHapticEngine?.start()
                }
            }
            try engine.start()
            coreHapticEngine = engine
        } catch {
            coreHapticEngine = nil
        }
    }

    private func playCoreHaptic(_ cue: HapticCueLogic.Cue) -> Bool {
        guard let coreHapticEngine else { return false }
        let events = HapticPlayback.transients(for: HapticCueLogic.intensity(for: cue)).map { tap in
            CHHapticEvent(
                eventType: .hapticTransient,
                parameters: [
                    CHHapticEventParameter(parameterID: .hapticIntensity, value: tap.intensity),
                    CHHapticEventParameter(parameterID: .hapticSharpness, value: tap.sharpness),
                ],
                relativeTime: tap.relativeTime
            )
        }
        do {
            try coreHapticEngine.start()
            let pattern = try CHHapticPattern(events: events, parameters: [])
            let player = try coreHapticEngine.makePlayer(with: pattern)
            try player.start(atTime: CHHapticTimeImmediate)
            return true
        } catch {
            // A failed start leaves a dead engine. Clear the stored property,
            // not the `guard let` binding, so the next cue can build another.
            self.coreHapticEngine = nil
            return false
        }
    }
}
