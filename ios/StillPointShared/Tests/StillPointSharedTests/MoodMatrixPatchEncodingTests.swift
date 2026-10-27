import Foundation
import Testing
import StillPointShared

/// #635: `MoodMatrixPatch` encoding, `MoodMatrixLogic` validation, and `SessionDTO.moodMatrix` decoding.
struct MoodMatrixPatchEncodingTests {

    // MARK: - MoodMatrixPatch encoding

    @Test func testPatchEncodesTouchedRowsOnly() throws {
        let value: [MoodKey: MoodMatrixEntry] = [
            .calm: MoodMatrixEntry(before: 3, after: 4),
            .focus: MoodMatrixEntry(before: nil, after: nil),
        ]
        let patch = MoodMatrixPatch(from: value)
        let data = try JSONEncoder().encode(patch)
        let json = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
        let matrix = try #require(json["moodMatrix"] as? [String: Any])

        #expect((matrix["calm"] as? [String: Int])?["before"] == 3)
        #expect((matrix["calm"] as? [String: Int])?["after"] == 4)
        #expect(matrix["focus"] == nil)
    }

    @Test func testPatchOmitsEmptyPayload() throws {
        let patch = MoodMatrixPatch(from: [:])
        let data = try JSONEncoder().encode(patch)
        let json = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
        let matrix = try #require(json["moodMatrix"] as? [String: Any])
        #expect(matrix.isEmpty)
    }

    @Test func testPatchEncodesPartialCells() throws {
        let value: [MoodKey: MoodMatrixEntry] = [
            .energy: MoodMatrixEntry(before: 2, after: nil),
            .overall: MoodMatrixEntry(before: nil, after: 5),
        ]
        let patch = MoodMatrixPatch(from: value)
        let data = try JSONEncoder().encode(patch)
        let json = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
        let matrix = try #require(json["moodMatrix"] as? [String: Any])

        let energy = try #require(matrix["energy"] as? [String: Any])
        #expect((energy["before"] as? Int) == 2)
        #expect(energy["after"] is NSNull)
        let overall = try #require(matrix["overall"] as? [String: Any])
        #expect(overall["before"] is NSNull)
        #expect((overall["after"] as? Int) == 5)
    }

    @Test func testPatchEncodesMinAndMaxBoundaries() throws {
        let value: [MoodKey: MoodMatrixEntry] = [
            .anxiety: MoodMatrixEntry(before: 1, after: 5),
        ]
        let patch = MoodMatrixPatch(from: value)
        let data = try JSONEncoder().encode(patch)
        let json = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
        let matrix = try #require(json["moodMatrix"] as? [String: Any])
        let anxiety = try #require(matrix["anxiety"] as? [String: Int])

        #expect(anxiety["before"] == 1)
        #expect(anxiety["after"] == 5)
    }

    // MARK: - #792 clearing a saved mood

    @Test func testClearPatchEncodesANullMoodMatrix() throws {
        let data = try JSONEncoder().encode(MoodMatrixPatch.clear)
        #expect(String(data: data, encoding: .utf8) == #"{"moodMatrix":null}"#)
    }

    @Test func testPersistedAwarePatchClearsOnceNothingIsSelected() {
        let patch = MoodMatrixPatch(
            from: [.calm: MoodMatrixEntry(before: nil, after: nil)],
            persisted: ["calm": MoodMatrixEntry(before: 2, after: 4)]
        )
        #expect(patch.clearsMatrix)
        #expect(patch.entries.isEmpty)
    }

    @Test func testPersistedAwarePatchSendsAnAllNilRowForEachEmptiedStoredRow() throws {
        let patch = MoodMatrixPatch(
            from: [
                .calm: MoodMatrixEntry(before: nil, after: nil),
                .focus: MoodMatrixEntry(before: 3, after: 5),
            ],
            persisted: [
                "calm": MoodMatrixEntry(before: 2, after: 4),
                "focus": MoodMatrixEntry(before: 3, after: 4),
            ]
        )
        #expect(!patch.clearsMatrix)
        let data = try JSONEncoder().encode(patch)
        let json = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
        let matrix = try #require(json["moodMatrix"] as? [String: Any])

        let calm = try #require(matrix["calm"] as? [String: Any])
        #expect(calm["before"] is NSNull)
        #expect(calm["after"] is NSNull)
        #expect((matrix["focus"] as? [String: Int])?["before"] == 3)
        #expect((matrix["focus"] as? [String: Int])?["after"] == 5)
    }

    @Test func testPersistedAwarePatchLeavesOutRowsThatWereNeverStored() {
        let patch = MoodMatrixPatch(
            from: [
                .energy: MoodMatrixEntry(before: 1, after: nil),
                .overall: MoodMatrixEntry(before: nil, after: nil),
            ],
            persisted: [:]
        )
        #expect(!patch.clearsMatrix)
        #expect(Array(patch.entries.keys) == ["energy"])
    }

    // MARK: - #885 Happiness row

    @Test func testMoodKeyOrderMatchesWebMoodKeys() {
        // Row order on both platforms; web `MOOD_KEYS` in src/lib/moodMatrix.ts.
        #expect(MoodKey.allCases.map(\.rawValue) == ["calm", "focus", "energy", "anxiety", "happiness", "overall"])
        #expect(MoodKey.happiness.label == "Happiness")
    }

    @Test func testPatchEncodesAHappinessRow() throws {
        let patch = MoodMatrixPatch(from: [.happiness: MoodMatrixEntry(before: 2, after: 4)])
        let data = try JSONEncoder().encode(patch)
        let json = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
        let matrix = try #require(json["moodMatrix"] as? [String: Any])
        let happiness = try #require(matrix["happiness"] as? [String: Int])

        #expect(happiness["before"] == 2)
        #expect(happiness["after"] == 4)
        #expect(matrix.count == 1)
    }

    @Test func testSanitizedStoredKeepsAHappinessRow() {
        let stored: [String: MoodMatrixEntry] = [
            "happiness": MoodMatrixEntry(before: 1, after: 5),
            "unknown": MoodMatrixEntry(before: 4, after: 4),
        ]
        let sanitized = MoodMatrixLogic.sanitizedStored(stored)
        #expect(MoodMatrixLogic.isKnownKey("happiness"))
        #expect(sanitized[.happiness] == MoodMatrixEntry(before: 1, after: 5))
        #expect(sanitized.count == 1)
    }

    @Test func testPersistedAwarePatchSendsAnAllNilRowForAnEmptiedHappinessRow() {
        let patch = MoodMatrixPatch(
            from: [
                .happiness: MoodMatrixEntry(before: nil, after: nil),
                .overall: MoodMatrixEntry(before: 2, after: 4),
            ],
            persisted: [
                "happiness": MoodMatrixEntry(before: 3, after: 5),
                "overall": MoodMatrixEntry(before: 2, after: 4),
            ]
        )
        #expect(!patch.clearsMatrix)
        #expect(patch.entries["happiness"] == MoodMatrixEntry())
        #expect(patch.entries["overall"] == MoodMatrixEntry(before: 2, after: 4))
    }

    // MARK: - MoodMatrixLogic validation

    @Test func testClampMoodValueAcceptsOneThroughFive() {
        #expect(MoodMatrixLogic.clampMoodValue(1) == 1)
        #expect(MoodMatrixLogic.clampMoodValue(5) == 5)
        #expect(MoodMatrixLogic.clampMoodValue(3) == 3)
    }

    @Test func testClampMoodValueRejectsOutOfRange() {
        #expect(MoodMatrixLogic.clampMoodValue(0) == nil)
        #expect(MoodMatrixLogic.clampMoodValue(6) == nil)
        #expect(MoodMatrixLogic.clampMoodValue(-1) == nil)
    }

    @Test func testBuildPayloadClampsOutOfRangeCells() {
        let value: [MoodKey: MoodMatrixEntry] = [
            .calm: MoodMatrixEntry(before: 0, after: 6),
        ]
        let payload = MoodMatrixLogic.buildPayload(from: value)
        #expect(payload["calm"]?.before == nil)
        #expect(payload["calm"]?.after == nil)
        #expect(payload.isEmpty)
    }

    @Test func testSanitizedStoredIgnoresUnknownKeys() {
        let stored: [String: MoodMatrixEntry] = [
            "calm": MoodMatrixEntry(before: 2, after: 3),
            "unknown": MoodMatrixEntry(before: 4, after: 4),
        ]
        let sanitized = MoodMatrixLogic.sanitizedStored(stored)
        #expect(sanitized[.calm]?.before == 2)
        #expect(sanitized[.calm]?.after == 3)
        #expect(!sanitized.keys.contains(where: { $0.rawValue == "unknown" }))
        #expect(sanitized.count == 1)
    }

    @Test func testIsTouchedDetectsAnyNonNilCell() {
        #expect(!MoodMatrixLogic.isTouched([:]))
        #expect(
            !MoodMatrixLogic.isTouched([
                .focus: MoodMatrixEntry(before: nil, after: nil),
            ])
        )
        #expect(
            MoodMatrixLogic.isTouched([
                .focus: MoodMatrixEntry(before: 2, after: nil),
            ])
        )
        #expect(
            MoodMatrixLogic.isTouched([
                .overall: MoodMatrixEntry(before: nil, after: 4),
            ])
        )
    }

    // MARK: - SessionDTO moodMatrix decoding

    @Test func testSessionDTODecodesMoodMatrix() throws {
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
        #expect(session.moodMatrix?["calm"]?.before == 2)
        #expect(session.moodMatrix?["calm"]?.after == 4)
        #expect(session.moodMatrix?["focus"]?.before == 3)
        #expect(session.moodMatrix?["focus"]?.after == nil)
    }

    @Test func testSessionDTODefaultsMoodMatrixToNilWhenAbsent() throws {
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
        #expect(session.moodMatrix == nil)
    }

    @Test func testSessionDTOToleratesNullMoodMatrix() throws {
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
        #expect(session.moodMatrix == nil)
    }
}
