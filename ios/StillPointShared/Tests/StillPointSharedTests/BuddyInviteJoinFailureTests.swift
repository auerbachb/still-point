import XCTest
import StillPointShared

/// #756 — which join failures spend a buddy invite. `AppViewModel` is Xcode-only,
/// so the decision lives in the package where `swift test` can reach it.
final class BuddyInviteJoinFailureTests: XCTestCase {

    // MARK: - Invite-specific rejections spend the token

    /// AC: an invalid, missing, or malformed token (`400`) is a real rejection.
    func testBadRequestIsAuthoritative() {
        let error = APIError(status: 400, message: "token is required")
        XCTAssertEqual(BuddyInviteJoinFailure.classify(error), .authoritative)
    }

    /// AC: not friends with the host (`403`) will not succeed on retry.
    func testForbiddenIsAuthoritative() {
        let error = APIError(status: 403, message: "You must be friends with the host to join")
        XCTAssertEqual(BuddyInviteJoinFailure.classify(error), .authoritative)
    }

    /// AC: an unknown invite (`404`) is spent.
    func testNotFoundIsAuthoritative() {
        let error = APIError(status: 404, message: "Session not found")
        XCTAssertEqual(BuddyInviteJoinFailure.classify(error), .authoritative)
    }

    /// AC: expired, abandoned, or already started (`409`) is spent.
    func testConflictIsAuthoritative() {
        let error = APIError(status: 409, message: "This session is no longer available")
        XCTAssertEqual(BuddyInviteJoinFailure.classify(error), .authoritative)
    }

    // MARK: - Anything else keeps the invite

    /// A response-less `APIError` is how the client models a dead network.
    func testResponselessAPIErrorIsTransient() {
        let error = APIError(status: 0, message: "No internet connection")
        XCTAssertEqual(BuddyInviteJoinFailure.classify(error), .transient)
    }

    /// `401` is `requireAuth` rejecting the session, not the invite.
    func testUnauthorizedIsTransient() {
        let error = APIError(status: 401, message: "Unauthorized")
        XCTAssertEqual(BuddyInviteJoinFailure.classify(error), .transient)
    }

    func testServerErrorIsTransient() {
        let error = APIError(status: 500, message: "Request failed")
        XCTAssertEqual(BuddyInviteJoinFailure.classify(error), .transient)
    }

    func testServiceUnavailableIsTransient() {
        let error = APIError(status: 503, message: "Request failed")
        XCTAssertEqual(BuddyInviteJoinFailure.classify(error), .transient)
    }

    /// A client status the join route does not use must not spend the invite.
    /// Wrongly consuming loses it; a later retry does not.
    func testUnlistedClientErrorIsTransient() {
        let error = APIError(status: 429, message: "Slow down")
        XCTAssertEqual(BuddyInviteJoinFailure.classify(error), .transient)
    }

    func testNotConnectedIsTransient() {
        XCTAssertEqual(
            BuddyInviteJoinFailure.classify(URLError(.notConnectedToInternet)),
            .transient
        )
    }

    func testTimeoutIsTransient() {
        XCTAssertEqual(BuddyInviteJoinFailure.classify(URLError(.timedOut)), .transient)
    }

    func testConnectionLostIsTransient() {
        XCTAssertEqual(
            BuddyInviteJoinFailure.classify(URLError(.networkConnectionLost)),
            .transient
        )
    }

    func testDecodingErrorIsTransient() {
        let error = DecodingError.dataCorrupted(
            DecodingError.Context(codingPath: [], debugDescription: "bad join payload")
        )
        XCTAssertEqual(BuddyInviteJoinFailure.classify(error), .transient)
    }

    func testUnexpectedErrorIsTransient() {
        struct UnexpectedJoinError: Error {}
        XCTAssertEqual(BuddyInviteJoinFailure.classify(UnexpectedJoinError()), .transient)
    }
}
