import Foundation
import StillPointShared

/// Route changes the views ask for: into sits (solo, breath, focus, buddy), the focus
/// picker, and the buddy hub and calendar. Ending a sit, with the saving and syncing
/// that ride on it, is in `AppViewModel+SessionCompletion.swift`.
extension AppViewModel {
    func beginSession(type: SessionType = .standard, track: Track = .primary) {
        currentView = .session(type: type, track: track)
    }

    func beginBreathCounting() {
        currentView = .breathCounting
    }

    // MARK: - #840 Focus activity

    /// Home's "Focus activity" button: choose a category first.
    func beginFocusActivity() {
        currentView = .focusPicker
    }

    /// A picker card: the timer starts on the goal counter as it stands now.
    ///
    /// Only from the picker. A second card tapped while the picker fades out would
    /// otherwise swap the category under a session that has already started.
    func startFocusSession(category: FocusCategory) {
        guard currentView == .focusPicker else { return }
        currentView = .focusActivity(category: category, focusActivityDay: focusActivityDay)
    }

    /// The picker's Cancel. Retries an invite held back while it was up, as the
    /// breath exits do. Only from the picker, for the same reason as above.
    func cancelFocusActivity() {
        guard currentView == .focusPicker else { return }
        currentView = .home
        scheduleBuddyInviteConsume()
    }

    func beginBuddySession() {
        buddyInviteError = nil
        currentView = .buddyHub
    }

    func openBuddyCalendar() {
        currentView = .buddyCalendar
    }

    func openBuddyCalendarForBuddy(buddyId: String, username: String) {
        currentView = .buddyCalendarWithBuddy(buddyId: buddyId, buddyUsername: username)
    }

    func closeBuddyCalendar() {
        currentView = .buddyHub
    }

    func enterBuddySession(sessionId: String) {
        buddyInviteError = nil
        currentView = .buddySession(sessionId: sessionId)
    }

    func leaveBuddySession() {
        currentView = .home
        scheduleBuddyInviteConsume()
    }
}
