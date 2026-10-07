import XCTest
@testable import StillPointShared

final class SessionNotificationStateRequestEncodingTests: XCTestCase {
    func testEncodesSessionKeyWhenSet() throws {
        let request = SessionNotificationStateRequest(active: true, sessionKey: "sit-a")

        let data = try JSONEncoder().encode(request)
        let jsonObject = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])

        XCTAssertEqual(jsonObject["active"] as? Bool, true)
        XCTAssertEqual(jsonObject["sessionKey"] as? String, "sit-a")
    }

    func testOmitsSessionKeyWhenNil() throws {
        let request = SessionNotificationStateRequest(active: false)

        let data = try JSONEncoder().encode(request)
        let jsonObject = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])

        XCTAssertEqual(jsonObject["active"] as? Bool, false)
        XCTAssertNil(jsonObject["sessionKey"])
    }
}
