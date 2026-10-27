import Foundation
import Testing
@testable import StillPointShared

struct RecordBuddyPersonalSessionRequestEncodingTests {
    @Test func testEncodesEmbeddedThoughtsUsingServerFieldNames() throws {
        let request = RecordBuddyPersonalSessionRequest(
            clearPercent: 80,
            thoughtCount: 1,
            mindStateLog: [
                MindStateEntry(time: 0, state: "clear"),
                MindStateEntry(time: 12, state: "thinking"),
            ],
            actualTime: 60,
            sessionDate: "2026-04-25",
            thoughts: [
                BatchThoughtsRequest.ThoughtInput(
                    timeInSession: 42,
                    text: "iOS buddy note"
                )
            ]
        )

        let data = try JSONEncoder().encode(request)
        let jsonObject = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
        let thoughts = try #require(jsonObject["thoughts"] as? [[String: Any]])

        #expect((jsonObject["clearPercent"] as? Int) == 80)
        #expect((jsonObject["thoughtCount"] as? Int) == 1)
        #expect((jsonObject["actualTime"] as? Int) == 60)
        #expect((jsonObject["sessionDate"] as? String) == "2026-04-25")
        #expect((thoughts.first?["timeInSession"] as? Int) == 42)
        #expect((thoughts.first?["text"] as? String) == "iOS buddy note")
    }

    /// #971: `ThoughtInput` gained an optional `clientThoughtId` for the batch
    /// route. A buddy sit builds its thoughts without one, as
    /// `BuddySessionViewModel` does, so the request keeps exactly its old keys.
    @Test func testEncodesExactlyTheKeysItHadBeforeThoughtIds() throws {
        let request = RecordBuddyPersonalSessionRequest(
            clearPercent: 80,
            thoughtCount: 1,
            mindStateLog: [MindStateEntry(time: 0, state: "clear")],
            actualTime: 60,
            sessionDate: "2026-04-25",
            thoughts: [BatchThoughtsRequest.ThoughtInput(timeInSession: 42, text: "iOS buddy note")]
        )

        let data = try JSONEncoder().encode(request)
        let jsonObject = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
        let thoughts = try #require(jsonObject["thoughts"] as? [[String: Any]])

        #expect(Set(jsonObject.keys) == ["clearPercent", "thoughtCount", "mindStateLog", "actualTime", "sessionDate", "thoughts"])
        #expect(thoughts.map { Set($0.keys) } == [["timeInSession", "text"]])
    }
}
