import Foundation

/// Miss-a-day recovery (#238 / #524): shared duration + progression logic so every
/// surface that plans or advances a standard sit's length agrees on what "today's
/// duration" means in both normal and recovery modes.
///
/// Recovery model: missing 2+ calendar days freezes `recoveryTargetDay` at the
/// pre-miss `currentDay` (the level to ramp back to) and starts a step counter.
/// `currentDay` is frozen mid-ramp but advances by one when the final recovery
/// step completes (#559), so sparse sitters are not stuck re-entering recovery at
/// the same day forever before they can climb toward the 10-minute cap.
public enum DurationRecovery {
    /// Recovery ramps back to the prior duration level over at most this many sessions.
    public static let recoveryMaxSteps = 5

    /// A 2+ calendar-day gap since the last completed standard sit triggers recovery.
    public static let missedDayGapThreshold = 2

    public struct RecoveryFields: Sendable, Equatable {
        public var recoveryTargetDay: Int?
        public var recoveryCurrentStep: Int?
        public var recoveryTotalSteps: Int?

        public init(
            recoveryTargetDay: Int? = nil,
            recoveryCurrentStep: Int? = nil,
            recoveryTotalSteps: Int? = nil
        ) {
            self.recoveryTargetDay = recoveryTargetDay
            self.recoveryCurrentStep = recoveryCurrentStep
            self.recoveryTotalSteps = recoveryTotalSteps
        }

        public static let none = RecoveryFields()
    }

    public struct ActiveRecovery: Sendable, Equatable {
        public let recoveryTargetDay: Int
        public let recoveryCurrentStep: Int
        public let recoveryTotalSteps: Int
    }

    public struct ProgressionState: Sendable, Equatable {
        public var currentDay: Int
        public var recoveryTargetDay: Int?
        public var recoveryCurrentStep: Int?
        public var recoveryTotalSteps: Int?

        public init(currentDay: Int, recovery: RecoveryFields = .none) {
            self.currentDay = currentDay
            self.recoveryTargetDay = recovery.recoveryTargetDay
            self.recoveryCurrentStep = recovery.recoveryCurrentStep
            self.recoveryTotalSteps = recovery.recoveryTotalSteps
        }
    }

    public static func recoveryFields(from user: UserDTO?) -> RecoveryFields {
        guard let user else { return .none }
        return RecoveryFields(
            recoveryTargetDay: user.recoveryTargetDay,
            recoveryCurrentStep: user.recoveryCurrentStep,
            recoveryTotalSteps: user.recoveryTotalSteps
        )
    }

    /// Normalizes the nullable trio into a concrete in-progress recovery, or `nil` when
    /// recovery isn't active (any field missing, no steps needed, or already exhausted).
    public static func activeRecovery(_ fields: RecoveryFields) -> ActiveRecovery? {
        guard let recoveryTargetDay = fields.recoveryTargetDay,
              let recoveryCurrentStep = fields.recoveryCurrentStep,
              let recoveryTotalSteps = fields.recoveryTotalSteps else {
            return nil
        }
        guard recoveryTotalSteps > 0,
              recoveryCurrentStep >= 1,
              recoveryCurrentStep <= recoveryTotalSteps else {
            return nil
        }
        return ActiveRecovery(
            recoveryTargetDay: recoveryTargetDay,
            recoveryCurrentStep: recoveryCurrentStep,
            recoveryTotalSteps: recoveryTotalSteps
        )
    }

    /// Number of recovery sessions needed to ramp back to `targetDay`'s duration.
    public static func recoveryTotalStepsFor(targetDay: Int) -> Int {
        max(0, min(recoveryMaxSteps, targetDay - 1))
    }

    /// Duration (seconds) for a given recovery step (1-indexed). Step 1 is always exactly
    /// `baseDuration`; later steps ramp linearly toward `duration(forDay: targetDay)`.
    public static func recoveryStepDuration(targetDay: Int, totalSteps: Int, step: Int) -> Int {
        guard totalSteps > 0 else { return StillPoint.baseDuration }
        let priorDuration = StillPoint.duration(forDay: targetDay)
        let difference = priorDuration - StillPoint.baseDuration
        let ramp = Double(difference) / Double(totalSteps)
        let clampedStep = min(max(step, 1), totalSteps)
        return Int((Double(StillPoint.baseDuration) + ramp * Double(clampedStep - 1)).rounded())
    }

    /// The shared duration function (#238): every planner/display for a sit's length
    /// must go through this so normal and recovery modes never drift apart.
    public static func sessionDurationForUser(
        sessionType: SessionType,
        currentDay: Int,
        recovery: RecoveryFields
    ) -> Int {
        if sessionType == .quick { return StillPoint.quickDuration }
        if let active = activeRecovery(recovery) {
            return recoveryStepDuration(
                targetDay: active.recoveryTargetDay,
                totalSteps: active.recoveryTotalSteps,
                step: active.recoveryCurrentStep
            )
        }
        return StillPoint.duration(forDay: currentDay)
    }

    /// Builds the recovery state to persist when a 2+ day gap is detected.
    public static func startRecovery(currentDay: Int) -> ActiveRecovery? {
        let totalSteps = recoveryTotalStepsFor(targetDay: currentDay)
        guard totalSteps > 0 else { return nil }
        return ActiveRecovery(
            recoveryTargetDay: currentDay,
            recoveryCurrentStep: 1,
            recoveryTotalSteps: totalSteps
        )
    }

    /// Detects whether a 2+ calendar-day gap since the last completed standard session
    /// should start recovery.
    public static func detectMissedDayGap(
        lastCompletedSessionDate: String?,
        todayIso: String,
        currentDay: Int,
        recovery: RecoveryFields
    ) -> ActiveRecovery? {
        if activeRecovery(recovery) != nil { return nil }
        guard let lastCompletedSessionDate else { return nil }
        let gapDays = SessionCalendar.daysBetweenInclusive(fromIso: lastCompletedSessionDate, toIso: todayIso)
        guard gapDays >= missedDayGapThreshold else { return nil }
        return startRecovery(currentDay: currentDay)
    }

    /// Advances progression after a session save.
    public static func advanceProgression(
        sessionType: SessionType,
        completed: Bool,
        state: ProgressionState
    ) -> ProgressionState {
        guard StillPoint.shouldAdvanceDay(sessionType: sessionType, completed: completed) else {
            return state
        }

        if let active = activeRecovery(RecoveryFields(
            recoveryTargetDay: state.recoveryTargetDay,
            recoveryCurrentStep: state.recoveryCurrentStep,
            recoveryTotalSteps: state.recoveryTotalSteps
        )) {
            let nextStep = active.recoveryCurrentStep + 1
            let stillRecovering = nextStep <= active.recoveryTotalSteps
            return ProgressionState(
                currentDay: stillRecovering ? state.currentDay : state.currentDay + 1,
                recovery: stillRecovering
                    ? RecoveryFields(
                        recoveryTargetDay: active.recoveryTargetDay,
                        recoveryCurrentStep: nextStep,
                        recoveryTotalSteps: active.recoveryTotalSteps
                    )
                    : .none
            )
        }

        return ProgressionState(currentDay: state.currentDay + 1, recovery: .none)
    }

    /// Planned duration of the *next* standard sit, previewed client-side from the
    /// pre-save user state using the same progression the server applies (#238).
    public static func previewNextStandardDuration(
        sessionType: SessionType,
        completed: Bool,
        track: Track,
        user: UserDTO?
    ) -> Int {
        guard let user else { return StillPoint.baseDuration }
        if track == .second {
            let nextSecond = StillPoint.advanceSecondTrackDay(
                sessionType: sessionType,
                completed: completed,
                secondTrackDay: user.secondTrackDay
            )
            return sessionDurationForUser(sessionType: .standard, currentDay: nextSecond, recovery: .none)
        }
        let next = advanceProgression(
            sessionType: sessionType,
            completed: completed,
            state: ProgressionState(currentDay: user.currentDay, recovery: recoveryFields(from: user))
        )
        return sessionDurationForUser(
            sessionType: .standard,
            currentDay: next.currentDay,
            recovery: RecoveryFields(
                recoveryTargetDay: next.recoveryTargetDay,
                recoveryCurrentStep: next.recoveryCurrentStep,
                recoveryTotalSteps: next.recoveryTotalSteps
            )
        )
    }
}
