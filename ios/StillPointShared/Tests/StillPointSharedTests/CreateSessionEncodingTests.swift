import XCTest
@testable import StillPointShared

final class CreateSessionEncodingTests: XCTestCase {
    func testCreateSessionRequestIncludesAttentionLogWhenPresent() throws {
        let request = CreateSessionRequest(
            dayNumber: 3,
            duration: 180,
            completed: true,
            actualTime: 180,
            clearPercent: 90,
            thoughtCount: 0,
            mindStateLog: [MindStateEntry(time: 0, state: "clear")],
            attentionLog: [
                AttentionEntry(time: 0, state: "attentive"),
                AttentionEntry(time: 42.5, state: "away"),
            ],
            sessionDate: "2026-07-02"
        )

        let data = try JSONEncoder().encode(request)
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        let attentionLog = try XCTUnwrap(object["attentionLog"] as? [[String: Any]])

        XCTAssertEqual(attentionLog.count, 2)
        XCTAssertEqual(attentionLog[1]["state"] as? String, "away")
    }

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
