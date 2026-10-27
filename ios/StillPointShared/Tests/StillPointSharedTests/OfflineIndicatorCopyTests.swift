import Foundation
import Testing
@testable import StillPointShared

/// Issue #703 — the offline strip must not keep promising that sits are saved
/// once a local write is known to have failed.
///
/// Issue #717 — and it must be able to say so while the user is online, without
/// calling them offline to do it.
///
/// Ported to `src/lib/offlineIndicatorCopy.test.ts` so both clients assert the
/// same strings; keep the two files in step.
struct OfflineIndicatorCopyTests {
    private let promise = "sits are saved and upload when you reconnect"

    // MARK: - #703: the disconnected copy is unchanged

    @Test func testUsualStripKeepsTheSharedCopyVerbatim() {
        let copy = OfflineIndicatorCopy.copy(for: .offlineSavedProgress)

        #expect(copy.label == "OFFLINE · SAVED PROGRESS")
        #expect(copy.accessibilityLabel == "Offline. Showing your saved progress; sits are saved and upload when you reconnect.")
    }

    @Test func testNotStoredStripDropsThePromise() {
        let copy = OfflineIndicatorCopy.copy(for: .offlineSitNotStored)

        #expect(copy.label == "OFFLINE · SIT NOT SAVED")
        #expect(copy.accessibilityLabel == "Offline. A sit could not be saved on this device, so it will not upload when you reconnect.")
        #expect(!copy.accessibilityLabel.contains(promise))
        #expect(copy.accessibilityLabel.contains("could not be saved on this device"))
        #expect(copy.label != OfflineIndicatorCopy.copy(for: .offlineSavedProgress).label)
    }

    // MARK: - #717: the online failure copy

    @Test func testOnlineStripReportsTheSameLossWithoutClaimingADisconnection() {
        let copy = OfflineIndicatorCopy.copy(for: .onlineSitNotStored)

        #expect(copy.label == "SIT NOT SAVED")
        #expect(copy.accessibilityLabel == "A sit could not be saved on this device, so it will not upload.")
    }

    @Test func testNeitherStringTellsAConnectedUserTheyAreOffline() {
        let copy = OfflineIndicatorCopy.copy(for: .onlineSitNotStored)

        #expect(!copy.label.contains("OFFLINE"))
        #expect(!copy.accessibilityLabel.lowercased().contains("offline"))
        // There is nothing to reconnect to, so nothing is waiting to upload later.
        #expect(!copy.accessibilityLabel.contains("reconnect"))
    }

    @Test func testAccessibilityLabelCarriesTheVisibleLabelsMeaning() {
        // The glyph and label are ignored for accessibility, so this string is the
        // whole announcement — it has to say what the strip shows, in both states.
        #expect(
            OfflineIndicatorCopy.copy(for: .onlineSitNotStored)
                .accessibilityLabel.contains("could not be saved on this device")
        )
        #expect(
            OfflineIndicatorCopy.copy(for: .offlineSitNotStored)
                .accessibilityLabel.contains("could not be saved on this device")
        )
        #expect(
            OfflineIndicatorCopy.copy(for: .offlineSitNotStored)
                .accessibilityLabel.contains("Offline.")
        )
    }

    // MARK: - #717: when the strip is raised at all

    @Test func testKnownWriteFailureSelectsTheNotStoredCopyForEitherConnectivity() {
        #expect(OfflineIndicatorCopy.state(offline: true, sitNotStored: true) == .offlineSitNotStored)
        #expect(OfflineIndicatorCopy.state(offline: false, sitNotStored: true) == .onlineSitNotStored)
    }

    @Test func testOfflineWithEverythingIntactKeepsTheOriginalStrip() {
        #expect(OfflineIndicatorCopy.state(offline: true, sitNotStored: false) == .offlineSavedProgress)
    }

    @Test func testOnlineWithTheSitStoredIsTheOneCombinationWithNothingToSay() {
        #expect(OfflineIndicatorCopy.state(offline: false, sitNotStored: false) == nil)
    }

    // MARK: - #744 / #717: render suppression
    //
    // Mirrored case-for-case from `src/lib/offlineIndicatorCopy.test.ts`
    // (`suppressedOfflineIndicatorState`). Keep the two files in step.

    @Test func testCompletionNotStoredAlertSuppressesTheStripEvenWhenTheFactsWouldRaiseIt() {
        #expect(
            OfflineIndicatorCopy.suppressedState(
                isImmersive: false,
                completionOwnsNotStored: true,
                offline: true,
                sitNotStored: true
            ) == nil
        )
        #expect(
            OfflineIndicatorCopy.suppressedState(
                isImmersive: false,
                completionOwnsNotStored: true,
                offline: false,
                sitNotStored: true
            ) == nil
        )
        #expect(
            OfflineIndicatorCopy.suppressedState(
                isImmersive: false,
                completionOwnsNotStored: true,
                offline: true,
                sitNotStored: false
            ) == nil
        )
    }

    @Test func testImmersiveFlowsSuppressTheStrip() {
        #expect(
            OfflineIndicatorCopy.suppressedState(
                isImmersive: true,
                completionOwnsNotStored: false,
                offline: true,
                sitNotStored: true
            ) == nil
        )
    }

    @Test func testEitherGateSuppressesTheStripWhenBothAreSet() {
        #expect(
            OfflineIndicatorCopy.suppressedState(
                isImmersive: true,
                completionOwnsNotStored: true,
                offline: false,
                sitNotStored: true
            ) == nil
        )
    }

    @Test func testSuccessfulRetryLiftsCompletionSuppressionAndTheStripReturnsWhenTheFactsWarrantIt() {
        #expect(
            OfflineIndicatorCopy.suppressedState(
                isImmersive: false,
                completionOwnsNotStored: false,
                offline: true,
                sitNotStored: false
            ) == .offlineSavedProgress
        )
        #expect(
            OfflineIndicatorCopy.suppressedState(
                isImmersive: false,
                completionOwnsNotStored: false,
                offline: true,
                sitNotStored: false
            ) == OfflineIndicatorCopy.state(offline: true, sitNotStored: false)
        )
    }

    @Test func testWithNeitherGateSetTheHelperMatchesTheTruthTable() {
        let combinations: [(offline: Bool, sitNotStored: Bool)] = [
            (true, true),
            (false, true),
            (true, false),
            (false, false),
        ]
        for facts in combinations {
            #expect(
                OfflineIndicatorCopy.suppressedState(
                    isImmersive: false,
                    completionOwnsNotStored: false,
                    offline: facts.offline,
                    sitNotStored: facts.sitNotStored
                ) == OfflineIndicatorCopy.state(offline: facts.offline, sitNotStored: facts.sitNotStored)
            )
        }
    }
}
