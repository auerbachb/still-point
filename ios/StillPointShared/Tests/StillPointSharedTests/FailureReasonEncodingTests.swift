import XCTest
@testable import StillPointShared

final class FailureReasonEncodingTests: XCTestCase {
    func testSubmitFailureReasonRequestEncodesFields() throws {
        let request = SubmitFailureReasonRequest(reasonDate: "2026-06-24", text: "Too tired")

        let data = try JSONEncoder().encode(request)
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])

        XCTAssertEqual(object["reasonDate"] as? String, "2026-06-24")
        XCTAssertEqual(object["text"] as? String, "Too tired")
    }

    func testFailureReasonLookupDTODecodesMissingNote() throws {
        let json = """
        {
            "exists": false,
            "failureReason": null
        }
        """.data(using: .utf8)!

        let dto = try JSONDecoder().decode(FailureReasonLookupDTO.self, from: json)

        XCTAssertFalse(dto.exists)
        XCTAssertNil(dto.failureReason)
    }

    func testFailureReasonDTODecodesExistingNote() throws {
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

        XCTAssertEqual(dto.id, "reason-1")
        XCTAssertEqual(dto.reasonDate, "2026-06-24")
        XCTAssertEqual(dto.text, "Travel day")
    }
}
