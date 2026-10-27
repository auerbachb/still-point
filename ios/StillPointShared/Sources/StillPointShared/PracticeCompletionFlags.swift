import Foundation

/// #832: which "done today" flags a finished sit raises, decided from its session
/// type and the track it was launched on. The decision half of
/// `markPracticeDoneToday`, which ``PracticeDayState/recordCompletion(sessionType:track:now:dualTrack:calendar:)``
/// applies.
///
/// Each member maps one-to-one to a stored flag on ``PracticeDayState``:
/// ``practice`` to `practiceDoneToday`, ``secondPractice`` to
/// `secondPracticeDoneToday`, ``primaryStandard`` to `primaryStandardDoneToday`.
/// The result is a set to **raise**. It is not the full flag state: a flag the set
/// leaves out keeps whatever value it already had, and nothing here ever lowers one.
public struct PracticeCompletionFlags: OptionSet, Sendable, Hashable {
    public let rawValue: Int

    public init(rawValue: Int) {
        self.rawValue = rawValue
    }

    /// `practiceDoneToday`: any counted Track One practice today.
    public static let practice = PracticeCompletionFlags(rawValue: 1 << 0)
    /// `secondPracticeDoneToday`: a second-track standard sit today (#684).
    public static let secondPractice = PracticeCompletionFlags(rawValue: 1 << 1)
    /// `primaryStandardDoneToday`: a primary standard sit today (#679).
    public static let primaryStandard = PracticeCompletionFlags(rawValue: 1 << 2)

    /// The flags a sit of `sessionType`, launched on `track`, raises when it finishes.
    ///
    /// - Quick and breath sits are Track One practice whichever track the user
    ///   launched them from. They have no second-track counterpart, so they raise
    ///   ``practice`` only.
    /// - A standard sit on the second track raises ``secondPractice`` only.
    /// - A standard sit on the primary track raises ``practice`` and
    ///   ``primaryStandard``. `practiceDoneToday` alone cannot say the sit was a
    ///   *standard* one, since quick and breath sits raise it too, and the
    ///   standard-only day set that extends `serverStreak` may only take days the
    ///   server would have counted (#679).
    /// - A focus session is not meditation practice (#765, #839). It raises nothing,
    ///   so the result is empty and the caller changes no state for it.
    ///
    /// The `switch` has no `default`, so a new session type fails to compile until
    /// someone decides its mapping.
    public static func raised(sessionType: SessionType, track: Track) -> PracticeCompletionFlags {
        switch sessionType {
        case .quick, .breath:
            return [.practice]
        case .standard:
            switch track {
            case .second:
                return [.secondPractice]
            case .primary:
                return [.practice, .primaryStandard]
            }
        case .focus:
            return []
        }
    }
}
