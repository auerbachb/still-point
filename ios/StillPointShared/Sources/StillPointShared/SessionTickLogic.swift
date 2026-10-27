import Foundation

/// #739 — what one tick of a solo sit owes, decided without playing anything.
///
/// The solo timer ticks every 0.05 s. Each tick either ends the sit or works
/// out which of the voice countdown, the tick, the minute bell and the
/// repeating haptic are due, and which of them the final-minute voice
/// countdown silences. Those rules live here so `swift test` can hold them;
/// the app target's `SessionTimerEngine` only plays what a tick returns.
///
/// Each cue keeps its own rule in its own helper — `SessionLogic` for the
/// minute blocks, `VoiceCountdownLogic`, `HapticCueLogic` — and this type only
/// composes them, in the order the tick loop has always applied them.
///
/// Whether a sit may start, resume or end at all is not a tick's question;
/// those gates live in `SessionLifecycleLogic` (#1024).
///
/// Free of UIKit / AVFoundation so it compiles and runs under `swift test` on macOS.
public enum SessionTickLogic {

    /// What the tick loop remembers between ticks, so each cue fires once.
    public struct Cursor: Equatable, Sendable {
        /// Highest whole elapsed second that has already owed a tick. Moves
        /// only while the tick sound is on.
        public var lastTickSec: Int
        /// Highest completed minute block, or -1 before the first. Moves
        /// whether or not the bell is on, so unmuting never replays a strike.
        public var lastCompletedMinuteBlockIndex: Int
        /// Completed repeating-haptic intervals. Independent of the minute blocks.
        public var lastHapticIntervalIndex: Int
        /// #554: last second announced via voice countdown; 0 means none yet
        /// this window.
        public var lastVoiceCountdownSec: Int

        public init(
            lastTickSec: Int,
            lastCompletedMinuteBlockIndex: Int,
            lastHapticIntervalIndex: Int,
            lastVoiceCountdownSec: Int
        ) {
            self.lastTickSec = lastTickSec
            self.lastCompletedMinuteBlockIndex = lastCompletedMinuteBlockIndex
            self.lastHapticIntervalIndex = lastHapticIntervalIndex
            self.lastVoiceCountdownSec = lastVoiceCountdownSec
        }

        /// A sit that has not begun: nothing is owed yet.
        public static let fresh = Cursor(
            lastTickSec: 0,
            lastCompletedMinuteBlockIndex: -1,
            lastHapticIntervalIndex: 0,
            lastVoiceCountdownSec: 0
        )

        /// Picks a paused sit back up without replaying a cue it already played.
        ///
        /// The voice countdown alone starts over, so a resume inside the final
        /// minute announces the current second again.
        public static func resuming(
            at elapsed: Double,
            totalSeconds: Int,
            hapticIntervalSeconds: Int
        ) -> Cursor {
            Cursor(
                lastTickSec: Int(floor(elapsed)),
                lastCompletedMinuteBlockIndex: SessionLogic.completedMinuteBlockIndex(
                    elapsed: elapsed,
                    totalSeconds: totalSeconds
                ),
                lastHapticIntervalIndex: HapticCueLogic.completedHapticIntervalIndex(
                    elapsedSeconds: elapsed,
                    durationSeconds: totalSeconds,
                    intervalSeconds: hapticIntervalSeconds
                ),
                lastVoiceCountdownSec: 0
            )
        }
    }

    /// The side effects one tick owes, listed in the order they are carried out.
    public struct Effects: Equatable, Sendable {
        /// Stop the in-flight voice-countdown clip.
        public let cancelVoiceCountdown: Bool
        /// Speak this second of the final-minute countdown.
        public let voiceCountdownSecond: Int?
        public let playTick: Bool
        public let playChime: Bool
        public let playCompletion: Bool
        /// The vibration this tick owes, if any.
        public let haptic: HapticCueLogic.Cue?
    }

    /// One tick's result: where the clock stands, what to remember, what to play.
    public struct Outcome: Equatable, Sendable {
        /// Elapsed seconds to show. Clamped to the duration on the tick that
        /// ends the sit.
        public let elapsed: Double
        /// The timer ran out on this tick, so the sit completed naturally.
        public let completedNaturally: Bool
        /// Unchanged on the completing tick, which owes none of the running cues.
        public let cursor: Cursor
        public let effects: Effects
    }

    /// Advances the sit to `elapsed` and returns what that tick owes.
    ///
    /// - Parameters:
    ///   - elapsed: Seconds since the sit began, as read from the clock.
    ///   - totalSeconds: Planned plus bonus seconds. Pass it fresh on every
    ///     tick, because a bonus can be added mid-sit.
    ///   - prefs: The sound preferences in force on this tick.
    ///   - isAbandoned: The sitter discarded the sit; no haptic fires after.
    ///   - cursor: What earlier ticks already played.
    public static func advance(
        to elapsed: Double,
        totalSeconds: Int,
        prefs: AudioEngine.SoundPrefs,
        isAbandoned: Bool,
        cursor: Cursor
    ) -> Outcome {
        if elapsed >= Double(totalSeconds) {
            return completingOutcome(totalSeconds: totalSeconds, prefs: prefs, isAbandoned: isAbandoned, cursor: cursor)
        }

        var next = cursor
        let remaining = max(0.0, Double(totalSeconds) - elapsed)
        let voiceActive = prefs.voiceCountdown && VoiceCountdownLogic.isActive(remaining: remaining)

        // Each step reads and moves only its own field of `next`, so their
        // order matters only for the order `Effects` lists the cues in.
        let voice = voiceCountdownStep(remaining: remaining, prefs: prefs, cursor: &next)
        let playTick = tickStep(elapsed: elapsed, prefs: prefs, voiceActive: voiceActive, cursor: &next)
        let playChime = chimeStep(
            elapsed: elapsed,
            totalSeconds: totalSeconds,
            prefs: prefs,
            voiceActive: voiceActive,
            cursor: &next
        )
        let haptic = hapticStep(
            elapsed: elapsed,
            totalSeconds: totalSeconds,
            prefs: prefs,
            isAbandoned: isAbandoned,
            cursor: &next
        )

        return Outcome(
            elapsed: elapsed,
            completedNaturally: false,
            cursor: next,
            effects: Effects(
                cancelVoiceCountdown: voice.cancel,
                voiceCountdownSecond: voice.second,
                playTick: playTick,
                playChime: playChime,
                playCompletion: false,
                haptic: haptic
            )
        )
    }

    // MARK: - One rule per cue

    /// The tick that ends the sit: it owes the completion cues and none of the
    /// running ones, and leaves the cursor where it was.
    private static func completingOutcome(
        totalSeconds: Int,
        prefs: AudioEngine.SoundPrefs,
        isAbandoned: Bool,
        cursor: Cursor
    ) -> Outcome {
        Outcome(
            elapsed: Double(totalSeconds),
            completedNaturally: true,
            cursor: cursor,
            effects: Effects(
                // Cancel any in-flight voice countdown clip before the completion cue.
                cancelVoiceCountdown: true,
                voiceCountdownSecond: nil,
                playTick: false,
                playChime: false,
                // Completion sound plays unconditionally even in voice countdown mode.
                playCompletion: prefs.completion,
                // #712: the end cue, felt rather than heard. Not gated on
                // `prefs.completion` — silencing the bell must not silence the
                // buzz — but it is the same moment, so a sitter with both on
                // gets one event in two channels.
                haptic: HapticCueLogic.sessionEndCue(
                    hapticsEnabled: prefs.haptics,
                    completedNaturally: true,
                    isAbandoned: isAbandoned
                )
            )
        )
    }

    /// Voice countdown — fires once per second in the final minute.
    ///
    /// While it is active (`voiceActive`: the toggle on and 60 s or less left)
    /// it silences the tick and the per-minute chime; see `tickStep` and
    /// `chimeStep`.
    private static func voiceCountdownStep(
        remaining: Double,
        prefs: AudioEngine.SoundPrefs,
        cursor: inout Cursor
    ) -> (cancel: Bool, second: Int?) {
        guard prefs.voiceCountdown else { return (false, nil) }
        if VoiceCountdownLogic.shouldReset(remaining: remaining) {
            // Remaining went back above 60 s (e.g., bonus seconds added mid-final-minute).
            guard cursor.lastVoiceCountdownSec != 0 else { return (false, nil) }
            cursor.lastVoiceCountdownSec = 0
            return (true, nil)
        }
        guard let sec = VoiceCountdownLogic.announceSecond(
            remaining: remaining,
            lastAnnouncedSec: cursor.lastVoiceCountdownSec
        ) else { return (false, nil) }
        cursor.lastVoiceCountdownSec = sec
        return (false, sec)
    }

    /// Tick sound — once per second; suppressed during voice countdown final minute.
    /// The cursor moves only while the tick sound is on.
    private static func tickStep(
        elapsed: Double,
        prefs: AudioEngine.SoundPrefs,
        voiceActive: Bool,
        cursor: inout Cursor
    ) -> Bool {
        let currentSec = Int(elapsed)
        guard prefs.tick && currentSec > cursor.lastTickSec else { return false }
        cursor.lastTickSec = currentSec
        return !voiceActive
    }

    /// Minute bell. The block cursor advances independent of mute state, so
    /// unmuting never replays a strike.
    ///
    /// The only bell inside the voice-countdown window is the one that opens
    /// the final minute; every earlier bell follows the chime switch. Web's
    /// `planCountdownCues` in `src/lib/sessionCues.ts` applies the same bell
    /// rule (#853).
    private static func chimeStep(
        elapsed: Double,
        totalSeconds: Int,
        prefs: AudioEngine.SoundPrefs,
        voiceActive: Bool,
        cursor: inout Cursor
    ) -> Bool {
        let chimeUpdate = SessionLogic.nextMinuteChimeUpdate(
            elapsed: elapsed,
            totalSeconds: totalSeconds,
            lastCompletedBlockIndex: cursor.lastCompletedMinuteBlockIndex
        )
        guard chimeUpdate.updatedCompletedBlockIndex > cursor.lastCompletedMinuteBlockIndex else { return false }
        cursor.lastCompletedMinuteBlockIndex = chimeUpdate.updatedCompletedBlockIndex
        // `chimeCount` is non-nil only when a full minute is still to go; since
        // #711 the bell is one strike, so the value survives purely as that gate
        // and no longer sets how many strikes play.
        let fullMinuteRemains = chimeUpdate.chimeCount != nil
        // Per-minute chime suppressed during voice countdown final minute.
        return prefs.chime && fullMinuteRemains && !voiceActive
    }

    /// Repeating haptic — uses its own interval, not the chime's minute blocks.
    private static func hapticStep(
        elapsed: Double,
        totalSeconds: Int,
        prefs: AudioEngine.SoundPrefs,
        isAbandoned: Bool,
        cursor: inout Cursor
    ) -> HapticCueLogic.Cue? {
        let hapticUpdate = HapticCueLogic.repeatingHapticUpdate(
            elapsedSeconds: elapsed,
            durationSeconds: totalSeconds,
            intervalSeconds: prefs.hapticInterval.seconds,
            lastCompletedIndex: cursor.lastHapticIntervalIndex
        )
        cursor.lastHapticIntervalIndex = hapticUpdate.completedIndex
        return HapticCueLogic.repeatingCue(
            hapticsEnabled: prefs.haptics,
            crossedBoundary: hapticUpdate.crossedBoundary,
            isAbandoned: isAbandoned
        )
    }
}
