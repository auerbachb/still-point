import XCTest
@testable import StillPointShared

final class CreateSessionEncodingTests: XCTestCase {
    func testCreateSessionRequestIncludesQuickSessionType() throws {
        let request = CreateSessionRequest(
            dayNumber: 7,
            sessionType: .quick,
            duration: StillPoint.quickDuration,
            completed: true,
            actualTime: StillPoint.quickDuration,
            clearPercent: 100,
            thoughtCount: 0,
            mindStateLog: [],
            sessionDate: "2026-04-28"
        )

        let data = try JSONEncoder().encode(request)
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])

        XCTAssertEqual(object["sessionType"] as? String, "quick")
        XCTAssertEqual(object["duration"] as? Int, 60)
        XCTAssertEqual(object["dayNumber"] as? Int, 7)
    }
}
