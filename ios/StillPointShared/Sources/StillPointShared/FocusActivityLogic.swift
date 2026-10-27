import Foundation

// MARK: - How a focus session ends

/// #840: how a focus session ended: its countdown ran out, or the person pressed
/// End. Mirrors web `FocusEndReason` (`src/lib/focusActivity.ts`).
public enum FocusEndReason: Sendable, Equatable {
    /// The countdown reached zero.
    case expired
    /// The person pressed End.
    case ended
}

/// #840: what a finished focus session saves. Mirrors web `FocusSessionResult`.
public struct FocusSessionResult: Sendable, Equatable {
    /// The goal in seconds: the planned length, whether or not it was reached.
    public let duration: Int
    /// Whole seconds spent, never more than the goal.
    public let actualTime: Int
    /// True once the countdown reached zero.
    public let completed: Bool

    public init(duration: Int, actualTime: Int, completed: Bool) {
        self.duration = duration
        self.actualTime = actualTime
        self.completed = completed
    }
}

/// #840: what a focus session leaves behind when it ends.
public enum FocusSessionEnd: Sendable, Equatable {
    /// End came before a whole second had passed, so there is nothing to save.
    /// Web's `resolveFocusEnd` returns `null` here.
    case nothingToSave
    /// The session to save.
    case save(FocusSessionResult)
}

// MARK: - FocusActivity

/// #840: the iOS focus timer's rules, mirroring web `src/lib/focusActivity.ts`
/// (#836): the goal and countdown text, the wall-clock countdown, what an end
/// saves, which cues it plays, the save request, and the goal step after a save.
///
/// Free of SwiftUI / UIKit so `swift test` holds them. The app target
/// (`FocusActivityViewModel`, `AppViewModel.completeFocusSession`) only carries out
/// what they return. `shared/test-fixtures/focusActivity.json` is read by both this
/// suite and web's, so the rules duplicated from web cannot drift.
public enum FocusActivity {
    private static let secondsPerHour = 3600

    /// The goal as Home and the picker show it: "1 min", "30 min", "1 hr",
    /// "1 hr 30 min", "2 hr". Goals step a whole minute at a time, so there are
    /// never stray seconds. Mirrors web `formatFocusGoal`.
    public static func formatGoal(_ seconds: Int) -> String {
        let totalMinutes = Int((Double(max(0, seconds)) / 60).rounded())
        let hours = totalMinutes / 60
        let minutes = totalMinutes % 60
        if hours == 0 { return "\(minutes) min" }
        if minutes == 0 { return "\(hours) hr" }
        return "\(hours) hr \(minutes) min"
    }

    /// A length read aloud, for VoiceOver: "1 minute", "1 hour 30 minutes",
    /// "59 seconds". The "1 hr 30 min" and "0:59" on screen are for the eye.
    public static func spokenDuration(_ seconds: Int) -> String {
        let s = max(0, seconds)
        let parts = [
            (s / secondsPerHour, "hour"),
            ((s % secondsPerHour) / 60, "minute"),
            (s % 60, "second"),
        ]
        .filter { $0.0 > 0 }
        .map { "\($0.0) \($0.1)\($0.0 == 1 ? "" : "s")" }
        return parts.isEmpty ? "0 seconds" : parts.joined(separator: " ")
    }

    /// Whole seconds left on the countdown: the goal at the start, 0 exactly when
    /// the goal has elapsed, and never below it. Read from the wall clock, so an
    /// app that was in the background catches up on its next tick instead of
    /// drifting. Mirrors web `focusRemainingSeconds`.
    public static func remainingSeconds(startedAt start: Date, now: Date, goalSeconds: Int) -> Int {
        max(0, goalSeconds - BreathCounting.elapsedSeconds(since: start, now: now))
    }

    /// Countdown digits: "m:ss" under an hour, "h:mm:ss" from an hour, so the
    /// two-hour cap reads "2:00:00" rather than "120:00". Mirrors web
    /// `formatFocusCountdown`.
    public static func countdownDisplay(_ seconds: Int) -> String {
        let s = max(0, seconds)
        guard s >= secondsPerHour else { return BreathCounting.elapsedDisplay(s) }
        let hours = s / secondsPerHour
        let minutes = (s % secondsPerHour) / 60
        return "\(hours):\(String(format: "%02d", minutes)):\(String(format: "%02d", s % 60))"
    }

    /// Whether a goal's countdown starts with an hour field ("1:00:00"). That is
    /// three characters wider, so it gets smaller digits. Read from the goal rather
    /// than the time left, so the digits never change size mid-session. Mirrors
    /// web `focusCountdownFontSize`.
    public static func countdownShowsHours(goalSeconds: Int) -> Bool {
        goalSeconds >= secondsPerHour
    }

    /// What a focus session saves when it ends. Mirrors web `resolveFocusEnd`.
    ///
    /// Elapsed time comes from the wall clock and is capped at the goal. Reaching
    /// the goal completes the session however it ended: an End that lands at or
    /// after zero (an app suspended past the deadline, say) still reached it. An End
    /// before a whole second has passed leaves nothing to save.
    public static func resolveEnd(
        startedAt start: Date,
        now: Date,
        goalSeconds: Int,
        reason: FocusEndReason
    ) -> FocusSessionEnd {
        let elapsed = min(goalSeconds, BreathCounting.elapsedSeconds(since: start, now: now))
        if reason == .expired || elapsed >= goalSeconds {
            return .save(FocusSessionResult(duration: goalSeconds, actualTime: goalSeconds, completed: true))
        }
        if elapsed == 0 { return .nothingToSave }
        return .save(FocusSessionResult(duration: goalSeconds, actualTime: elapsed, completed: false))
    }

    /// The cues the end of a focus session plays.
    public struct EndCues: Sendable, Equatable {
        /// The completion sound.
        public let playCompletion: Bool
        /// The end-of-session haptic, or nil for none.
        public let haptic: HapticCueLogic.Cue?
    }

    /// Only a countdown that ran out is announced, through the person's own
    /// completion-sound and haptic settings, as at the natural end of a sit
    /// (`SessionTickLogic`). Pressing End is its own signal and plays nothing.
    ///
    /// There is no other focus cue: a focus session is for reading, writing or
    /// listening, so no tick, minute chime, voice countdown or interval buzz plays
    /// while it runs. Mirrors web `FocusActivityView`, which only ever calls
    /// `cues.end()`.
    public static func endCues(reason: FocusEndReason, prefs: AudioEngine.SoundPrefs) -> EndCues {
        let expired = reason == .expired
        return EndCues(
            playCompletion: expired && prefs.completion,
            haptic: HapticCueLogic.sessionEndCue(
                hapticsEnabled: prefs.haptics,
                completedNaturally: expired,
                isAbandoned: false
            )
        )
    }

    /// The request that saves a finished focus session (`saveCompletedSession`).
    ///
    /// - `dayNumber` is the focus goal counter the session ran on, not the
    ///   meditation day (`StillPoint.duration(for:day:)`).
    /// - `sessionDate` is the plain local calendar date the session ended on. Not
    ///   `AppViewModel.creditedSessionDate()`: that one credits the daily meditation
    ///   sit, and would stamp a focus session ended before 6:00 onto yesterday while
    ///   yesterday's sit is still open. Web saves `getLocalIsoDate()` for the same
    ///   reason.
    /// - Nothing a sit records: no bonus, clear percent, thoughts or mind-state log.
    ///
    /// - Parameter category: what the picker chose, saved as a label only.
    /// - Parameter endedAt: when the session ended.
    public static func sessionRequest(
        result: FocusSessionResult,
        category: FocusCategory?,
        focusActivityDay: Int,
        endedAt: Date,
        clientSessionId: UUID,
        calendar: Calendar = .current
    ) -> CreateSessionRequest {
        CreateSessionRequest(
            dayNumber: max(focusActivityDay, 1),
            sessionType: .focus,
            duration: result.duration,
            bonusSeconds: 0,
            completed: result.completed,
            actualTime: result.actualTime,
            clearPercent: 0,
            thoughtCount: 0,
            mindStateLog: [],
            sessionDate: SessionCalendar.localIsoDate(now: endedAt, calendar: calendar),
            focusCategory: category,
            clientSessionId: clientSessionId
        )
    }

    /// The focus goal counter to show once a completed focus session is stored,
    /// synced or queued. Mirrors web `focusActivityDayAfterCompletedSave`.
    ///
    /// The server steps `focusActivityDay` once per completed focus session
    /// (`StillPoint.advanceFocusActivityDay`). Taking the max keeps that one step
    /// when a server re-read that already applied it lands first, and never moves
    /// the counter backwards.
    ///
    /// - Parameter currentDay: the counter on the account now.
    /// - Parameter sessionDay: the counter the session ran on, its `dayNumber`.
    public static func focusActivityDayAfterCompletedSave(currentDay: Int, sessionDay: Int) -> Int {
        max(
            currentDay,
            StillPoint.advanceFocusActivityDay(sessionType: .focus, completed: true, focusActivityDay: sessionDay)
        )
    }
}

// MARK: - FocusSessionRun

/// #840: one running focus session: the goal it counts down to, its wall-clock
/// start, and whether it has ended. A value type, so `swift test` drives it with
/// injected dates; `FocusActivityViewModel` holds one.
public struct FocusSessionRun: Sendable {
    /// The goal in seconds, pinned when the session starts: an account refresh
    /// landing mid-session must not move the goal the person is counting down to.
    public let goalSeconds: Int
    public let startedAt: Date
    public private(set) var hasEnded = false

    public init(goalSeconds: Int, startedAt: Date) {
        self.goalSeconds = goalSeconds
        self.startedAt = startedAt
    }

    public func remainingSeconds(now: Date) -> Int {
        FocusActivity.remainingSeconds(startedAt: startedAt, now: now, goalSeconds: goalSeconds)
    }

    /// Ends the session and says what it leaves behind, the first time only.
    ///
    /// The re-entrancy guard (web: `endedRef` in `FocusActivityView`). The
    /// countdown's own expiry and an End tap can land in the same turn, and End can
    /// be tapped twice before the screen goes. Every call after the first returns
    /// nil, so one session reports one end and is saved at most once.
    public mutating func end(reason: FocusEndReason, now: Date) -> FocusSessionEnd? {
        guard !hasEnded else { return nil }
        hasEnded = true
        return FocusActivity.resolveEnd(startedAt: startedAt, now: now, goalSeconds: goalSeconds, reason: reason)
    }
}

// MARK: - FocusCategory picker copy

extension FocusCategory {
    /// The line under the category's name on its picker card. Mirrors the
    /// `description` of web `FOCUS_ACTIVITIES` (`src/lib/focusActivityContent.ts`),
    /// which calls its card copy a first draft.
    public var pickerDescription: String {
        switch self {
        case .reading: return "One book or article, read without switching away."
        case .writing: return "One piece of writing: a draft, a journal entry, a letter."
        case .listening: return "Music with your eyes closed. Nothing to do but listen."
        }
    }
}
