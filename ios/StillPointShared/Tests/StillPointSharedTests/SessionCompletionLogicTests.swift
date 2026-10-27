import XCTest
@testable import StillPointShared

/// #724 — what a finished sit's save attempt decides.
///
/// `SessionViewModel.completeSit(appVM:startedAtGeneration:)`,
/// `SessionViewModel.continueWithoutSaving(appVM:)` and
/// `AppViewModel.completeBreathSession` carry out whatever `SessionCompletionLogic`
/// returns, so these cases pin the #703 flag rule, the "Session could not be
/// saved" alert and the #921 completion-screen rules without a device, a queue,
/// or a view.
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

    // MARK: - #921: the gaze summary's elapsed time

    func testASitWithNoAttentionLogHandsOverNoElapsedTime() {
        XCTAssertNil(SessionCompletionLogic.attentionElapsed(attentionLog: nil, elapsed: 312))
    }

    func testASitWithAnAttentionLogHandsOverItsElapsedTime() {
        let log = [
            AttentionEntry(time: 0, state: "attentive"),
            AttentionEntry(time: 40, state: "away"),
        ]
        XCTAssertEqual(SessionCompletionLogic.attentionElapsed(attentionLog: log, elapsed: 312), 312)
    }

    func testAnEmptyAttentionLogStillHandsOverTheElapsedTime() {
        // Tracking ran and logged nothing. That is still a log, so the screen gets
        // the time to measure it against.
        XCTAssertEqual(SessionCompletionLogic.attentionElapsed(attentionLog: [], elapsed: 312), 312)
    }

    func testTheElapsedTimePassesThroughUnchangedAtZero() {
        // `CompletionView` decides that a sit with no elapsed time has no summary;
        // this rule hands the time over as it is.
        let log = [AttentionEntry(time: 0, state: "attentive")]
        XCTAssertEqual(SessionCompletionLogic.attentionElapsed(attentionLog: log, elapsed: 0), 0)
    }

    // MARK: - #921: "Continue without saving" after a sign-out

    func testContinueWithoutSavingOpensTheScreenUnderTheGenerationThatRaisedTheAlert() {
        XCTAssertTrue(SessionCompletionLogic.continuesWithoutSaving(alertRaisedAt: 3, liveGeneration: 3))
    }

    func testContinueWithoutSavingOpensNothingAfterASignOut() {
        // A sign-out moves the generation once.
        XCTAssertFalse(SessionCompletionLogic.continuesWithoutSaving(alertRaisedAt: 3, liveGeneration: 4))
    }

    func testContinueWithoutSavingOpensNothingWhenNoAlertWasRaised() {
        // 0 is the generation a launch starts on, so a missing value must not read
        // as that one.
        XCTAssertFalse(SessionCompletionLogic.continuesWithoutSaving(alertRaisedAt: nil, liveGeneration: 0))
    }
}
