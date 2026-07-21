import XCTest
import StillPointShared

/// #612: `SessionDTO` decodes defensively so a single drifted, additive, or unexpected
/// value in the session-history payload never fails the whole Progress list. Identity
/// fields stay strict; everything else is tolerated.
final class SessionDTOTests: XCTestCase {
    func testDecodesFullSession() throws {
        let json = """
        {
          "id": "s1",
          "dayNumber": 12,
          "sessionType": "breath",
          "duration": 180,
          "bonusSeconds": 60,
          "completed": true,
          "actualTime": 200,
          "clearPercent": 82,
          "thoughtCount": 3,
          "mindStateLog": [{"time": 0, "state": "clear"}, {"time": 40.5, "state": "thinking"}],
          "attentionLog": [{"time": 0, "state": "attentive"}],
          "sessionDate": "2026-06-11",
          "createdAt": "2026-06-11T08:00:00.000Z",
          "buddySessionId": "b1",
          "breathCount": 24,
          "track": "second",
          "ambientSoundSummary": {
            "avgDb": -42.5, "peakDb": -12.0, "quietPercent": 80, "loudPercent": 20, "sampleCount": 120
          }
        }
        """.data(using: .utf8)!

        let s = try JSONDecoder().decode(SessionDTO.self, from: json)
        XCTAssertEqual(s.id, "s1")
        XCTAssertEqual(s.dayNumber, 12)
        XCTAssertEqual(s.sessionType, .breath)
        XCTAssertEqual(s.duration, 180)
        XCTAssertEqual(s.bonusSeconds, 60)
        XCTAssertTrue(s.completed)
        XCTAssertEqual(s.actualTime, 200)
        XCTAssertEqual(s.clearPercent, 82)
        XCTAssertEqual(s.thoughtCount, 3)
        XCTAssertEqual(s.mindStateLog?.count, 2)
        XCTAssertEqual(s.attentionLog?.first?.state, "attentive")
        XCTAssertEqual(s.sessionDate, "2026-06-11")
        XCTAssertEqual(s.createdAt, "2026-06-11T08:00:00.000Z")
        XCTAssertEqual(s.buddySessionId, "b1")
        XCTAssertEqual(s.breathCount, 24)
        XCTAssertEqual(s.track, .second)
        XCTAssertEqual(s.ambientSoundSummary?.sampleCount, 120)
    }

    /// Unknown/additive keys (e.g. server fields the iOS DTO never modelled, or ones the
    /// backend projection now drops) must be ignored, not rejected.
    func testDecodesWhenUnknownAdditiveFieldsPresent() throws {
        let json = """
        {
          "id": "s2",
          "dayNumber": 1,
          "sessionType": "standard",
          "duration": 60,
          "completed": true,
          "actualTime": 60,
          "clearPercent": 50,
          "thoughtCount": 0,
          "mindStateLog": [],
          "sessionDate": "2026-06-10",
          "userId": "leaked-user-id",
          "focusRating": 7,
          "happinessRating": 9,
          "someFutureField": {"nested": true}
        }
        """.data(using: .utf8)!

        let s = try JSONDecoder().decode(SessionDTO.self, from: json)
        XCTAssertEqual(s.id, "s2")
        XCTAssertEqual(s.clearPercent, 50)
    }

    /// A response that predates the optional fields (bonusSeconds, actualTime, track,
    /// breathCount, ambient summary, logs) must still decode, defaulting them.
    func testDefaultsOptionalFieldsWhenMissing() throws {
        let json = """
        {
          "id": "s3",
          "dayNumber": 5,
          "duration": 100,
          "completed": false,
          "clearPercent": 30,
          "thoughtCount": 2,
          "sessionDate": "2026-06-09"
        }
        """.data(using: .utf8)!

        let s = try JSONDecoder().decode(SessionDTO.self, from: json)
        XCTAssertEqual(s.sessionType, .standard)   // absent → default
        XCTAssertNil(s.track)
        XCTAssertNil(s.bonusSeconds)
        XCTAssertNil(s.actualTime)
        XCTAssertNil(s.mindStateLog)
        XCTAssertNil(s.attentionLog)
        XCTAssertNil(s.createdAt)
        XCTAssertNil(s.buddySessionId)
        XCTAssertNil(s.breathCount)
        XCTAssertNil(s.ambientSoundSummary)
    }

    /// An unknown `sessionType` raw value (a session kind added server-side before an app
    /// update) must fall back to `.standard` rather than throwing and failing the list.
    func testUnknownSessionTypeFallsBackToStandard() throws {
        let json = """
        {
          "id": "s4", "dayNumber": 2, "sessionType": "loving-kindness", "duration": 60,
          "completed": true, "clearPercent": 40, "thoughtCount": 1, "sessionDate": "2026-06-08"
        }
        """.data(using: .utf8)!

        let s = try JSONDecoder().decode(SessionDTO.self, from: json)
        XCTAssertEqual(s.sessionType, .standard)
    }

    /// An unknown `track` raw value must fall back to nil (callers treat nil as `.primary`).
    func testUnknownTrackFallsBackToNil() throws {
        let json = """
        {
          "id": "s5", "dayNumber": 2, "sessionType": "standard", "track": "tertiary",
          "duration": 60, "completed": true, "clearPercent": 40, "thoughtCount": 1,
          "sessionDate": "2026-06-07"
        }
        """.data(using: .utf8)!

        let s = try JSONDecoder().decode(SessionDTO.self, from: json)
        XCTAssertNil(s.track)
    }

    /// Identity/structural fields stay strict — a genuinely malformed row (missing a
    /// required field) must still throw so it is not silently coerced to a bogus session.
    func testMissingIdentityFieldThrows() {
        let json = """
        {
          "id": "s6", "dayNumber": 2, "sessionType": "standard", "duration": 60,
          "completed": true, "thoughtCount": 1, "sessionDate": "2026-06-06"
        }
        """.data(using: .utf8)!  // clearPercent omitted

        XCTAssertThrowsError(try JSONDecoder().decode(SessionDTO.self, from: json)) { error in
            XCTAssertTrue(error is DecodingError)
        }
    }

    func testRoundTripsThroughEncodeAndDecode() throws {
        let original = SessionDTO(
            id: "s7",
            dayNumber: 9,
            sessionType: .quick,
            duration: 60,
            bonusSeconds: 30,
            completed: true,
            actualTime: 90,
            clearPercent: 77,
            thoughtCount: 4,
            mindStateLog: [MindStateEntry(time: 0, state: "clear")],
            attentionLog: [AttentionEntry(time: 0, state: "attentive")],
            sessionDate: "2026-06-05",
            createdAt: "2026-06-05T10:00:00.000Z",
            buddySessionId: nil,
            breathCount: nil,
            track: .primary,
            ambientSoundSummary: AmbientSoundSummary(
                avgDb: -40, peakDb: -10, quietPercent: 70, loudPercent: 30, sampleCount: 50
            )
        )

        let data = try JSONEncoder().encode(original)
        let decoded = try JSONDecoder().decode(SessionDTO.self, from: data)

        XCTAssertEqual(decoded.id, original.id)
        XCTAssertEqual(decoded.sessionType, original.sessionType)
        XCTAssertEqual(decoded.bonusSeconds, original.bonusSeconds)
        XCTAssertEqual(decoded.actualTime, original.actualTime)
        XCTAssertEqual(decoded.track, original.track)
        XCTAssertEqual(decoded.mindStateLog, original.mindStateLog)
        XCTAssertEqual(decoded.ambientSoundSummary, original.ambientSoundSummary)
    }

    /// A malformed mind-state log (wrong element shape) must degrade to nil, not fail the
    /// whole session — otherwise one bad row nukes the entire history list (#612).
    func testToleratesMalformedMindStateLog() throws {
        let json = """
        {
          "id": "s8", "dayNumber": 2, "sessionType": "standard", "duration": 60,
          "completed": true, "clearPercent": 40, "thoughtCount": 1, "sessionDate": "2026-06-04",
          "mindStateLog": [{"time": "not-a-number", "state": 5}]
        }
        """.data(using: .utf8)!

        let s = try JSONDecoder().decode(SessionDTO.self, from: json)
        XCTAssertNil(s.mindStateLog)
        XCTAssertEqual(s.clearPercent, 40)   // the rest of the row still decoded
    }

    /// A malformed attention log (not even an array) must degrade to nil, not throw.
    func testToleratesMalformedAttentionLog() throws {
        let json = """
        {
          "id": "s9", "dayNumber": 2, "sessionType": "standard", "duration": 60,
          "completed": true, "clearPercent": 40, "thoughtCount": 1, "sessionDate": "2026-06-03",
          "attentionLog": "corrupt"
        }
        """.data(using: .utf8)!

        let s = try JSONDecoder().decode(SessionDTO.self, from: json)
        XCTAssertNil(s.attentionLog)
        XCTAssertEqual(s.id, "s9")
    }

    /// A malformed ambient summary (wrong field types / shape) must degrade to nil.
    func testToleratesMalformedAmbientSummary() throws {
        let json = """
        {
          "id": "s10", "dayNumber": 2, "sessionType": "standard", "duration": 60,
          "completed": true, "clearPercent": 40, "thoughtCount": 1, "sessionDate": "2026-06-02",
          "ambientSoundSummary": {"avgDb": "loud"}
        }
        """.data(using: .utf8)!

        let s = try JSONDecoder().decode(SessionDTO.self, from: json)
        XCTAssertNil(s.ambientSoundSummary)
        XCTAssertEqual(s.id, "s10")
    }
}
