import Foundation
import Testing
@testable import StillPointShared

struct GoogleSignInDiagnosticsTests {
    @Test func testUserFacingMessageIncludesDomainAndCode() {
        let message = GoogleSignInDiagnostics.userFacingMessage(
            domain: "com.google.GIDSignIn",
            code: -4
        )

        #expect(message == "Google sign-in failed (com.google.GIDSignIn -4). Please try again.")
        // The domain + code must be present so a screenshot of the auth screen is
        // enough to triage the next on-device failure (#471).
        #expect(message.contains("com.google.GIDSignIn"))
        #expect(message.contains("-4"))
    }

    @Test func testLogLineWithoutUnderlyingError() {
        let line = GoogleSignInDiagnostics.logLine(
            domain: "com.google.GIDSignIn",
            code: -4,
            description: "The user has not signed in before or has since signed out."
        )

        #expect(
            line == "google-signin failure domain=com.google.GIDSignIn code=-4 "
                + "description=The user has not signed in before or has since signed out."
        )
        #expect(!line.contains("underlying="))
    }

    @Test func testLogLineIncludesUnderlyingErrorWhenPresent() {
        let line = GoogleSignInDiagnostics.logLine(
            domain: "com.google.GIDSignIn",
            code: -2,
            description: "A problem reading or writing to the application keychain.",
            underlying: "NSOSStatusErrorDomain -25300 The specified item could not be found in the keychain."
        )

        #expect(line.hasPrefix("google-signin failure domain=com.google.GIDSignIn code=-2"))
        #expect(line.contains("underlying=NSOSStatusErrorDomain -25300"))
    }

    @Test func testLogLineOmitsEmptyUnderlyingError() {
        let line = GoogleSignInDiagnostics.logLine(
            domain: "d",
            code: 1,
            description: "desc",
            underlying: ""
        )

        #expect(!line.contains("underlying="))
    }
}
