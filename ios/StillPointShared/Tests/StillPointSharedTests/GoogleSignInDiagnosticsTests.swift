import XCTest
@testable import StillPointShared

final class GoogleSignInDiagnosticsTests: XCTestCase {
    func testUserFacingMessageIncludesDomainAndCode() {
        let message = GoogleSignInDiagnostics.userFacingMessage(
            domain: "com.google.GIDSignIn",
            code: -4
        )

        XCTAssertEqual(
            message,
            "Google sign-in failed (com.google.GIDSignIn -4). Please try again."
        )
        // The domain + code must be present so a screenshot of the auth screen is
        // enough to triage the next on-device failure (#471).
        XCTAssertTrue(message.contains("com.google.GIDSignIn"))
        XCTAssertTrue(message.contains("-4"))
    }

    func testLogLineWithoutUnderlyingError() {
        let line = GoogleSignInDiagnostics.logLine(
            domain: "com.google.GIDSignIn",
            code: -4,
            description: "The user has not signed in before or has since signed out."
        )

        XCTAssertEqual(
            line,
            "google-signin failure domain=com.google.GIDSignIn code=-4 "
                + "description=The user has not signed in before or has since signed out."
        )
        XCTAssertFalse(line.contains("underlying="))
    }

    func testLogLineIncludesUnderlyingErrorWhenPresent() {
        let line = GoogleSignInDiagnostics.logLine(
            domain: "com.google.GIDSignIn",
            code: -2,
            description: "A problem reading or writing to the application keychain.",
            underlying: "NSOSStatusErrorDomain -25300 The specified item could not be found in the keychain."
        )

        XCTAssertTrue(line.hasPrefix("google-signin failure domain=com.google.GIDSignIn code=-2"))
        XCTAssertTrue(line.contains("underlying=NSOSStatusErrorDomain -25300"))
    }

    func testLogLineOmitsEmptyUnderlyingError() {
        let line = GoogleSignInDiagnostics.logLine(
            domain: "d",
            code: 1,
            description: "desc",
            underlying: ""
        )

        XCTAssertFalse(line.contains("underlying="))
    }
}
