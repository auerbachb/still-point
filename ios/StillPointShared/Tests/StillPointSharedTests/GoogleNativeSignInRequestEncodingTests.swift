import XCTest
@testable import StillPointShared

final class GoogleNativeSignInRequestEncodingTests: XCTestCase {
    func testEncodesIDTokenAndServerAuthCode() throws {
        let request = GoogleNativeSignInRequest(
            idToken: "header.payload.signature",
            serverAuthCode: "opaque-code"
        )

        let data = try JSONEncoder().encode(request)
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])

        XCTAssertEqual(object["idToken"] as? String, "header.payload.signature")
        XCTAssertEqual(object["serverAuthCode"] as? String, "opaque-code")
    }

    func testOmitsServerAuthCodeWhenNil() throws {
        let request = GoogleNativeSignInRequest(idToken: "tok")

        let data = try JSONEncoder().encode(request)
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])

        XCTAssertEqual(object["idToken"] as? String, "tok")
        XCTAssertNil(object["serverAuthCode"])
        XCTAssertFalse(object.keys.contains("serverAuthCode"))
    }
}
