import Foundation
import Testing
@testable import StillPointShared

struct SessionNotificationStateRequestEncodingTests {
    @Test func testEncodesSessionKeyWhenSet() throws {
        let request = SessionNotificationStateRequest(active: true, sessionKey: "sit-a")

        let data = try JSONEncoder().encode(request)
        let jsonObject = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])

        #expect((jsonObject["active"] as? Bool) == true)
        #expect((jsonObject["sessionKey"] as? String) == "sit-a")
    }

    @Test func testOmitsSessionKeyWhenNil() throws {
        let request = SessionNotificationStateRequest(active: false)

        let data = try JSONEncoder().encode(request)
        let jsonObject = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])

        #expect((jsonObject["active"] as? Bool) == false)
        #expect(jsonObject["sessionKey"] == nil)
    }
}
