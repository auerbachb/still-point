import XCTest
@testable import StillPointShared

final class AppleSignInNonceTests: XCTestCase {
    func testSha256HexMatchesKnownVector() {
        XCTAssertEqual(
            AppleSignInNonce.sha256Hex("hello"),
            "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
        )
    }

    func testRandomNonceStringIsSufficientlyLongAndUnique() {
        let first = AppleSignInNonce.randomNonceString()
        let second = AppleSignInNonce.randomNonceString()

        XCTAssertGreaterThanOrEqual(first.count, 32)
        XCTAssertGreaterThanOrEqual(second.count, 32)
        XCTAssertNotEqual(first, second)
    }
}

final class AppleNativeSignInRequestEncodingTests: XCTestCase {
    func testEncodesRawNonce() throws {
        let request = AppleNativeSignInRequest(
            identityToken: "header.payload.signature",
            authorizationCode: "opaque-code",
            rawNonce: "nonce-abc",
            user: nil
        )

        let data = try JSONEncoder().encode(request)
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])

        XCTAssertEqual(object["identityToken"] as? String, "header.payload.signature")
        XCTAssertEqual(object["authorizationCode"] as? String, "opaque-code")
        XCTAssertEqual(object["rawNonce"] as? String, "nonce-abc")
    }

    func testOmitsRawNonceWhenNil() throws {
        let request = AppleNativeSignInRequest(
            identityToken: "tok",
            authorizationCode: nil,
            user: nil
        )

        let data = try JSONEncoder().encode(request)
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])

        XCTAssertEqual(object["identityToken"] as? String, "tok")
        XCTAssertNil(object["rawNonce"])
        XCTAssertFalse(object.keys.contains("rawNonce"))
    }
}
