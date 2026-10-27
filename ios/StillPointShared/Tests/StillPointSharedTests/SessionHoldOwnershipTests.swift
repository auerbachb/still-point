import XCTest
@testable import StillPointShared

/// #1058: a sit belongs to the account that started it, and is reported only while
/// that account owns the device's credentials.
final class SessionHoldOwnershipTests: XCTestCase {
    func testSitStartCapturesTheScenesAccount() {
        var ownership = SessionHoldOwnership()
        ownership.update(sitting: true, sceneAccountId: "A")

        XCTAssertEqual(ownership.ownerAccountId, "A")
        XCTAssertTrue(ownership.isReportable(forCredentialOwner: "A"))
    }

    /// AC 1: a sit still running for A after the device becomes B is never reported.
    func testRunningSitKeepsItsOwnerAcrossRepeatedUpdatesFromAnotherAccount() {
        var ownership = SessionHoldOwnership()
        ownership.update(sitting: true, sceneAccountId: "A")
        // Repeated `true` updates after the scene adopted B (a hydration, a
        // preference change, a view re-appearing) must not move the sit to B.
        ownership.update(sitting: true, sceneAccountId: "B")
        ownership.update(sitting: true, sceneAccountId: "B")

        XCTAssertEqual(ownership.ownerAccountId, "A")
        XCTAssertFalse(ownership.isReportable(forCredentialOwner: "B"))
        XCTAssertTrue(ownership.isReportable(forCredentialOwner: "A"))
    }

    func testANewSitAfterAFullStopBelongsToTheNewAccount() {
        var ownership = SessionHoldOwnership()
        ownership.update(sitting: true, sceneAccountId: "A")
        ownership.update(sitting: false, sceneAccountId: "B")

        XCTAssertNil(ownership.ownerAccountId)
        XCTAssertFalse(ownership.isReportable(forCredentialOwner: "B"))

        ownership.update(sitting: true, sceneAccountId: "B")
        XCTAssertEqual(ownership.ownerAccountId, "B")
        XCTAssertTrue(ownership.isReportable(forCredentialOwner: "B"))
        XCTAssertFalse(ownership.isReportable(forCredentialOwner: "A"))
    }

    /// AC 2: the current account's sit stays reportable across a hydration, and
    /// becomes reportable once a cold start's unknown owner is confirmed.
    func testSameAccountSitStaysReportableAndUnknownOwnerWaitsForConfirmation() {
        var ownership = SessionHoldOwnership()
        ownership.update(sitting: true, sceneAccountId: "A")

        XCTAssertFalse(ownership.isReportable(forCredentialOwner: nil))
        XCTAssertTrue(ownership.isReportable(forCredentialOwner: "A"))
        ownership.update(sitting: true, sceneAccountId: "A")
        XCTAssertTrue(ownership.isReportable(forCredentialOwner: "A"))
    }

    func testLocalAndBuddyOverlapKeepsTheOwnerUntilBothEnd() {
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
        XCTAssertEqual(ownership.ownerAccountId, "A")
        XCTAssertTrue(ownership.isReportable(forCredentialOwner: "A"))

        buddy = false
        apply("B")
        XCTAssertNil(ownership.ownerAccountId)
        XCTAssertFalse(ownership.isReportable(forCredentialOwner: "A"))
    }

    func testSitStartedWithoutAnAccountIsNeverReportable() {
        var ownership = SessionHoldOwnership()
        ownership.update(sitting: true, sceneAccountId: nil)
        ownership.update(sitting: true, sceneAccountId: "A")

        XCTAssertNil(ownership.ownerAccountId)
        XCTAssertFalse(ownership.isReportable(forCredentialOwner: "A"))
        XCTAssertFalse(ownership.isReportable(forCredentialOwner: nil))
    }

    func testNoSitIsNeverReportable() {
        let ownership = SessionHoldOwnership()
        XCTAssertFalse(ownership.isReportable(forCredentialOwner: "A"))
    }
}
