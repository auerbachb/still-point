import Foundation
import Testing
import StillPointShared

/// #756 — which join failures spend a buddy invite. `AppViewModel` is Xcode-only,
/// so the decision lives in the package where `swift test` can reach it.
struct BuddyInviteJoinFailureTests {

    // MARK: - Invite-specific rejections spend the token

    /// AC: an invalid, missing, or malformed token (`400`) is a real rejection.
    @Test func testBadRequestIsAuthoritative() {
        let error = APIError(status: 400, message: "token is required")
        #expect(BuddyInviteJoinFailure.classify(error) == .authoritative)
    }

    /// AC: not friends with the host (`403`) will not succeed on retry.
    @Test func testForbiddenIsAuthoritative() {
        let error = APIError(status: 403, message: "You must be friends with the host to join")
        #expect(BuddyInviteJoinFailure.classify(error) == .authoritative)
    }

    /// AC: an unknown invite (`404`) is spent.
    @Test func testNotFoundIsAuthoritative() {
        let error = APIError(status: 404, message: "Session not found")
        #expect(BuddyInviteJoinFailure.classify(error) == .authoritative)
    }

    /// AC: expired, abandoned, or already started (`409`) is spent.
    @Test func testConflictIsAuthoritative() {
        let error = APIError(status: 409, message: "This session is no longer available")
        #expect(BuddyInviteJoinFailure.classify(error) == .authoritative)
    }

    // MARK: - Anything else keeps the invite

    /// A response-less `APIError` is how the client models a dead network.
    @Test func testResponselessAPIErrorIsTransient() {
        let error = APIError(status: 0, message: "No internet connection")
        #expect(BuddyInviteJoinFailure.classify(error) == .transient)
    }

    /// `401` is `requireAuth` rejecting the session, not the invite.
    @Test func testUnauthorizedIsTransient() {
        let error = APIError(status: 401, message: "Unauthorized")
        #expect(BuddyInviteJoinFailure.classify(error) == .transient)
    }

    @Test func testServerErrorIsTransient() {
        let error = APIError(status: 500, message: "Request failed")
        #expect(BuddyInviteJoinFailure.classify(error) == .transient)
    }

    @Test func testServiceUnavailableIsTransient() {
        let error = APIError(status: 503, message: "Request failed")
        #expect(BuddyInviteJoinFailure.classify(error) == .transient)
    }

    /// A client status the join route does not use must not spend the invite.
    /// Wrongly consuming loses it; a later retry does not.
    @Test func testUnlistedClientErrorIsTransient() {
        let error = APIError(status: 429, message: "Slow down")
        #expect(BuddyInviteJoinFailure.classify(error) == .transient)
    }

    @Test func testNotConnectedIsTransient() {
        #expect(BuddyInviteJoinFailure.classify(URLError(.notConnectedToInternet)) == .transient)
    }

    @Test func testTimeoutIsTransient() {
        #expect(BuddyInviteJoinFailure.classify(URLError(.timedOut)) == .transient)
    }

    @Test func testConnectionLostIsTransient() {
        #expect(BuddyInviteJoinFailure.classify(URLError(.networkConnectionLost)) == .transient)
    }

    @Test func testDecodingErrorIsTransient() {
        let error = DecodingError.dataCorrupted(
            DecodingError.Context(codingPath: [], debugDescription: "bad join payload")
        )
        #expect(BuddyInviteJoinFailure.classify(error) == .transient)
    }

    @Test func testUnexpectedErrorIsTransient() {
        struct UnexpectedJoinError: Error {}
        #expect(BuddyInviteJoinFailure.classify(UnexpectedJoinError()) == .transient)
    }
}
