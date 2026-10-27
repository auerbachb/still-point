import Foundation

// When the app's one background app-refresh task should run (#549, #663), and
// how a run reports that it finished.
//
// iOS keeps at most one pending app-refresh request per app. The header for
// `BGTaskScheduler.submit(_:)` says "There can be a total of 1 refresh task",
// and a submit replaces the request already pending. App blocking (#549) and the
// widget (#663) both need that one request, so each submit has to carry the
// earliest time either of them wants. A submit that knew only its own time
// would push the other's run back, or cancel it outright.

/// The schedule for the app's one background app-refresh request.
public enum BackgroundRefreshSchedule {
    /// How long after a refresh the widget asks for the next one (#663). This is
    /// the earliest the system may run it, not a promise. iOS chooses the actual
    /// time from how the app is used, and may not run it at all.
    public static let widgetRefreshLeadTime: TimeInterval = 15 * 60

    /// When the widget wants its next background refresh: one lead time after
    /// `now` while an account is signed in on this device, otherwise never.
    public static func widgetRefreshDate(signedIn: Bool, now: Date) -> Date? {
        signedIn ? now.addingTimeInterval(widgetRefreshLeadTime) : nil
    }

    /// The begin date to submit: the earlier of the two wanted times. `nil` means
    /// neither job wants a run, so the pending request should be cancelled.
    public static func earliestBeginDate(shieldRefresh: Date?, widgetRefresh: Date?) -> Date? {
        [shieldRefresh, widgetRefresh].compactMap { $0 }.min()
    }
}

/// A background task's completion must be reported exactly once, but a run can
/// end two ways. Its work finishes, or the system expires it first. The first
/// report wins, and any later one is ignored.
public struct BackgroundTaskCompletion: Sendable, Equatable {
    /// What the run reported, or `nil` while it is still running.
    public private(set) var reported: Bool?

    public init() {}

    /// Record `success` unless the run already reported. Returns whether this is
    /// the call that should complete the task.
    public mutating func report(success: Bool) -> Bool {
        guard reported == nil else { return false }
        reported = success
        return true
    }
}
