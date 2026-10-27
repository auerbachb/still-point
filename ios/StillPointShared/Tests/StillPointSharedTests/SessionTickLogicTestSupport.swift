import Foundation
import Testing
@testable import StillPointShared

/// Helpers shared by the `SessionTickLogic*Tests` suites, split by concern out
/// of one `SessionTickLogicTests` (#1037), the way `WidgetDataTestSupport`
/// serves the `WidgetData*Tests` suites (#760). A suite adopts the protocol to
/// call them exactly as it did when they were its private methods, which kept
/// every moved test body unchanged.
///
/// `SessionTimerEngine` plays whatever `SessionTickLogic.advance` returns (#739),
/// so these suites pin when each cue fires, which cues the final-minute voice
/// countdown silences, and what a resume must not replay — without a timer or
/// a speaker.
protocol SessionTickLogicTestSupport {}

extension SessionTickLogicTestSupport {
    func prefs(
        tick: Bool = false,
        chime: Bool = false,
        completion: Bool = false,
        voice: Bool = false,
        haptics: Bool = false,
        interval: HapticCueLogic.Interval = .minute
    ) -> AudioEngine.SoundPrefs {
        AudioEngine.SoundPrefs(
            tick: tick,
            chime: chime,
            completion: completion,
            voiceCountdown: voice,
            haptics: haptics,
            hapticInterval: interval
        )
    }

    func cursor(
        tick: Int,
        minuteBlock: Int,
        hapticInterval: Int,
        voice: Int = 0
    ) -> SessionTickLogic.Cursor {
        SessionTickLogic.Cursor(
            lastTickSec: tick,
            lastCompletedMinuteBlockIndex: minuteBlock,
            lastHapticIntervalIndex: hapticInterval,
            lastVoiceCountdownSec: voice
        )
    }

    func advance(
        _ elapsed: Double,
        total: Int,
        prefs: AudioEngine.SoundPrefs,
        abandoned: Bool = false,
        cursor: SessionTickLogic.Cursor = .fresh
    ) -> SessionTickLogic.Outcome {
        SessionTickLogic.advance(
            to: elapsed,
            totalSeconds: total,
            prefs: prefs,
            isAbandoned: abandoned,
            cursor: cursor
        )
    }

    /// Ticks a whole sit at the timer's 0.05 s cadence until it completes, the
    /// way `SessionTimerEngine` drives it, and returns every tick's effects.
    func simulateSit(total: Int, prefs: AudioEngine.SoundPrefs) -> [SessionTickLogic.Effects] {
        var cursor = SessionTickLogic.Cursor.fresh
        var effects: [SessionTickLogic.Effects] = []
        for step in 1...(total * 20) {
            // Dividing a whole step count keeps whole seconds exact; summing
            // 0.05 would drift across the boundaries these tests count.
            let outcome = advance(Double(step) / 20, total: total, prefs: prefs, cursor: cursor)
            cursor = outcome.cursor
            effects.append(outcome.effects)
            if outcome.completedNaturally { break }
        }
        return effects
    }
}
