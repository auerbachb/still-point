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
    /// #712: the generators behind `HapticCueLogic.Intensity`, per
    /// `HapticPlayback.fallback(for:)`. Held for the owner's life rather than
    /// built per cue — a generator has to be `prepare()`d to fire promptly, and
    /// one created at the moment of the marker arrives noticeably after it.
    /// #1175: the every-second pulse makes per-fire allocation a real cost too.
    private let lightHaptic = UIImpactFeedbackGenerator(style: .light)
    private let heavyHaptic = UIImpactFeedbackGenerator(style: .heavy)
    private let notificationHaptic = UINotificationFeedbackGenerator()
    private let isAutoShutdownEnabled: Bool
    private var coreHapticEngine: CHHapticEngine?
    /// #1175: built once per strength, not per cue, so an every-second pulse
    /// does not rebuild the same pattern sixty times a minute.
    private var patternCache: [HapticCueLogic.Intensity: CHHapticPattern] = [:]

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
        lightHaptic.prepare()
        heavyHaptic.prepare()
        notificationHaptic.prepare()
        startCoreHapticsIfNeeded()
    }

    /// Plays a cue at the strength `HapticCueLogic` assigns it. Core Haptics
    /// first, so a sit with sound on still vibrates. UIKit is the fallback.
    func fire(_ cue: HapticCueLogic.Cue) {
        if coreHapticEngine == nil {
            startCoreHapticsIfNeeded()
        }
        let intensity = HapticCueLogic.intensity(for: cue)
        if playCoreHaptic(intensity) { return }
        switch HapticPlayback.fallback(for: intensity) {
        case .lightImpact:
            lightHaptic.impactOccurred()
            lightHaptic.prepare()
        case .heavyImpact:
            heavyHaptic.impactOccurred()
            heavyHaptic.prepare()
        case .successNotification:
            notificationHaptic.notificationOccurred(.success)
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

    private func playCoreHaptic(_ intensity: HapticCueLogic.Intensity) -> Bool {
        guard let coreHapticEngine,
              let pattern = try? pattern(for: intensity)
        else { return false }
        do {
            try coreHapticEngine.start()
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

    /// The cached pattern for `intensity`, built on first use. Patterns are
    /// engine-independent, so a rebuilt engine reuses them.
    private func pattern(for intensity: HapticCueLogic.Intensity) throws -> CHHapticPattern {
        if let cached = patternCache[intensity] { return cached }
        let events = HapticPlayback.events(for: intensity).map { spec -> CHHapticEvent in
            let parameters = [
                CHHapticEventParameter(parameterID: .hapticIntensity, value: spec.intensity),
                CHHapticEventParameter(parameterID: .hapticSharpness, value: spec.sharpness),
            ]
            switch spec.kind {
            case .transient:
                return CHHapticEvent(
                    eventType: .hapticTransient,
                    parameters: parameters,
                    relativeTime: spec.relativeTime
                )
            case .continuous(let duration):
                return CHHapticEvent(
                    eventType: .hapticContinuous,
                    parameters: parameters,
                    relativeTime: spec.relativeTime,
                    duration: duration
                )
            }
        }
        let pattern = try CHHapticPattern(events: events, parameters: [])
        patternCache[intensity] = pattern
        return pattern
    }
}
