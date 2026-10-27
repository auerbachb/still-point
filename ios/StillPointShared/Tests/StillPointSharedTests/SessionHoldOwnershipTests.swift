import Foundation
import Testing
@testable import StillPointShared

/// #1058: a sit belongs to the account that started it, and is reported only while
/// that account owns the device's credentials.
struct SessionHoldOwnershipTests {
    @Test func testSitStartCapturesTheScenesAccount() {
        var ownership = SessionHoldOwnership()
        ownership.update(sitting: true, sceneAccountId: "A")

        #expect(ownership.ownerAccountId == "A")
        #expect(ownership.isReportable(forCredentialOwner: "A"))
    }

    /// AC 1: a sit still running for A after the device becomes B is never reported.
    @Test func testRunningSitKeepsItsOwnerAcrossRepeatedUpdatesFromAnotherAccount() {
        var ownership = SessionHoldOwnership()
        ownership.update(sitting: true, sceneAccountId: "A")
        // Repeated `true` updates after the scene adopted B (a hydration, a
        // preference change, a view re-appearing) must not move the sit to B.
        ownership.update(sitting: true, sceneAccountId: "B")
        ownership.update(sitting: true, sceneAccountId: "B")

        #expect(ownership.ownerAccountId == "A")
        #expect(!ownership.isReportable(forCredentialOwner: "B"))
        #expect(ownership.isReportable(forCredentialOwner: "A"))
    }

    @Test func testANewSitAfterAFullStopBelongsToTheNewAccount() {
        var ownership = SessionHoldOwnership()
        ownership.update(sitting: true, sceneAccountId: "A")
        ownership.update(sitting: false, sceneAccountId: "B")

        #expect(ownership.ownerAccountId == nil)
        #expect(!ownership.isReportable(forCredentialOwner: "B"))

        ownership.update(sitting: true, sceneAccountId: "B")
        #expect(ownership.ownerAccountId == "B")
        #expect(ownership.isReportable(forCredentialOwner: "B"))
        #expect(!ownership.isReportable(forCredentialOwner: "A"))
    }

    /// AC 2: the current account's sit stays reportable across a hydration, and
    /// becomes reportable once a cold start's unknown owner is confirmed.
    @Test func testSameAccountSitStaysReportableAndUnknownOwnerWaitsForConfirmation() {
        var ownership = SessionHoldOwnership()
        ownership.update(sitting: true, sceneAccountId: "A")

        #expect(!ownership.isReportable(forCredentialOwner: nil))
        #expect(ownership.isReportable(forCredentialOwner: "A"))
        ownership.update(sitting: true, sceneAccountId: "A")
        #expect(ownership.isReportable(forCredentialOwner: "A"))
    }

    @Test func testLocalAndBuddyOverlapKeepsTheOwnerUntilBothEnd() {
        var local = false
        var buddy = false
        var ownership = SessionHoldOwnership()
        func apply(_ account: String) {
            ownership.update(sitting: local || buddy, sceneAccountId: account)
        }

        local = true
        apply("A")
        buddy = true
        apply("B")
        local = false
        apply("B")
        #expect(ownership.ownerAccountId == "A")
        #expect(ownership.isReportable(forCredentialOwner: "A"))

        buddy = false
        apply("B")
        #expect(ownership.ownerAccountId == nil)
        #expect(!ownership.isReportable(forCredentialOwner: "A"))
    }

    @Test func testSitStartedWithoutAnAccountIsNeverReportable() {
        var ownership = SessionHoldOwnership()
        ownership.update(sitting: true, sceneAccountId: nil)
        ownership.update(sitting: true, sceneAccountId: "A")

        #expect(ownership.ownerAccountId == nil)
        #expect(!ownership.isReportable(forCredentialOwner: "A"))
        #expect(!ownership.isReportable(forCredentialOwner: nil))
    }

    @Test func testNoSitIsNeverReportable() {
        let ownership = SessionHoldOwnership()
        #expect(!ownership.isReportable(forCredentialOwner: "A"))
    }
}
