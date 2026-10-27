import Foundation
import Testing
@testable import StillPointShared

struct CreateSessionEncodingTests {
    @Test func testCreateSessionRequestIncludesAttentionLogWhenPresent() throws {
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
        let object = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
        let attentionLog = try #require(object["attentionLog"] as? [[String: Any]])

        #expect(attentionLog.count == 2)
        #expect((attentionLog[1]["state"] as? String) == "away")
    }

    @Test func testCreateSessionRequestIncludesQuickSessionType() throws {
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
        let object = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])

        #expect((object["sessionType"] as? String) == "quick")
        #expect((object["duration"] as? Int) == 60)
        #expect((object["dayNumber"] as? Int) == 7)
    }

    @Test func testCreateSessionRequestIncludesClientSessionIdWhenPresent() throws {
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
        let object = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
        #expect((object["clientSessionId"] as? String) == clientSessionId.uuidString)
    }

    // MARK: - #839 focus category

    /// No category means no key at all: the server stores an absent category as none,
    /// and every request built before #839 still encodes exactly as it did.
    @Test func testCreateSessionRequestOmitsFocusCategoryWhenNil() throws {
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
            let object = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
            #expect(!object.keys.contains("focusCategory"), Comment(rawValue: request.sessionType.rawValue))
        }
    }

    @Test func testCreateSessionRequestIncludesFocusCategoryWhenSet() throws {
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
        let object = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
        #expect((object["sessionType"] as? String) == "focus")
        #expect((object["focusCategory"] as? String) == "writing")
        #expect((object["duration"] as? Int) == 240)
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
    @Test func testCreateSessionRequestOmitsCombinedWhenFalse() throws {
        #expect(!combinedRequest(nil).combined)
        for request in [combinedRequest(nil), combinedRequest(false)] {
            let data = try JSONEncoder().encode(request)
            let object = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
            #expect(object["combined"] == nil)
        }
        let encoder = JSONEncoder()
        encoder.outputFormatting = .sortedKeys
        #expect(try encoder.encode(combinedRequest(false)) == (try encoder.encode(combinedRequest(nil))))
    }

    @Test func testCreateSessionRequestIncludesCombinedWhenTrue() throws {
        let data = try JSONEncoder().encode(combinedRequest(true))
        let object = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
        #expect((object["combined"] as? Bool) == true)
        #expect((object["track"] as? String) == "primary")
        #expect((object["sessionType"] as? String) == "standard")
    }

    /// The hand-written coding keeps every other key: optionals still drop out when
    /// nil and round-trip when set.
    @Test func testCreateSessionRequestRoundTripsEveryField() throws {
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
        #expect(decoded.dayNumber == 4)
        #expect(decoded.sessionType == .breath)
        #expect(decoded.bonusSeconds == 30)
        #expect(decoded.actualTime == 270)
        #expect(decoded.attentionLog?.first?.state == "away")
        #expect(decoded.breathCount == 12)
        #expect(decoded.track == .second)
        #expect(decoded.clientSessionId == clientSessionId)
        #expect(decoded.combined)

        let plain = try JSONEncoder().encode(combinedRequest(nil))
        let object = try #require(JSONSerialization.jsonObject(with: plain) as? [String: Any])
        for key in ["attentionLog", "breathCount", "focusCategory", "clientSessionId", "ambientSoundSummary"] {
            #expect(object[key] == nil, Comment(rawValue: key))
        }
    }
}
