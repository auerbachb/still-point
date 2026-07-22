import XCTest
import StillPointShared

/// #521: `SessionRatingsPatch` nil-omitting encoding, `SessionDTO` rating field decoding,
/// and UITestAPIStore fake round-trip for post-session focus/happiness ratings.
final class SessionRatingsPatchEncodingTests: XCTestCase {

    // MARK: - SessionRatingsPatch encoding

    func testPatchEncodesBothRatingsWhenSet() throws {
        let patch = SessionRatingsPatch(focusRating: 7, happinessRating: 9)
        let data = try JSONEncoder().encode(patch)
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])

        XCTAssertEqual(json["focusRating"] as? Int, 7)
        XCTAssertEqual(json["happinessRating"] as? Int, 9)
    }

    func testPatchOmitsFocusRatingWhenNil() throws {
        let patch = SessionRatingsPatch(happinessRating: 4)
        let data = try JSONEncoder().encode(patch)
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])

        XCTAssertNil(json["focusRating"])
        XCTAssertEqual(json["happinessRating"] as? Int, 4)
    }

    func testPatchOmitsHappinessRatingWhenNil() throws {
        let patch = SessionRatingsPatch(focusRating: 6)
        let data = try JSONEncoder().encode(patch)
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])

        XCTAssertEqual(json["focusRating"] as? Int, 6)
        XCTAssertNil(json["happinessRating"])
    }

    func testPatchEncodesEmptyObjectWhenBothNil() throws {
        let patch = SessionRatingsPatch()
        let data = try JSONEncoder().encode(patch)
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])

        XCTAssertTrue(json.isEmpty, "Expected empty JSON object when both fields are nil")
    }

    func testPatchEncodesMinAndMaxBoundaries() throws {
        let minPatch = SessionRatingsPatch(focusRating: 1, happinessRating: 1)
        let minData = try JSONEncoder().encode(minPatch)
        let minJson = try XCTUnwrap(JSONSerialization.jsonObject(with: minData) as? [String: Any])
        XCTAssertEqual(minJson["focusRating"] as? Int, 1)
        XCTAssertEqual(minJson["happinessRating"] as? Int, 1)

        let maxPatch = SessionRatingsPatch(focusRating: 10, happinessRating: 10)
        let maxData = try JSONEncoder().encode(maxPatch)
        let maxJson = try XCTUnwrap(JSONSerialization.jsonObject(with: maxData) as? [String: Any])
        XCTAssertEqual(maxJson["focusRating"] as? Int, 10)
        XCTAssertEqual(maxJson["happinessRating"] as? Int, 10)
    }

    // MARK: - SessionDTO rating field decoding

    func testSessionDTODecodesRatingFields() throws {
        let json = """
        {
          "id": "r1",
          "dayNumber": 3,
          "sessionType": "standard",
          "duration": 120,
          "completed": true,
          "clearPercent": 75,
          "thoughtCount": 2,
          "sessionDate": "2026-07-22",
          "focusRating": 8,
          "happinessRating": 6
        }
        """.data(using: .utf8)!

        let s = try JSONDecoder().decode(SessionDTO.self, from: json)
        XCTAssertEqual(s.focusRating, 8)
        XCTAssertEqual(s.happinessRating, 6)
    }

    func testSessionDTODefaultsRatingFieldsToNilWhenAbsent() throws {
        let json = """
        {
          "id": "r2",
          "dayNumber": 1,
          "sessionType": "standard",
          "duration": 60,
          "completed": true,
          "clearPercent": 50,
          "thoughtCount": 0,
          "sessionDate": "2026-07-21"
        }
        """.data(using: .utf8)!

        let s = try JSONDecoder().decode(SessionDTO.self, from: json)
        XCTAssertNil(s.focusRating, "focusRating should be nil when absent from JSON")
        XCTAssertNil(s.happinessRating, "happinessRating should be nil when absent from JSON")
    }

    func testSessionDTODecodesNullRatingsAsNil() throws {
        let json = """
        {
          "id": "r3",
          "dayNumber": 2,
          "sessionType": "standard",
          "duration": 90,
          "completed": true,
          "clearPercent": 60,
          "thoughtCount": 1,
          "sessionDate": "2026-07-20",
          "focusRating": null,
          "happinessRating": null
        }
        """.data(using: .utf8)!

        let s = try JSONDecoder().decode(SessionDTO.self, from: json)
        XCTAssertNil(s.focusRating)
        XCTAssertNil(s.happinessRating)
    }

    func testSessionDTORoundTripWithRatingFields() throws {
        let original = SessionDTO(
            id: "r4",
            dayNumber: 5,
            sessionType: .standard,
            duration: 150,
            completed: true,
            actualTime: 150,
            clearPercent: 80,
            thoughtCount: 3,
            mindStateLog: nil,
            sessionDate: "2026-07-19",
            buddySessionId: nil,
            focusRating: 7,
            happinessRating: 9
        )

        let data = try JSONEncoder().encode(original)
        let decoded = try JSONDecoder().decode(SessionDTO.self, from: data)

        XCTAssertEqual(decoded.id, original.id)
        XCTAssertEqual(decoded.focusRating, 7)
        XCTAssertEqual(decoded.happinessRating, 9)
    }

    func testSessionDTORoundTripWithNilRatings() throws {
        let original = SessionDTO(
            id: "r5",
            dayNumber: 4,
            sessionType: .standard,
            duration: 120,
            completed: true,
            actualTime: 120,
            clearPercent: 70,
            thoughtCount: 1,
            mindStateLog: nil,
            sessionDate: "2026-07-18",
            buddySessionId: nil
            // focusRating and happinessRating default to nil
        )

        let data = try JSONEncoder().encode(original)
        let decoded = try JSONDecoder().decode(SessionDTO.self, from: data)

        XCTAssertNil(decoded.focusRating)
        XCTAssertNil(decoded.happinessRating)
    }
}
