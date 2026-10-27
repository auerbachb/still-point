import XCTest
@testable import StillPointShared

/// #724 — what a finished sit's save attempt decides.
///
/// `SessionViewModel.completeSit(appVM:startedAtGeneration:)` and
/// `AppViewModel.completeBreathSession` carry out whatever `SessionCompletionLogic`
/// returns, so these cases pin the #703 flag rule and the "Session could not be
/// saved" alert without a device, a queue, or a view.
final class SessionCompletionLogicTests: XCTestCase {

    // MARK: - #703: the offline strip's not-stored flag

    func testAStoredSitClearsTheFlag() {
        // A later successful save is the proof storage works again.
        XCTAssertEqual(SessionCompletionLogic.localSaveFailed(after: .stored), false)
    }

    func testARefusedWriteRaisesTheFlag() {
        XCTAssertEqual(SessionCompletionLogic.localSaveFailed(after: .notStored), true)
    }

    func testASitWithNoSignedInUserLeavesTheFlagAsItWas() {
        // No write ran, so there is nothing to say about this device's storage —
        // neither a fresh failure nor proof that an earlier one has cleared.
        XCTAssertNil(SessionCompletionLogic.localSaveFailed(after: .noSignedInUser))
    }

    // MARK: - The "Session could not be saved" alert

    func testAStoredSitGoesOnToTheCompletionScreen() {
        XCTAssertFalse(SessionCompletionLogic.showsSaveError(after: .stored))
    }

    func testARefusedWriteStopsOnTheAlert() {
        XCTAssertTrue(SessionCompletionLogic.showsSaveError(after: .notStored))
    }

    func testASitWithNoSignedInUserStopsOnTheAlert() {
        XCTAssertTrue(SessionCompletionLogic.showsSaveError(after: .noSignedInUser))
    }
}
