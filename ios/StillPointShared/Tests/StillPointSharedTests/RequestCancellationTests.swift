import XCTest
@testable import StillPointShared

/// Issue #759 — `refreshTracksDoneToday()` fails closed on a failure, which is right
/// for an absent answer and wrong for a request that was called off. The classifier
/// is what separates them, so what counts as cancellation is pinned here.
final class RequestCancellationTests: XCTestCase {
    private struct StubError: Error {}

    // MARK: - Cancellation

    func testCancellationErrorIsCancellation() {
        XCTAssertTrue(
            RequestCancellation.isCancellation(CancellationError(), taskIsCancelled: false)
        )
    }

    /// The shape that actually reaches the catch. `URLSession`'s async methods
    /// respond to task cancellation by cancelling the underlying request, which
    /// completes with `NSURLErrorCancelled` — a `CancellationError` is never thrown,
    /// so a classifier that only looked for one would miss every real cancel.
    func testURLSessionCancellationIsCancellation() {
        XCTAssertTrue(
            RequestCancellation.isCancellation(URLError(.cancelled), taskIsCancelled: false)
        )
    }

    /// The task flag stands alone: whatever a torn-down request happened to throw on
    /// its way out, it is not evidence about state we should be correcting.
    func testACancelledTaskIsCancellationWhateverWasThrown() {
        XCTAssertTrue(
            RequestCancellation.isCancellation(StubError(), taskIsCancelled: true)
        )
        XCTAssertTrue(
            RequestCancellation.isCancellation(URLError(.timedOut), taskIsCancelled: true)
        )
    }

    // MARK: - Genuine failure

    func testTransportFailuresAreNotCancellation() {
        for code in [
            URLError.notConnectedToInternet,
            .timedOut,
            .networkConnectionLost,
            .cannotFindHost,
            .dnsLookupFailed,
        ] {
            XCTAssertFalse(
                RequestCancellation.isCancellation(URLError(code), taskIsCancelled: false),
                "\(code) is an absent answer, and failing closed on it is the point"
            )
        }
    }

    func testServerErrorsAreNotCancellation() {
        XCTAssertFalse(
            RequestCancellation.isCancellation(
                APIError(status: 500, message: "boom"),
                taskIsCancelled: false
            )
        )
        XCTAssertFalse(
            RequestCancellation.isCancellation(StubError(), taskIsCancelled: false)
        )
    }
}
