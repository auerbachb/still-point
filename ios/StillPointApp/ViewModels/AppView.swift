import Foundation
import StillPointShared

enum AppView: Equatable {
    case auth
    case home
    case session(type: SessionType, track: Track)
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
        ambientSoundSummary: AmbientSoundSummary?
    )
    case breathCounting
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
             (.history, .history), (.journal, .journal), (.board, .board),
             (.settings, .settings):
            return true
        case let (.session(lhsType, lhsTrack), .session(rhsType, rhsTrack)):
            return lhsType == rhsType && lhsTrack == rhsTrack
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
