import XCTest
@testable import StillPointShared

/// #1058: the credential boundary's record of which account owns the shared token.
final class CredentialOwnerTests: XCTestCase {
    func testStartsUnknown() {
        let owner = CredentialOwner()
        XCTAssertNil(owner.snapshot.accountId)
    }

    func testInvalidateAndPublishAdvanceTheGeneration() {
        let owner = CredentialOwner()
        let start = owner.snapshot.generation

        owner.publish(accountId: "A")
        XCTAssertEqual(owner.snapshot, CredentialOwner.Snapshot(accountId: "A", generation: start + 1))

        owner.invalidate()
        XCTAssertEqual(owner.snapshot, CredentialOwner.Snapshot(accountId: nil, generation: start + 2))
    }

    func testSnapshotIsNotCurrentAfterAnyChange() {
        let owner = CredentialOwner()
        owner.publish(accountId: "A")
        let beforeInvalidate = owner.snapshot
        XCTAssertTrue(owner.isCurrent(beforeInvalidate))

        owner.invalidate()
        XCTAssertFalse(owner.isCurrent(beforeInvalidate))

        // Even a change back to the same account is a change.
        owner.publish(accountId: "A")
        XCTAssertFalse(owner.isCurrent(beforeInvalidate))
    }

    /// The account switch: invalidate, install B, publish B. No snapshot ever pairs
    /// A with the generation B is current under.
    func testReplacementNeverExposesTheOutgoingAccountAsCurrent() {
        let owner = CredentialOwner()
        owner.publish(accountId: "A")
        let ownedByA = owner.snapshot

        owner.invalidate()
        let midSwitch = owner.snapshot
        XCTAssertNil(midSwitch.accountId)
        XCTAssertFalse(owner.isCurrent(ownedByA))

        owner.publish(accountId: "B")
        let ownedByB = owner.snapshot
        XCTAssertEqual(ownedByB.accountId, "B")
        XCTAssertFalse(owner.isCurrent(ownedByA))
        XCTAssertFalse(owner.isCurrent(midSwitch))
        XCTAssertNotEqual(ownedByA.generation, ownedByB.generation)
    }

    /// Cold start: `/me` confirms the account behind the installed token.
    func testConfirmSetsTheOwnerWhenNothingChangedSinceTheRequestLeft() {
        let owner = CredentialOwner()
        let beforeMe = owner.snapshot

        XCTAssertTrue(owner.confirm(accountId: "A", ifStillCurrent: beforeMe))
        XCTAssertEqual(owner.snapshot.accountId, "A")
    }

    /// A `/me` that left before a sign-in as B must not put A back.
    func testConfirmFromBeforeASignInIsDropped() {
        let owner = CredentialOwner()
        owner.publish(accountId: "A")
        let beforeMe = owner.snapshot

        owner.invalidate()
        owner.publish(accountId: "B")

        XCTAssertFalse(owner.confirm(accountId: "A", ifStillCurrent: beforeMe))
        XCTAssertEqual(owner.snapshot.accountId, "B")
    }

    /// A routine `/me` for the account already recorded changes nothing, so it does
    /// not look like an account switch to a report that is mid-build.
    func testReconfirmingTheSameAccountKeepsTheGeneration() {
        let owner = CredentialOwner()
        owner.publish(accountId: "A")
        let snapshot = owner.snapshot

        XCTAssertTrue(owner.confirm(accountId: "A", ifStillCurrent: snapshot))
        XCTAssertTrue(owner.isCurrent(snapshot))
    }

    func testConcurrentChangesKeepTheGenerationConsistent() {
        let owner = CredentialOwner()
        let start = owner.snapshot.generation
        DispatchQueue.concurrentPerform(iterations: 1000) { index in
            if index.isMultiple(of: 2) {
                owner.invalidate()
            } else {
                owner.publish(accountId: "A")
            }
        }
        XCTAssertEqual(owner.snapshot.generation, start + 1000)
    }
}
