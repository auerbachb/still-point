import XCTest
@testable import StillPointShared

/// Issue #703 — the offline strip must not keep promising that sits are saved
/// once a local write is known to have failed.
///
/// Issue #717 — and it must be able to say so while the user is online, without
/// calling them offline to do it.
///
/// Ported to `src/lib/offlineIndicatorCopy.test.ts` so both clients assert the
/// same strings; keep the two files in step.
final class OfflineIndicatorCopyTests: XCTestCase {
    private let promise = "sits are saved and upload when you reconnect"

    // MARK: - #703: the disconnected copy is unchanged

    func testUsualStripKeepsTheSharedCopyVerbatim() {
        let copy = OfflineIndicatorCopy.copy(for: .offlineSavedProgress)

        XCTAssertEqual(copy.label, "OFFLINE · SAVED PROGRESS")
        XCTAssertEqual(
            copy.accessibilityLabel,
            "Offline. Showing your saved progress; sits are saved and upload when you reconnect."
        )
    }

    func testNotStoredStripDropsThePromise() {
        let copy = OfflineIndicatorCopy.copy(for: .offlineSitNotStored)

        XCTAssertEqual(copy.label, "OFFLINE · SIT NOT SAVED")
        XCTAssertEqual(
            copy.accessibilityLabel,
            "Offline. A sit could not be saved on this device, so it will not upload when you reconnect."
        )
        XCTAssertFalse(copy.accessibilityLabel.contains(promise))
        XCTAssertTrue(copy.accessibilityLabel.contains("could not be saved on this device"))
        XCTAssertNotEqual(copy.label, OfflineIndicatorCopy.copy(for: .offlineSavedProgress).label)
    }

    // MARK: - #717: the online failure copy

    func testOnlineStripReportsTheSameLossWithoutClaimingADisconnection() {
        let copy = OfflineIndicatorCopy.copy(for: .onlineSitNotStored)

        XCTAssertEqual(copy.label, "SIT NOT SAVED")
        XCTAssertEqual(
            copy.accessibilityLabel,
            "A sit could not be saved on this device, so it will not upload."
        )
    }

    func testNeitherStringTellsAConnectedUserTheyAreOffline() {
        let copy = OfflineIndicatorCopy.copy(for: .onlineSitNotStored)

        XCTAssertFalse(copy.label.contains("OFFLINE"))
        XCTAssertFalse(copy.accessibilityLabel.lowercased().contains("offline"))
        // There is nothing to reconnect to, so nothing is waiting to upload later.
        XCTAssertFalse(copy.accessibilityLabel.contains("reconnect"))
    }

    func testAccessibilityLabelCarriesTheVisibleLabelsMeaning() {
        // The glyph and label are ignored for accessibility, so this string is the
        // whole announcement — it has to say what the strip shows, in both states.
        XCTAssertTrue(
            OfflineIndicatorCopy.copy(for: .onlineSitNotStored)
                .accessibilityLabel.contains("could not be saved on this device")
        )
        XCTAssertTrue(
            OfflineIndicatorCopy.copy(for: .offlineSitNotStored)
                .accessibilityLabel.contains("could not be saved on this device")
        )
        XCTAssertTrue(
            OfflineIndicatorCopy.copy(for: .offlineSitNotStored)
                .accessibilityLabel.contains("Offline.")
        )
    }

    // MARK: - #717: when the strip is raised at all

    func testKnownWriteFailureSelectsTheNotStoredCopyForEitherConnectivity() {
        XCTAssertEqual(
            OfflineIndicatorCopy.state(offline: true, sitNotStored: true),
            .offlineSitNotStored
        )
        XCTAssertEqual(
            OfflineIndicatorCopy.state(offline: false, sitNotStored: true),
            .onlineSitNotStored
        )
    }

    func testOfflineWithEverythingIntactKeepsTheOriginalStrip() {
        XCTAssertEqual(
            OfflineIndicatorCopy.state(offline: true, sitNotStored: false),
            .offlineSavedProgress
        )
    }

    func testOnlineWithTheSitStoredIsTheOneCombinationWithNothingToSay() {
        XCTAssertNil(OfflineIndicatorCopy.state(offline: false, sitNotStored: false))
    }
}
