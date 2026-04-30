import StillPointShared
import XCTest

final class UsernameValidationTests: XCTestCase {
    func testValidUsernames() {
        XCTAssertTrue(UsernameValidation.isValid("abc"))
        XCTAssertTrue(UsernameValidation.isValid("ios_fixture"))
        XCTAssertTrue(UsernameValidation.isValid("User_123"))
        XCTAssertTrue(UsernameValidation.isValid(String(repeating: "a", count: 30)))
    }

    func testRejectsTooShortOrTooLong() {
        XCTAssertFalse(UsernameValidation.isValid("ab"))
        XCTAssertFalse(UsernameValidation.isValid(String(repeating: "a", count: 31)))
    }

    func testRejectsInvalidCharacters() {
        XCTAssertFalse(UsernameValidation.isValid("user-name"))
        XCTAssertFalse(UsernameValidation.isValid("user name"))
        XCTAssertFalse(UsernameValidation.isValid("user.name"))
    }

    func testTrimsWhitespaceForLength() {
        XCTAssertTrue(UsernameValidation.isValid("  abc  "))
        XCTAssertFalse(UsernameValidation.isValid("  ab  "))
    }
}
