import Combine
import CoreHaptics
import Foundation
import UIKit
import StillPointShared

/// #739: the solo sit's clock and the cues it plays.
///
/// Owns the 0.05 s timer, what the tick loop remembers between ticks, and the
/// players behind every cue. `SessionTickLogic` decides what each tick owes;
/// this type only carries it out. `SessionViewModel` holds one privately and
/// keeps the state `SessionView` reads.
///
/// Holds no reference to the view model: each tick reads the sit through
/// `tickInputs` and reports back through `onTick`.
final class SessionTimerEngine {
    /// What a tick reads from the sit. Read fresh on every tick, because bonus
    /// seconds and the sound preferences can change mid-sit.
    struct TickInputs {
        let totalSeconds: Int
        let soundPrefs: AudioEngine.SoundPrefs
        let isAbandoned: Bool
    }

    /// Returns nil while the sit is not running, which skips the tick.
    var tickInputs: (() -> TickInputs?)?
    /// Called on every tick, before that tick's cues play.
    var onTick: ((SessionTickLogic.Outcome) -> Void)?

    /// Where the clock stands: the last tick's elapsed time, or where a pause left it.
    private(set) var pausedElapsed: Double = 0
    private var startDate: Date?
    private var timer: AnyCancellable?
    private var cursor = SessionTickLogic.Cursor.fresh
    private let timerMultiplier: Double

    /// #712: the two generators behind `HapticCueLogic.Intensity`. Held for the
    /// life of the sit rather than built per cue — a generator has to be
    /// `prepare()`d to fire promptly, and one created at the moment of the
    /// marker arrives noticeably after it.
    private let gentleHaptic = UIImpactFeedbackGenerator(style: .light)
    private let pronouncedHaptic = UINotificationFeedbackGenerator()
    /// Plays beside the session audio engine. UIKit generators stay silent
    /// once that engine is running, which a normal sit does by default (#794).
    private var coreHapticEngine: CHHapticEngine?

    /// - Parameter timerMultiplier: Speeds the clock up for UI tests
    ///   (`SP_UI_TEST_TIMER_MULTIPLIER`); 1 otherwise.
    init(timerMultiplier: Double) {
        self.timerMultiplier = timerMultiplier
    }

    // MARK: - Lifecycle

    /// Starts the clock from zero, or picks it back up where a pause left it.
    func start(resuming: Bool, totalSeconds: Int, soundPrefs: AudioEngine.SoundPrefs) {
        if resuming {
            cursor = .resuming(
                at: pausedElapsed,
                totalSeconds: totalSeconds,
                hapticIntervalSeconds: soundPrefs.hapticInterval.seconds
            )
        } else {
            // Fresh session start: clear any carried timer/chime state.
            pausedElapsed = 0
            cursor = .fresh
        }

        startDate = Date().addingTimeInterval(-(pausedElapsed / timerMultiplier))
        if soundPrefs.tick || soundPrefs.chime || soundPrefs.completion || soundPrefs.voiceCountdown {
            AudioEngine.shared.warmUp()
        }
        if soundPrefs.voiceCountdown {
            AudioEngine.shared.preloadVoiceCountdown()
        }
        // #712: deliberately outside the warm-up branch above. Haptics is the
        // channel for a sitter who wants no sound, so a haptics-only sit must
        // not activate the audio session — it would duck whatever else is
        // playing for a sound we are never going to make.
        if soundPrefs.haptics {
            prepareHaptics()
        }
        timer = Timer.publish(every: 0.05, on: .main, in: .common)
            .autoconnect()
            .sink { [weak self] _ in
                self?.tick()
            }
    }

    /// Stops the clock at `elapsed`, ready for `start(resuming: true, …)`.
    func pause(at elapsed: Double) {
        pausedElapsed = elapsed
        stop()
    }

    /// Stops the clock and any voice-countdown clip still playing.
    func stop() {
        timer?.cancel()
        AudioEngine.shared.cancelVoiceCountdownPlayback()
    }

    private func tick() {
        guard let startDate, let inputs = tickInputs?() else { return }

        let outcome = SessionTickLogic.advance(
            to: Date().timeIntervalSince(startDate) * timerMultiplier,
            totalSeconds: inputs.totalSeconds,
            prefs: inputs.soundPrefs,
            isAbandoned: inputs.isAbandoned,
            cursor: cursor
        )
        cursor = outcome.cursor
        pausedElapsed = outcome.elapsed
        if outcome.completedNaturally {
            timer?.cancel()
        }
        onTick?(outcome)
        play(outcome.effects)
    }

    // MARK: - Cues

    /// Plays what one tick owes, in the order `SessionTickLogic.Effects` lists it.
    private func play(_ effects: SessionTickLogic.Effects) {
        if effects.cancelVoiceCountdown {
            AudioEngine.shared.cancelVoiceCountdownPlayback()
        }
        if let second = effects.voiceCountdownSecond {
            AudioEngine.shared.playVoiceCountdown(seconds: second)
        }
        if effects.playTick {
            AudioEngine.shared.playTick()
        }
        if effects.playChime {
            AudioEngine.shared.playChime()
        }
        if effects.playCompletion {
            AudioEngine.shared.playCompletion()
        }
        if let cue = effects.haptic {
            fireHaptic(cue)
        }
    }

    /// Carries out a mid-sit sound change worked out by `SoundToggleLogic` or
    /// `CueModeLogic`, in the order `SoundToggleLogic.Effects` documents.
    func apply(_ effects: SoundToggleLogic.Effects) {
        if effects.warmUp {
            // #667: `start(resuming:totalSeconds:soundPrefs:)` only warms the
            // engine when a sound is already on, so a sit begun with everything
            // off leaves the audio session inactive. Reactivate it here so the
            // re-enabled sound is audible at its next scheduled play point — no
            // restart required.
            AudioEngine.shared.warmUp()
        }
        if effects.preloadVoiceCountdown {
            // Voice countdown was just enabled — prime the buffer cache.
            AudioEngine.shared.preloadVoiceCountdown()
        }
        if effects.resetVoiceDedup {
            // Voice countdown was just disabled — reset dedup state so re-enabling
            // during the same remaining second announces correctly (#554).
            cursor.lastVoiceCountdownSec = 0
        }
        if effects.cancelVoiceCountdown {
            AudioEngine.shared.cancelVoiceCountdownPlayback()
        }
    }

    /// Re-counts repeating-haptic progress at `elapsed` for a new interval.
    func reseedHapticInterval(elapsed: Double, totalSeconds: Int, intervalSeconds: Int) {
        cursor.lastHapticIntervalIndex = HapticCueLogic.completedHapticIntervalIndex(
            elapsedSeconds: elapsed,
            durationSeconds: totalSeconds,
            intervalSeconds: intervalSeconds
        )
    }

    // MARK: - Haptics (#712)

    /// Primes both generators. Cheap, and an unprepared generator fires late
    /// enough that the tap no longer reads as marking the minute it belongs to.
    func prepareHaptics() {
        gentleHaptic.prepare()
        pronouncedHaptic.prepare()
        startCoreHapticsIfNeeded()
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

    /// Plays a cue at the strength `HapticCueLogic` assigns it. Core Haptics
    /// first, so a sit with sound on still vibrates. UIKit is the fallback.
    private func fireHaptic(_ cue: HapticCueLogic.Cue) {
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
