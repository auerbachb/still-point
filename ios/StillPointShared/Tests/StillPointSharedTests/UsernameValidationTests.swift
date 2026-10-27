import StillPointShared
import Foundation
import Testing

struct UsernameValidationTests {
    @Test func testValidUsernames() {
        #expect(UsernameValidation.isValid("abc"))
        #expect(UsernameValidation.isValid("ios_fixture"))
        #expect(UsernameValidation.isValid("User_123"))
        #expect(UsernameValidation.isValid(String(repeating: "a", count: 30)))
    }

    @Test func testRejectsTooShortOrTooLong() {
        #expect(!UsernameValidation.isValid("ab"))
        #expect(!UsernameValidation.isValid(String(repeating: "a", count: 31)))
    }

    @Test func testRejectsInvalidCharacters() {
        #expect(!UsernameValidation.isValid("user-name"))
        #expect(!UsernameValidation.isValid("user name"))
        #expect(!UsernameValidation.isValid("user.name"))
    }

    @Test func testTrimsWhitespaceForLength() {
        #expect(UsernameValidation.isValid("  abc  "))
        #expect(!UsernameValidation.isValid("  ab  "))
    }
}
