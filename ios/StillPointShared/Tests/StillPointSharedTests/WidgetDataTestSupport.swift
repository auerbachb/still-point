import Foundation
import StillPointShared

/// Fixtures shared by the `WidgetData*Tests` suites, split by concern out of
/// one `WidgetDataTests` (#760). A suite adopts the protocol to call them
/// exactly as it did when they were its private methods, which kept every
/// moved test body unchanged. A helper only one suite uses stays private to
/// that suite.
protocol WidgetDataTestSupport {}

extension WidgetDataTestSupport {
    func makeUser(id: String = "user-1", currentDay: Int = 12) -> UserDTO {
        UserDTO(
            id: id,
            email: "test@example.com",
            username: "tester",
            isPublic: false,
            currentDay: currentDay
        )
    }

    func session(
        date: String,
        type: SessionType = .standard,
        completed: Bool = true,
        track: Track? = .primary
    ) -> SessionDTO {
        SessionDTO(
            id: "\(date)-\(type.rawValue)-\(completed)-\(track?.rawValue ?? "nil")",
            dayNumber: 1,
            sessionType: type,
            duration: 60,
            completed: completed,
            actualTime: 60,
            clearPercent: 0,
            thoughtCount: 0,
            mindStateLog: nil,
            sessionDate: date,
            buddySessionId: nil,
            track: track
        )
    }

    func localDay(_ offset: Int, from now: Date = Date()) -> String {
        let date = Calendar.current.date(byAdding: .day, value: offset, to: now)!
        return WidgetDataStore.localDayString(date)
    }
}
