import Foundation
import Testing
@testable import StillPointShared

struct DeviceTokenRegistrationRequestEncodingTests {
    @Test func testEncodesExpectedPayload() throws {
        let request = DeviceTokenRegistrationRequest(
            token: String(repeating: "a", count: 64),
            apnsEnvironment: "development"
        )

        let data = try JSONEncoder().encode(request)
        let object = try #require(JSONSerialization.jsonObject(with: data) as? [String: String])

        #expect(object["token"] == String(repeating: "a", count: 64))
        #expect(object["platform"] == "ios")
        #expect(object["apnsEnvironment"] == "development")
    }
}
