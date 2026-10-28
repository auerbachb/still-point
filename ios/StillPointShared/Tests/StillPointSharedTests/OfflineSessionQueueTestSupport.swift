import Foundation
@testable import StillPointShared

/// Builders shared by the queue-store suites and the `SessionSyncCoordinator*`
/// suites that fill the queue (#1127, #1139).
enum QueuedSitFixtures {
    /// A completed sit's create request. Every sit these suites queue ran to its
    /// planned length, so `actualTime` is `duration`.
    static func request(
        dayNumber: Int = 1,
        sessionType: SessionType = .standard,
        duration: Int = 60,
        clearPercent: Int = 100,
        thoughtCount: Int = 0,
        sessionDate: String = "2026-07-17",
        focusCategory: FocusCategory? = nil,
        clientSessionId: UUID? = nil,
        combined: Bool = false
    ) -> CreateSessionRequest {
        CreateSessionRequest(
            dayNumber: dayNumber,
            sessionType: sessionType,
            duration: duration,
            completed: true,
            actualTime: duration,
            clearPercent: clearPercent,
            thoughtCount: thoughtCount,
            mindStateLog: [],
            sessionDate: sessionDate,
            focusCategory: focusCategory,
            clientSessionId: clientSessionId,
            combined: combined
        )
    }

    /// #896: a combined sit — today's sits folded into one.
    static func combinedRequest(clientSessionId: UUID? = nil) -> CreateSessionRequest {
        request(
            dayNumber: 30,
            duration: 1200,
            clearPercent: 85,
            sessionDate: "2026-10-27",
            clientSessionId: clientSessionId,
            combined: true
        )
    }
}

/// Records every create request a transport is handed.
actor CreateRequestRecorder {
    private(set) var requests: [CreateSessionRequest] = []

    func record(_ request: CreateSessionRequest) {
        requests.append(request)
    }
}
