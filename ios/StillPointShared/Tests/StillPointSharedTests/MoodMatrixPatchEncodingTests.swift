import XCTest
import StillPointShared

/// #635: `MoodMatrixPatch` encoding, `MoodMatrixLogic` validation, and `SessionDTO.moodMatrix` decoding.
final class MoodMatrixPatchEncodingTests: XCTestCase {

    // MARK: - MoodMatrixPatch encoding

    func testPatchEncodesTouchedRowsOnly() throws {
        let value: [MoodKey: MoodMatrixEntry] = [
            .calm: MoodMatrixEntry(before: 3, after: 4),
            .focus: MoodMatrixEntry(before: nil, after: nil),
        ]
        let patch = MoodMatrixPatch(from: value)
        let data = try JSONEncoder().encode(patch)
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        let matrix = try XCTUnwrap(json["moodMatrix"] as? [String: Any])

        XCTAssertEqual((matrix["calm"] as? [String: Int])?["before"], 3)
        XCTAssertEqual((matrix["calm"] as? [String: Int])?["after"], 4)
        XCTAssertNil(matrix["focus"])
    }

    func testPatchOmitsEmptyPayload() throws {
        let patch = MoodMatrixPatch(from: [:])
        let data = try JSONEncoder().encode(patch)
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        let matrix = try XCTUnwrap(json["moodMatrix"] as? [String: Any])
        XCTAssertTrue(matrix.isEmpty)
    }

    func testPatchEncodesPartialCells() throws {
        let value: [MoodKey: MoodMatrixEntry] = [
            .energy: MoodMatrixEntry(before: 2, after: nil),
            .overall: MoodMatrixEntry(before: nil, after: 5),
        ]
        let patch = MoodMatrixPatch(from: value)
        let data = try JSONEncoder().encode(patch)
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        let matrix = try XCTUnwrap(json["moodMatrix"] as? [String: Any])

        XCTAssertEqual((matrix["energy"] as? [String: Int])?["before"], 2)
        XCTAssertNil((matrix["energy"] as? [String: Int?])?["after"] as? Int)
        XCTAssertEqual((matrix["overall"] as? [String: Int])?["after"], 5)
    }

    func testPatchEncodesMinAndMaxBoundaries() throws {
        let value: [MoodKey: MoodMatrixEntry] = [
            .anxiety: MoodMatrixEntry(before: 1, after: 5),
        ]
        let patch = MoodMatrixPatch(from: value)
        let data = try JSONEncoder().encode(patch)
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        let matrix = try XCTUnwrap(json["moodMatrix"] as? [String: Any])
        let anxiety = try XCTUnwrap(matrix["anxiety"] as? [String: Int])

        XCTAssertEqual(anxiety["before"], 1)
        XCTAssertEqual(anxiety["after"], 5)
    }

    // MARK: - MoodMatrixLogic validation

    func testClampMoodValueAcceptsOneThroughFive() {
        XCTAssertEqual(MoodMatrixLogic.clampMoodValue(1), 1)
        XCTAssertEqual(MoodMatrixLogic.clampMoodValue(5), 5)
        XCTAssertEqual(MoodMatrixLogic.clampMoodValue(3), 3)
    }

    func testClampMoodValueRejectsOutOfRange() {
        XCTAssertNil(MoodMatrixLogic.clampMoodValue(0))
        XCTAssertNil(MoodMatrixLogic.clampMoodValue(6))
        XCTAssertNil(MoodMatrixLogic.clampMoodValue(-1))
    }

    func testBuildPayloadClampsOutOfRangeCells() {
        let value: [MoodKey: MoodMatrixEntry] = [
            .calm: MoodMatrixEntry(before: 0, after: 6),
        ]
        let payload = MoodMatrixLogic.buildPayload(from: value)
        XCTAssertEqual(payload["calm"]?.before, nil)
        XCTAssertEqual(payload["calm"]?.after, nil)
        XCTAssertTrue(payload.isEmpty)
    }

    func testSanitizedStoredIgnoresUnknownKeys() {
        let stored: [String: MoodMatrixEntry] = [
            "calm": MoodMatrixEntry(before: 2, after: 3),
            "unknown": MoodMatrixEntry(before: 4, after: 4),
        ]
        let sanitized = MoodMatrixLogic.sanitizedStored(stored)
        XCTAssertEqual(sanitized[.calm]?.before, 2)
        XCTAssertEqual(sanitized[.calm]?.after, 3)
        XCTAssertFalse(sanitized.keys.contains(where: { $0.rawValue == "unknown" }))
        XCTAssertEqual(sanitized.count, 1)
    }

    func testIsTouchedDetectsAnyNonNilCell() {
        XCTAssertFalse(MoodMatrixLogic.isTouched([:]))
        XCTAssertFalse(MoodMatrixLogic.isTouched([
            .focus: MoodMatrixEntry(before: nil, after: nil),
        ]))
        XCTAssertTrue(MoodMatrixLogic.isTouched([
            .focus: MoodMatrixEntry(before: 2, after: nil),
        ]))
        XCTAssertTrue(MoodMatrixLogic.isTouched([
            .overall: MoodMatrixEntry(before: nil, after: 4),
        ]))
    }

    // MARK: - SessionDTO moodMatrix decoding

    func testSessionDTODecodesMoodMatrix() throws {
        let json = """
        {
          "id": "m1",
          "dayNumber": 3,
          "sessionType": "standard",
          "duration": 120,
          "completed": true,
          "clearPercent": 75,
          "thoughtCount": 2,
          "sessionDate": "2026-07-22",
          "moodMatrix": {
            "calm": { "before": 2, "after": 4 },
            "focus": { "before": 3, "after": null }
          }
        }
        """.data(using: .utf8)!

        let session = try JSONDecoder().decode(SessionDTO.self, from: json)
        XCTAssertEqual(session.moodMatrix?["calm"]?.before, 2)
        XCTAssertEqual(session.moodMatrix?["calm"]?.after, 4)
        XCTAssertEqual(session.moodMatrix?["focus"]?.before, 3)
        XCTAssertNil(session.moodMatrix?["focus"]?.after)
    }

    func testSessionDTODefaultsMoodMatrixToNilWhenAbsent() throws {
        let json = """
        {
          "id": "m2",
          "dayNumber": 1,
          "sessionType": "standard",
          "duration": 60,
          "completed": true,
          "clearPercent": 50,
          "thoughtCount": 0,
          "sessionDate": "2026-07-21"
        }
        """.data(using: .utf8)!

        let session = try JSONDecoder().decode(SessionDTO.self, from: json)
        XCTAssertNil(session.moodMatrix)
    }

    func testSessionDTOToleratesNullMoodMatrix() throws {
        let json = """
        {
          "id": "m3",
          "dayNumber": 2,
          "sessionType": "standard",
          "duration": 90,
          "completed": true,
          "clearPercent": 60,
          "thoughtCount": 1,
          "sessionDate": "2026-07-20",
          "moodMatrix": null
        }
        """.data(using: .utf8)!

        let session = try JSONDecoder().decode(SessionDTO.self, from: json)
        XCTAssertNil(session.moodMatrix)
    }
}
