import Foundation
import Testing
@testable import StillPointShared

struct GoogleNativeSignInRequestEncodingTests {
    @Test func testEncodesIDTokenAndServerAuthCode() throws {
        let request = GoogleNativeSignInRequest(
            idToken: "header.payload.signature",
            serverAuthCode: "opaque-code"
        )

        let data = try JSONEncoder().encode(request)
        let object = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])

        #expect((object["idToken"] as? String) == "header.payload.signature")
        #expect((object["serverAuthCode"] as? String) == "opaque-code")
    }

    @Test func testOmitsServerAuthCodeWhenNil() throws {
        let request = GoogleNativeSignInRequest(idToken: "tok")

        let data = try JSONEncoder().encode(request)
        let object = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])

        #expect((object["idToken"] as? String) == "tok")
        #expect(object["serverAuthCode"] == nil)
        #expect(!object.keys.contains("serverAuthCode"))
    }
}
