import XCTest
@testable import StillPointShared

final class DeviceTokenRegistrationRequestEncodingTests: XCTestCase {
    func testEncodesExpectedPayload() throws {
        let request = DeviceTokenRegistrationRequest(
            token: String(repeating: "a", count: 64),
            apnsEnvironment: "development"
        )

        let data = try JSONEncoder().encode(request)
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: String])

        XCTAssertEqual(object["token"], String(repeating: "a", count: 64))
        XCTAssertEqual(object["platform"], "ios")
        XCTAssertEqual(object["apnsEnvironment"], "development")
    }
}
