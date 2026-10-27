import Foundation
import Testing
@testable import StillPointShared

/// #724 — what a finished sit's save attempt decides.
///
/// `SessionViewModel.completeSit(appVM:startedAtGeneration:)`,
/// `SessionViewModel.continueWithoutSaving(appVM:)` and
/// `AppViewModel.completeBreathSession` carry out whatever `SessionCompletionLogic`
/// returns, so these cases pin the #703 flag rule, the "Session could not be
/// saved" alert and the #921 completion-screen rules without a device, a queue,
/// or a view.
struct SessionCompletionLogicTests {

    // MARK: - #703: the offline strip's not-stored flag

    @Test func testAStoredSitClearsTheFlag() {
        // A later successful save is the proof storage works again.
        #expect(SessionCompletionLogic.localSaveFailed(after: .stored) == false)
    }

    @Test func testARefusedWriteRaisesTheFlag() {
        #expect(SessionCompletionLogic.localSaveFailed(after: .notStored) == true)
    }

    @Test func testASitWithNoSignedInUserLeavesTheFlagAsItWas() {
        // No write ran, so there is nothing to say about this device's storage —
        // neither a fresh failure nor proof that an earlier one has cleared.
        #expect(SessionCompletionLogic.localSaveFailed(after: .noSignedInUser) == nil)
    }

    // MARK: - The "Session could not be saved" alert

    @Test func testAStoredSitGoesOnToTheCompletionScreen() {
        #expect(!SessionCompletionLogic.showsSaveError(after: .stored))
    }

    @Test func testARefusedWriteStopsOnTheAlert() {
        #expect(SessionCompletionLogic.showsSaveError(after: .notStored))
    }

    @Test func testASitWithNoSignedInUserStopsOnTheAlert() {
        #expect(SessionCompletionLogic.showsSaveError(after: .noSignedInUser))
    }

    // MARK: - #921: the gaze summary's elapsed time

    @Test func testASitWithNoAttentionLogHandsOverNoElapsedTime() {
        #expect(SessionCompletionLogic.attentionElapsed(attentionLog: nil, elapsed: 312) == nil)
    }

    @Test func testASitWithAnAttentionLogHandsOverItsElapsedTime() {
        let log = [
            AttentionEntry(time: 0, state: "attentive"),
            AttentionEntry(time: 40, state: "away"),
        ]
        #expect(SessionCompletionLogic.attentionElapsed(attentionLog: log, elapsed: 312) == 312)
    }

    @Test func testAnEmptyAttentionLogStillHandsOverTheElapsedTime() {
        // Tracking ran and logged nothing. That is still a log, so the screen gets
        // the time to measure it against.
        #expect(SessionCompletionLogic.attentionElapsed(attentionLog: [], elapsed: 312) == 312)
    }

    @Test func testTheElapsedTimePassesThroughUnchangedAtZero() {
        // `CompletionView` decides that a sit with no elapsed time has no summary;
        // this rule hands the time over as it is.
        let log = [AttentionEntry(time: 0, state: "attentive")]
        #expect(SessionCompletionLogic.attentionElapsed(attentionLog: log, elapsed: 0) == 0)
    }

    // MARK: - #921: "Continue without saving" after a sign-out

    @Test func testContinueWithoutSavingOpensTheScreenUnderTheGenerationThatRaisedTheAlert() {
        #expect(SessionCompletionLogic.continuesWithoutSaving(alertRaisedAt: 3, liveGeneration: 3, isSignedIn: true))
    }

    @Test func testContinueWithoutSavingOpensNothingAfterASignOut() {
        // A sign-out moves the generation once. Someone is signed in here, so the
        // moved generation alone turns the tap away.
        #expect(!SessionCompletionLogic.continuesWithoutSaving(alertRaisedAt: 3, liveGeneration: 4, isSignedIn: true))
    }

    @Test func testContinueWithoutSavingOpensNothingWhenNoAlertWasRaised() {
        // 0 is the generation a launch starts on, so a missing value must not read
        // as that one.
        #expect(!SessionCompletionLogic.continuesWithoutSaving(alertRaisedAt: nil, liveGeneration: 0, isSignedIn: true))
    }

    @Test func testContinueWithoutSavingOpensNothingWithNobodySignedIn() {
        // A Retry tapped after a sign-out raises the alert again under the new
        // generation, so the generations match and nobody is signed in.
        #expect(!SessionCompletionLogic.continuesWithoutSaving(alertRaisedAt: 4, liveGeneration: 4, isSignedIn: false))
    }
}
