import Foundation
import StillPointShared

enum AppView: Equatable {
    case auth
    case home
    /// #898: `combined` is today's two sits done as one (#769). Always on the
    /// primary track, as a standard sit.
    case session(type: SessionType, track: Track, combined: Bool = false)
    case buddyHub
    case buddyCalendar
    case buddyCalendarWithBuddy(buddyId: String, buddyUsername: String)
    case buddySession(sessionId: String)
    case completion(
        sessionId: String,
        clientSessionId: UUID,
        clearPercent: Int,
        thoughtCount: Int,
        thoughts: [CapturedThought],
        dayNumber: Int,
        sessionType: SessionType,
        track: Track,
        sessionCompleted: Bool,
        duration: Int,
        bonusSeconds: Int,
        attentionLog: [AttentionEntry]?,
        attentionElapsed: Double?,
        ambientSoundSummary: AmbientSoundSummary?,
        combined: Bool = false
    )
    case breathCounting
    /// #840: choosing what a focus session is for.
    case focusPicker
    /// #840: a running focus session. Carries the goal counter it started on, so a
    /// refresh landing mid-session cannot move the goal being counted down to.
    case focusActivity(category: FocusCategory, focusActivityDay: Int)
    case logReason(date: String)
    case history
    case journal
    case board
    case settings

    static func == (lhs: AppView, rhs: AppView) -> Bool {
        switch (lhs, rhs) {
        case (.auth, .auth), (.home, .home),
             (.buddyHub, .buddyHub),
             (.buddyCalendar, .buddyCalendar),
             (.breathCounting, .breathCounting),
             (.focusPicker, .focusPicker),
             (.history, .history), (.journal, .journal), (.board, .board),
             (.settings, .settings):
            return true
        case let (.session(lhsType, lhsTrack, lhsCombined), .session(rhsType, rhsTrack, rhsCombined)):
            // #898: a combined sit and an ordinary Track One sit are different routes.
            return lhsType == rhsType && lhsTrack == rhsTrack && lhsCombined == rhsCombined
        case let (.focusActivity(lhsCategory, lhsDay), .focusActivity(rhsCategory, rhsDay)):
            return lhsCategory == rhsCategory && lhsDay == rhsDay
        case let (.buddySession(lhsSessionId), .buddySession(rhsSessionId)):
            return lhsSessionId == rhsSessionId
        case let (.buddyCalendarWithBuddy(lhsId, lhsName), .buddyCalendarWithBuddy(rhsId, rhsName)):
            return lhsId == rhsId && lhsName == rhsName
        case let (.logReason(lhsDate), .logReason(rhsDate)):
            return lhsDate == rhsDate
        case (.completion, .completion):
            return true
        default:
            return false
        }
    }
}

struct CapturedThought: Identifiable {
    let id = UUID()
    let timeInSession: Int
    let text: String
}
