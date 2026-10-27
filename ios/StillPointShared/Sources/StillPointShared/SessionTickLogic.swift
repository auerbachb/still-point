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

    /// #848: whether starting the timer may run the clock at all. A sit that
    /// has ended — run out, ended early or abandoned — stays stopped, so a
    /// Resume that lands before the completion screen replaces the session
    /// screen restarts neither its clock nor its cues.
    ///
    /// Checked before `isResume`, which cannot refuse a start: End Early and
    /// Abandon leave the clock where it stopped, which reads as a resume, and
    /// a `false` there begins the sit again from zero.
    public static func canStart(isComplete: Bool, isAbandoned: Bool) -> Bool {
        !isComplete && !isAbandoned
    }

    /// Whether starting the timer picks a paused sit back up rather than
    /// beginning a new one. A clock that already reached the duration always
    /// begins again.
    public static func isResume(
        pausedElapsed: Double,
        totalSeconds: Int,
        isPaused: Bool,
        isActive: Bool
    ) -> Bool {
        pausedElapsed < Double(totalSeconds)
            && (pausedElapsed > 0 || isPaused || isActive)
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
            return Outcome(
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

        var next = cursor
        let currentSec = Int(elapsed)
        let remaining = max(0.0, Double(totalSeconds) - elapsed)
        let voiceActive = prefs.voiceCountdown && VoiceCountdownLogic.isActive(remaining: remaining)

        // Voice countdown — fires once per second in the final minute.
        // Mirrors BlockTimer.tsx: suppresses tick and per-minute chime while active.
        var cancelVoiceCountdown = false
        var voiceCountdownSecond: Int?
        if prefs.voiceCountdown {
            if VoiceCountdownLogic.shouldReset(remaining: remaining) {
                // Remaining went back above 60 s (e.g., bonus seconds added mid-final-minute).
                if next.lastVoiceCountdownSec != 0 {
                    next.lastVoiceCountdownSec = 0
                    cancelVoiceCountdown = true
                }
            } else if let sec = VoiceCountdownLogic.announceSecond(
                remaining: remaining,
                lastAnnouncedSec: next.lastVoiceCountdownSec
            ) {
                next.lastVoiceCountdownSec = sec
                voiceCountdownSecond = sec
            }
        }

        // Tick sound — once per second; suppressed during voice countdown final minute.
        var playTick = false
        if prefs.tick && currentSec > next.lastTickSec {
            next.lastTickSec = currentSec
            playTick = !voiceActive
        }

        // Advance minute-block boundary progress independent of mute state.
        let chimeUpdate = SessionLogic.nextMinuteChimeUpdate(
            elapsed: elapsed,
            totalSeconds: totalSeconds,
            lastCompletedBlockIndex: next.lastCompletedMinuteBlockIndex
        )
        var playChime = false
        if chimeUpdate.updatedCompletedBlockIndex > next.lastCompletedMinuteBlockIndex {
            next.lastCompletedMinuteBlockIndex = chimeUpdate.updatedCompletedBlockIndex
            // `chimeCount` is non-nil only when a full minute is still to go; since
            // #711 the bell is one strike, so the value survives purely as that gate
            // and no longer sets how many strikes play.
            let fullMinuteRemains = chimeUpdate.chimeCount != nil
            // Per-minute chime suppressed during voice countdown final minute.
            playChime = prefs.chime && fullMinuteRemains && !voiceActive
        }

        // Repeating haptic uses its own interval, not the chime's minute blocks.
        let hapticUpdate = HapticCueLogic.repeatingHapticUpdate(
            elapsedSeconds: elapsed,
            durationSeconds: totalSeconds,
            intervalSeconds: prefs.hapticInterval.seconds,
            lastCompletedIndex: next.lastHapticIntervalIndex
        )
        next.lastHapticIntervalIndex = hapticUpdate.completedIndex

        return Outcome(
            elapsed: elapsed,
            completedNaturally: false,
            cursor: next,
            effects: Effects(
                cancelVoiceCountdown: cancelVoiceCountdown,
                voiceCountdownSecond: voiceCountdownSecond,
                playTick: playTick,
                playChime: playChime,
                playCompletion: false,
                haptic: HapticCueLogic.repeatingCue(
                    hapticsEnabled: prefs.haptics,
                    crossedBoundary: hapticUpdate.crossedBoundary,
                    isAbandoned: isAbandoned
                )
            )
        )
    }
}
