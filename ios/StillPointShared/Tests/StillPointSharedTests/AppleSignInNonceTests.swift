import Foundation
import Testing
@testable import StillPointShared

struct AppleSignInNonceTests {
    @Test func testSha256HexMatchesKnownVector() {
        #expect(AppleSignInNonce.sha256Hex("hello") == "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824")
    }

    @Test func testRandomNonceStringIsSufficientlyLongAndUnique() throws {
        let first = try AppleSignInNonce.randomNonceString()
        let second = try AppleSignInNonce.randomNonceString()

        #expect(first.count >= 32)
        #expect(second.count >= 32)
        #expect(first != second)
    }
}

struct AppleNativeSignInRequestEncodingTests {
    @Test func testEncodesRawNonce() throws {
        let request = AppleNativeSignInRequest(
            identityToken: "header.payload.signature",
            authorizationCode: "opaque-code",
            rawNonce: "nonce-abc",
            user: nil
        )

        let data = try JSONEncoder().encode(request)
        let object = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])

        #expect((object["identityToken"] as? String) == "header.payload.signature")
        #expect((object["authorizationCode"] as? String) == "opaque-code")
        #expect((object["rawNonce"] as? String) == "nonce-abc")
    }
}
