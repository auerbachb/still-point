import Foundation
import Testing
import StillPointShared

/// #612: `SessionDTO` decodes defensively so a single drifted, additive, or unexpected
/// value in the session-history payload never fails the whole Progress list. Identity
/// fields stay strict; everything else is tolerated.
struct SessionDTOTests {
    @Test func testDecodesFullSession() throws {
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
        #expect(s.id == "s1")
        #expect(s.dayNumber == 12)
        #expect(s.sessionType == .breath)
        #expect(s.duration == 180)
        #expect(s.bonusSeconds == 60)
        #expect(s.completed)
        #expect(s.actualTime == 200)
        #expect(s.clearPercent == 82)
        #expect(s.thoughtCount == 3)
        #expect(s.mindStateLog?.count == 2)
        #expect(s.attentionLog?.first?.state == "attentive")
        #expect(s.sessionDate == "2026-06-11")
        #expect(s.createdAt == "2026-06-11T08:00:00.000Z")
        #expect(s.buddySessionId == "b1")
        #expect(s.breathCount == 24)
        #expect(s.track == .second)
        #expect(s.ambientSoundSummary?.sampleCount == 120)
    }

    /// Unknown/additive keys (e.g. server fields the iOS DTO never modelled, or ones the
    /// backend projection now drops) must be ignored, not rejected.
    @Test func testDecodesWhenUnknownAdditiveFieldsPresent() throws {
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
          "someFutureField": {"nested": true}
        }
        """.data(using: .utf8)!

        let s = try JSONDecoder().decode(SessionDTO.self, from: json)
        #expect(s.id == "s2")
        #expect(s.clearPercent == 50)
    }

    /// #766: iOS no longer models the retired session ratings (#521), but the server keeps
    /// returning the two legacy numbers, so a session that still carries them must decode,
    /// with its mood matrix intact beside them.
    @Test func testDecodesLegacyRatingKeysAlongsideMoodMatrix() throws {
        let json = """
        {
          "id": "s11",
          "dayNumber": 4,
          "sessionType": "standard",
          "duration": 120,
          "completed": true,
          "actualTime": 120,
          "clearPercent": 70,
          "thoughtCount": 1,
          "sessionDate": "2026-10-27",
          "focusRating": 7,
          "happinessRating": 9,
          "moodMatrix": {
            "focus": { "before": 2, "after": 4 },
            "happiness": { "before": 3, "after": 5 },
            "overall": { "before": null, "after": 4 }
          }
        }
        """.data(using: .utf8)!

        let s = try JSONDecoder().decode(SessionDTO.self, from: json)
        #expect(s.id == "s11")
        #expect(s.dayNumber == 4)
        #expect(s.clearPercent == 70)
        // `moodMatrix` decodes with `try?`, so a silent nil would hide a failure.
        let mood = try #require(s.moodMatrix)
        #expect(mood.count == 3)
        #expect(mood[MoodKey.focus.rawValue] == MoodMatrixEntry(before: 2, after: 4))
        #expect(mood[MoodKey.happiness.rawValue] == MoodMatrixEntry(before: 3, after: 5))
        #expect(mood[MoodKey.overall.rawValue] == MoodMatrixEntry(before: nil, after: 4))
    }

    /// A response that predates the optional fields (bonusSeconds, actualTime, track,
    /// breathCount, ambient summary, logs) must still decode, defaulting them.
    @Test func testDefaultsOptionalFieldsWhenMissing() throws {
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
        #expect(s.sessionType == .standard)   // absent → default
        #expect(s.track == nil)
        #expect(s.bonusSeconds == nil)
        #expect(s.actualTime == nil)
        #expect(s.mindStateLog == nil)
        #expect(s.attentionLog == nil)
        #expect(s.createdAt == nil)
        #expect(s.buddySessionId == nil)
        #expect(s.breathCount == nil)
        #expect(s.ambientSoundSummary == nil)
    }

    /// An unknown `sessionType` raw value (a session kind added server-side before an app
    /// update) must fall back to `.standard` rather than throwing and failing the list.
    @Test func testUnknownSessionTypeFallsBackToStandard() throws {
        let json = """
        {
          "id": "s4", "dayNumber": 2, "sessionType": "loving-kindness", "duration": 60,
          "completed": true, "clearPercent": 40, "thoughtCount": 1, "sessionDate": "2026-06-08"
        }
        """.data(using: .utf8)!

        let s = try JSONDecoder().decode(SessionDTO.self, from: json)
        #expect(s.sessionType == .standard)
    }

    /// An unknown `track` raw value must fall back to nil (callers treat nil as `.primary`).
    @Test func testUnknownTrackFallsBackToNil() throws {
        let json = """
        {
          "id": "s5", "dayNumber": 2, "sessionType": "standard", "track": "tertiary",
          "duration": 60, "completed": true, "clearPercent": 40, "thoughtCount": 1,
          "sessionDate": "2026-06-07"
        }
        """.data(using: .utf8)!

        let s = try JSONDecoder().decode(SessionDTO.self, from: json)
        #expect(s.track == nil)
    }

    /// Identity/structural fields stay strict — a genuinely malformed row (missing a
    /// required field) must still throw so it is not silently coerced to a bogus session.
    @Test func testMissingIdentityFieldThrows() {
        let json = """
        {
          "id": "s6", "dayNumber": 2, "sessionType": "standard", "duration": 60,
          "completed": true, "thoughtCount": 1, "sessionDate": "2026-06-06"
        }
        """.data(using: .utf8)!  // clearPercent omitted

        #expect(throws: DecodingError.self) {
            try JSONDecoder().decode(SessionDTO.self, from: json)
        }
    }

    @Test func testRoundTripsThroughEncodeAndDecode() throws {
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

        #expect(decoded.id == original.id)
        #expect(decoded.sessionType == original.sessionType)
        #expect(decoded.bonusSeconds == original.bonusSeconds)
        #expect(decoded.actualTime == original.actualTime)
        #expect(decoded.track == original.track)
        #expect(decoded.mindStateLog == original.mindStateLog)
        #expect(decoded.ambientSoundSummary == original.ambientSoundSummary)
    }

    /// A malformed mind-state log (wrong element shape) must degrade to nil, not fail the
    /// whole session — otherwise one bad row nukes the entire history list (#612).
    @Test func testToleratesMalformedMindStateLog() throws {
        let json = """
        {
          "id": "s8", "dayNumber": 2, "sessionType": "standard", "duration": 60,
          "completed": true, "clearPercent": 40, "thoughtCount": 1, "sessionDate": "2026-06-04",
          "mindStateLog": [{"time": "not-a-number", "state": 5}]
        }
        """.data(using: .utf8)!

        let s = try JSONDecoder().decode(SessionDTO.self, from: json)
        #expect(s.mindStateLog == nil)
        #expect(s.clearPercent == 40)   // the rest of the row still decoded
    }

    /// A malformed attention log (not even an array) must degrade to nil, not throw.
    @Test func testToleratesMalformedAttentionLog() throws {
        let json = """
        {
          "id": "s9", "dayNumber": 2, "sessionType": "standard", "duration": 60,
          "completed": true, "clearPercent": 40, "thoughtCount": 1, "sessionDate": "2026-06-03",
          "attentionLog": "corrupt"
        }
        """.data(using: .utf8)!

        let s = try JSONDecoder().decode(SessionDTO.self, from: json)
        #expect(s.attentionLog == nil)
        #expect(s.id == "s9")
    }

    /// A malformed ambient summary (wrong field types / shape) must degrade to nil.
    @Test func testToleratesMalformedAmbientSummary() throws {
        let json = """
        {
          "id": "s10", "dayNumber": 2, "sessionType": "standard", "duration": 60,
          "completed": true, "clearPercent": 40, "thoughtCount": 1, "sessionDate": "2026-06-02",
          "ambientSoundSummary": {"avgDb": "loud"}
        }
        """.data(using: .utf8)!

        let s = try JSONDecoder().decode(SessionDTO.self, from: json)
        #expect(s.ambientSoundSummary == nil)
        #expect(s.id == "s10")
    }

    // MARK: - #839 focus sessions

    /// A focus session as `GET /api/sessions` returns it (#837): its own type,
    /// read as `.focus` rather than falling back to a standard sit.
    @Test func testDecodesFocusSessionWithCategory() throws {
        let json = """
        {
          "id": "f1", "dayNumber": 4, "sessionType": "focus", "duration": 240, "completed": true,
          "actualTime": 240, "clearPercent": 0, "thoughtCount": 0, "mindStateLog": [],
          "sessionDate": "2026-10-27", "focusCategory": "reading", "track": "primary",
          "combined": false
        }
        """.data(using: .utf8)!

        let s = try JSONDecoder().decode(SessionDTO.self, from: json)
        #expect(s.sessionType == .focus)
        #expect(s.focusCategory == .reading)
        #expect(s.duration == 240)
    }

    /// A focus session saved before #837 has no category: absent or null both decode as nil.
    @Test func testDecodesFocusSessionWithoutCategory() throws {
        let absent = """
        {
          "id": "f2", "dayNumber": 1, "sessionType": "focus", "duration": 60, "completed": true,
          "clearPercent": 0, "thoughtCount": 0, "sessionDate": "2026-10-26"
        }
        """.data(using: .utf8)!
        let null = """
        {
          "id": "f3", "dayNumber": 2, "sessionType": "focus", "duration": 120, "completed": false,
          "clearPercent": 0, "thoughtCount": 0, "sessionDate": "2026-10-26", "focusCategory": null
        }
        """.data(using: .utf8)!

        for data in [absent, null] {
            let s = try JSONDecoder().decode(SessionDTO.self, from: data)
            #expect(s.sessionType == .focus, Comment(rawValue: s.id))
            #expect(s.focusCategory == nil, Comment(rawValue: s.id))
        }
    }

    /// A category this build does not know (a future one, or a drifted value) reads as
    /// no category, like an unknown `track`, and the row stays a focus session.
    @Test func testUnknownFocusCategoryDecodesAsNilAndKeepsTheFocusType() throws {
        for category in ["\"music\"", "\"Reading\"", "\"\"", "3"] {
            let json = """
            {
              "id": "f4", "dayNumber": 2, "sessionType": "focus", "duration": 120, "completed": true,
              "clearPercent": 0, "thoughtCount": 0, "sessionDate": "2026-10-25", "focusCategory": \(category)
            }
            """.data(using: .utf8)!

            let s = try JSONDecoder().decode(SessionDTO.self, from: json)
            #expect(s.sessionType == .focus, Comment(rawValue: category))
            #expect(s.focusCategory == nil, Comment(rawValue: category))
        }
    }

    /// The server sends `focusCategory: null` on every other session type.
    @Test func testMeditationSessionCarriesNoCategory() throws {
        let json = """
        {
          "id": "s12", "dayNumber": 9, "sessionType": "standard", "duration": 140, "completed": true,
          "clearPercent": 60, "thoughtCount": 2, "sessionDate": "2026-10-25", "focusCategory": null
        }
        """.data(using: .utf8)!

        let s = try JSONDecoder().decode(SessionDTO.self, from: json)
        #expect(s.sessionType == .standard)
        #expect(s.focusCategory == nil)
    }

    /// #909 added `combined` to every session row. iOS does not model it until #896, so a
    /// payload carrying it, including a combined sit, must still decode as before.
    @Test func testDecodesPayloadCarryingTheCombinedFlag() throws {
        let json = """
        {
          "id": "c1", "dayNumber": 60, "sessionType": "standard", "track": "primary", "combined": true,
          "duration": 600, "completed": true, "actualTime": 600, "clearPercent": 70, "thoughtCount": 1,
          "sessionDate": "2026-10-27", "focusCategory": null
        }
        """.data(using: .utf8)!

        let s = try JSONDecoder().decode(SessionDTO.self, from: json)
        #expect(s.id == "c1")
        #expect(s.sessionType == .standard)
        #expect(s.track == .primary)
        #expect(s.completed)
        #expect(s.focusCategory == nil)
    }

    /// The UI-test store persists sessions by encoding them, so the category has to survive.
    @Test func testFocusCategoryRoundTripsThroughEncodeAndDecode() throws {
        let original = SessionDTO(
            id: "f5",
            dayNumber: 3,
            sessionType: .focus,
            duration: 180,
            completed: true,
            actualTime: 180,
            clearPercent: 0,
            thoughtCount: 0,
            mindStateLog: [],
            sessionDate: "2026-10-27",
            buddySessionId: nil,
            focusCategory: .listening
        )

        let data = try JSONEncoder().encode(original)
        let object = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
        #expect((object["focusCategory"] as? String) == "listening")

        let decoded = try JSONDecoder().decode(SessionDTO.self, from: data)
        #expect(decoded.sessionType == .focus)
        #expect(decoded.focusCategory == .listening)
    }
}

// MARK: - #896 combined sit

extension SessionDTOTests {
    private func decodeCombined(_ fragment: String) throws -> SessionDTO {
        let json = """
        {"id":"c1","dayNumber":30,"sessionType":"standard","duration":1200,"completed":true,\
        "clearPercent":80,"thoughtCount":0,"sessionDate":"2026-10-27","track":"primary"\(fragment)}
        """
        return try JSONDecoder().decode(SessionDTO.self, from: Data(json.utf8))
    }

    @Test func testDecodesCombinedTrue() throws {
        #expect(try decodeCombined(#","combined":true"#).combined == true)
    }

    @Test func testDecodesCombinedFalse() throws {
        #expect(try decodeCombined(#","combined":false"#).combined == false)
    }

    @Test func testMissingOrNullCombinedReadsAsNotCombined() throws {
        #expect(try decodeCombined("").combined == nil)
        #expect(try decodeCombined(#","combined":null"#).combined == nil)
    }

    /// A wrong-typed value reads as not combined and never fails the history list.
    @Test func testWrongTypedCombinedReadsAsNotCombined() throws {
        let s = try decodeCombined(#","combined":"yes""#)
        #expect(s.combined == nil)
        #expect(s.id == "c1")
        #expect(try decodeCombined(#","combined":1"#).combined == nil)
    }

    @Test func testInitializerDefaultsCombinedToNil() {
        let s = SessionDTO(
            id: "c2", dayNumber: 1, duration: 60, completed: true, actualTime: 60,
            clearPercent: 0, thoughtCount: 0, mindStateLog: nil, sessionDate: "2026-10-27",
            buddySessionId: nil
        )
        #expect(s.combined == nil)
    }
}
