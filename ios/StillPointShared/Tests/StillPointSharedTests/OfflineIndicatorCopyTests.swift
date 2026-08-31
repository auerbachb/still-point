import XCTest
@testable import StillPointShared

/// Issue #703 — the offline strip must not keep promising that sits are saved
/// once a local write is known to have failed.
final class OfflineIndicatorCopyTests: XCTestCase {
    private let promise = "sits are saved and upload when you reconnect"

    func testUsualStripKeepsTheSharedCopyVerbatim() {
        let copy = OfflineIndicatorCopy.copy(for: .savedProgress)

        XCTAssertEqual(copy.label, "OFFLINE · SAVED PROGRESS")
        XCTAssertEqual(
            copy.accessibilityLabel,
            "Offline. Showing your saved progress; sits are saved and upload when you reconnect."
        )
    }

    func testNotStoredStripDropsThePromise() {
        let copy = OfflineIndicatorCopy.copy(for: .sitNotStored)

        XCTAssertFalse(copy.accessibilityLabel.contains(promise))
        XCTAssertTrue(copy.accessibilityLabel.contains("could not be saved on this device"))
        XCTAssertNotEqual(copy.label, OfflineIndicatorCopy.copy(for: .savedProgress).label)
    }

    func testKnownWriteFailureSelectsTheNotStoredCopy() {
        XCTAssertEqual(OfflineIndicatorCopy.state(sitNotStored: true), .sitNotStored)
        XCTAssertEqual(OfflineIndicatorCopy.state(sitNotStored: false), .savedProgress)
    }
}
