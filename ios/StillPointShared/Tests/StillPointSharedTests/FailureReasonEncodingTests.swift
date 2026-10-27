import Foundation
import Testing
@testable import StillPointShared

struct FailureReasonEncodingTests {
    @Test func testSubmitFailureReasonRequestEncodesFields() throws {
        let request = SubmitFailureReasonRequest(reasonDate: "2026-06-24", text: "Too tired")

        let data = try JSONEncoder().encode(request)
        let object = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])

        #expect((object["reasonDate"] as? String) == "2026-06-24")
        #expect((object["text"] as? String) == "Too tired")
    }

    @Test func testFailureReasonLookupDTODecodesMissingFailureReason() throws {
        let json = """
        {
            "exists": false,
            "failureReason": null
        }
        """.data(using: .utf8)!

        let dto = try JSONDecoder().decode(FailureReasonLookupDTO.self, from: json)

        #expect(!dto.exists)
        #expect(dto.failureReason == nil)
    }

    @Test func testFailureReasonDTODecodesExistingFailureReason() throws {
        let json = """
        {
            "id": "reason-1",
            "reasonDate": "2026-06-24",
            "text": "Travel day",
            "createdAt": "2026-06-24T20:05:00.000Z",
            "updatedAt": "2026-06-24T20:05:00.000Z"
        }
        """.data(using: .utf8)!

        let dto = try JSONDecoder().decode(FailureReasonDTO.self, from: json)

        #expect(dto.id == "reason-1")
        #expect(dto.reasonDate == "2026-06-24")
        #expect(dto.text == "Travel day")
    }
}
