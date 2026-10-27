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

    func testCreateSessionRequestIncludesClientSessionIdWhenPresent() throws {
        let clientSessionId = UUID()
        let request = CreateSessionRequest(
            dayNumber: 1,
            duration: 60,
            completed: true,
            actualTime: 60,
            clearPercent: 90,
            thoughtCount: 0,
            mindStateLog: [],
            sessionDate: "2026-07-17",
            clientSessionId: clientSessionId
        )

        let data = try JSONEncoder().encode(request)
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertEqual(object["clientSessionId"] as? String, clientSessionId.uuidString)
    }

    // MARK: - #839 focus category

    /// No category means no key at all: the server stores an absent category as none,
    /// and every request built before #839 still encodes exactly as it did.
    func testCreateSessionRequestOmitsFocusCategoryWhenNil() throws {
        let requests = [
            CreateSessionRequest(
                dayNumber: 2,
                sessionType: .focus,
                duration: 120,
                completed: true,
                actualTime: 120,
                clearPercent: 0,
                thoughtCount: 0,
                mindStateLog: [],
                sessionDate: "2026-10-27"
            ),
            CreateSessionRequest(
                dayNumber: 7,
                duration: 120,
                completed: true,
                actualTime: 120,
                clearPercent: 80,
                thoughtCount: 1,
                mindStateLog: [],
                sessionDate: "2026-10-27"
            ),
        ]

        for request in requests {
            let data = try JSONEncoder().encode(request)
            let object = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
            XCTAssertFalse(object.keys.contains("focusCategory"), request.sessionType.rawValue)
        }
    }

    func testCreateSessionRequestIncludesFocusCategoryWhenSet() throws {
        let request = CreateSessionRequest(
            dayNumber: 4,
            sessionType: .focus,
            duration: StillPoint.focusDuration(forDay: 4),
            completed: true,
            actualTime: 240,
            clearPercent: 0,
            thoughtCount: 0,
            mindStateLog: [],
            sessionDate: "2026-10-27",
            focusCategory: .writing
        )

        let data = try JSONEncoder().encode(request)
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertEqual(object["sessionType"] as? String, "focus")
        XCTAssertEqual(object["focusCategory"] as? String, "writing")
        XCTAssertEqual(object["duration"] as? Int, 240)
    }
}

// MARK: - #896 combined sit

extension CreateSessionEncodingTests {
    private func combinedRequest(_ combined: Bool?) -> CreateSessionRequest {
        let base = (dayNumber: 30, duration: 1200, sessionDate: "2026-10-27")
        if let combined {
            return CreateSessionRequest(
                dayNumber: base.dayNumber, duration: base.duration, completed: true,
                actualTime: base.duration, clearPercent: 90, thoughtCount: 0, mindStateLog: [],
                sessionDate: base.sessionDate, combined: combined
            )
        }
        return CreateSessionRequest(
            dayNumber: base.dayNumber, duration: base.duration, completed: true,
            actualTime: base.duration, clearPercent: 90, thoughtCount: 0, mindStateLog: [],
            sessionDate: base.sessionDate
        )
    }

    /// An ordinary sit has no `combined` key, so it encodes exactly as before #896.
    func testCreateSessionRequestOmitsCombinedWhenFalse() throws {
        XCTAssertFalse(combinedRequest(nil).combined)
        for request in [combinedRequest(nil), combinedRequest(false)] {
            let data = try JSONEncoder().encode(request)
            let object = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
            XCTAssertNil(object["combined"])
        }
        let encoder = JSONEncoder()
        encoder.outputFormatting = .sortedKeys
        XCTAssertEqual(
            try encoder.encode(combinedRequest(false)),
            try encoder.encode(combinedRequest(nil))
        )
    }

    func testCreateSessionRequestIncludesCombinedWhenTrue() throws {
        let data = try JSONEncoder().encode(combinedRequest(true))
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertEqual(object["combined"] as? Bool, true)
        XCTAssertEqual(object["track"] as? String, "primary")
        XCTAssertEqual(object["sessionType"] as? String, "standard")
    }

    /// The hand-written coding keeps every other key: optionals still drop out when
    /// nil and round-trip when set.
    func testCreateSessionRequestRoundTripsEveryField() throws {
        let clientSessionId = UUID()
        let request = CreateSessionRequest(
            dayNumber: 4, sessionType: .breath, duration: 240, bonusSeconds: 30, completed: true,
            actualTime: 270, clearPercent: 70, thoughtCount: 2,
            mindStateLog: [MindStateEntry(time: 0, state: "clear")],
            attentionLog: [AttentionEntry(time: 1, state: "away")],
            sessionDate: "2026-10-27", breathCount: 12, track: .second,
            clientSessionId: clientSessionId, combined: true
        )
        let decoded = try JSONDecoder().decode(CreateSessionRequest.self, from: JSONEncoder().encode(request))
        XCTAssertEqual(decoded.dayNumber, 4)
        XCTAssertEqual(decoded.sessionType, .breath)
        XCTAssertEqual(decoded.bonusSeconds, 30)
        XCTAssertEqual(decoded.actualTime, 270)
        XCTAssertEqual(decoded.attentionLog?.first?.state, "away")
        XCTAssertEqual(decoded.breathCount, 12)
        XCTAssertEqual(decoded.track, .second)
        XCTAssertEqual(decoded.clientSessionId, clientSessionId)
        XCTAssertTrue(decoded.combined)

        let plain = try JSONEncoder().encode(combinedRequest(nil))
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: plain) as? [String: Any])
        for key in ["attentionLog", "breathCount", "focusCategory", "clientSessionId", "ambientSoundSummary"] {
            XCTAssertNil(object[key], key)
        }
    }
}
