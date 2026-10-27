import Foundation
import Testing
@testable import StillPointShared

/// #1058: the credential boundary's record of which account owns the shared token.
struct CredentialOwnerTests {
    @Test func testStartsUnknown() {
        let owner = CredentialOwner()
        #expect(owner.snapshot.accountId == nil)
    }

    @Test func testInvalidateAndPublishAdvanceTheGeneration() {
        let owner = CredentialOwner()
        let start = owner.snapshot.generation

        owner.publish(accountId: "A")
        #expect(owner.snapshot == CredentialOwner.Snapshot(accountId: "A", generation: start + 1))

        owner.invalidate()
        #expect(owner.snapshot == CredentialOwner.Snapshot(accountId: nil, generation: start + 2))
    }

    @Test func testSnapshotIsNotCurrentAfterAnyChange() {
        let owner = CredentialOwner()
        owner.publish(accountId: "A")
        let beforeInvalidate = owner.snapshot
        #expect(owner.isCurrent(beforeInvalidate))

        owner.invalidate()
        #expect(!owner.isCurrent(beforeInvalidate))

        // Even a change back to the same account is a change.
        owner.publish(accountId: "A")
        #expect(!owner.isCurrent(beforeInvalidate))
    }

    /// The account switch: invalidate, install B, publish B. No snapshot ever pairs
    /// A with the generation B is current under.
    @Test func testReplacementNeverExposesTheOutgoingAccountAsCurrent() {
        let owner = CredentialOwner()
        owner.publish(accountId: "A")
        let ownedByA = owner.snapshot

        owner.invalidate()
        let midSwitch = owner.snapshot
        #expect(midSwitch.accountId == nil)
        #expect(!owner.isCurrent(ownedByA))

        owner.publish(accountId: "B")
        let ownedByB = owner.snapshot
        #expect(ownedByB.accountId == "B")
        #expect(!owner.isCurrent(ownedByA))
        #expect(!owner.isCurrent(midSwitch))
        #expect(ownedByA.generation != ownedByB.generation)
    }

    /// Cold start: `/me` confirms the account behind the installed token.
    @Test func testConfirmSetsTheOwnerWhenNothingChangedSinceTheRequestLeft() {
        let owner = CredentialOwner()
        let beforeMe = owner.snapshot

        #expect(owner.confirm(accountId: "A", ifStillCurrent: beforeMe))
        #expect(owner.snapshot.accountId == "A")
    }

    /// A `/me` that left before a sign-in as B must not put A back.
    @Test func testConfirmFromBeforeASignInIsDropped() {
        let owner = CredentialOwner()
        owner.publish(accountId: "A")
        let beforeMe = owner.snapshot

        owner.invalidate()
        owner.publish(accountId: "B")

        #expect(!owner.confirm(accountId: "A", ifStillCurrent: beforeMe))
        #expect(owner.snapshot.accountId == "B")
    }

    /// A routine `/me` for the account already recorded changes nothing, so it does
    /// not look like an account switch to a report that is mid-build.
    @Test func testReconfirmingTheSameAccountKeepsTheGeneration() {
        let owner = CredentialOwner()
        owner.publish(accountId: "A")
        let snapshot = owner.snapshot

        #expect(owner.confirm(accountId: "A", ifStillCurrent: snapshot))
        #expect(owner.isCurrent(snapshot))
    }

    @Test func testConcurrentChangesKeepTheGenerationConsistent() {
        let owner = CredentialOwner()
        let start = owner.snapshot.generation
        DispatchQueue.concurrentPerform(iterations: 1000) { index in
            if index.isMultiple(of: 2) {
                owner.invalidate()
            } else {
                owner.publish(accountId: "A")
            }
        }
        #expect(owner.snapshot.generation == start + 1000)
    }

    @Test func testInvalidateReturnsTheSnapshotItProduced() {
        let owner = CredentialOwner()
        owner.publish(accountId: "A")
        let invalidated = owner.invalidate()
        #expect(invalidated == owner.snapshot)
        #expect(invalidated.accountId == nil)
    }

    /// A sign-in the server rejected restores the outgoing account, but only if
    /// nothing changed the owner while the request was in flight.
    @Test func testRestoringAfterAFailedSignInYieldsToANewerChange() {
        let owner = CredentialOwner()
        owner.publish(accountId: "A")
        let invalidated = owner.invalidate()
        #expect(owner.confirm(accountId: "A", ifStillCurrent: invalidated))
        #expect(owner.snapshot.accountId == "A")

        let secondAttempt = owner.invalidate()
        owner.publish(accountId: "B")
        #expect(!owner.confirm(accountId: "A", ifStillCurrent: secondAttempt))
        #expect(owner.snapshot.accountId == "B")
    }

    /// The suppression controller re-syncs from this callback, so it must run after
    /// every successful confirmation and never after a refused one.
    @Test func testConfirmationObserverRunsOnlyWhenConfirmSucceeds() {
        let owner = CredentialOwner()
        let calls = ObserverCallCounter()
        owner.setConfirmationObserver { calls.increment() }

        let beforeMe = owner.snapshot
        #expect(owner.confirm(accountId: "A", ifStillCurrent: beforeMe))
        #expect(calls.value == 1)

        // Re-confirming the same account still notifies.
        #expect(owner.confirm(accountId: "A", ifStillCurrent: owner.snapshot))
        #expect(calls.value == 2)

        // A stale `/me` is refused and does not notify.
        let stale = owner.snapshot
        owner.invalidate()
        #expect(!owner.confirm(accountId: "A", ifStillCurrent: stale))
        #expect(calls.value == 2)

        // Publishing is not a confirmation.
        owner.publish(accountId: "B")
        #expect(calls.value == 2)
    }

    /// The observer runs outside the lock, so it may read the owner without deadlocking.
    @Test func testConfirmationObserverCanReadTheConfirmedOwner() {
        let owner = CredentialOwner()
        let seen = ObserverCallCounter()
        owner.setConfirmationObserver {
            if owner.snapshot.accountId == "A" { seen.increment() }
        }
        #expect(owner.confirm(accountId: "A", ifStillCurrent: owner.snapshot))
        #expect(seen.value == 1)
    }
}

private final class ObserverCallCounter: @unchecked Sendable {
    private let lock = NSLock()
    private var count = 0

    var value: Int {
        lock.lock()
        defer { lock.unlock() }
        return count
    }

    func increment() {
        lock.lock()
        defer { lock.unlock() }
        count += 1
    }
}
