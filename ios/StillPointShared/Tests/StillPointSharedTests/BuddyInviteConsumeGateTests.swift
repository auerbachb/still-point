import Foundation
import Testing
@testable import StillPointShared

/// Issue #989: the buddy-invite consume gate is owned per attempt. A previous account's
/// join still in flight after a sign-out must neither block the next account's consume
/// nor, when it returns, free the gate under that account's own join. The token it is
/// posting stays blocked across the generation change, so it is never sent twice.
struct BuddyInviteConsumeGateTests {
    /// One join at a time within a generation (#756).
    @Test func testASecondConsumeInTheSameGenerationIsBlocked() {
        var gate = BuddyInviteConsumeGate()
        #expect(gate.acquire(generation: 1, token: "invite-1") != nil)
        #expect(gate.acquire(generation: 1, token: "invite-1") == nil)
        #expect(gate.acquire(generation: 1, token: "invite-2") == nil)
        #expect(gate.isHeld(liveGeneration: 1))
    }

    /// The bug: the previous account's join used to hold one `Bool`, so the next
    /// account's first consume returned early.
    @Test func testAStaleAttemptDoesNotBlockTheNextGenerationsOtherToken() {
        var gate = BuddyInviteConsumeGate()
        #expect(gate.acquire(generation: 1, token: "invite-1") != nil)
        #expect(!gate.isHeld(liveGeneration: 2))
        #expect(!gate.blocks(generation: 2, token: "invite-2"))
        #expect(gate.acquire(generation: 2, token: "invite-2") != nil)
    }

    /// `applySignedOut` keeps the pending token. The next account must not POST the
    /// one the stale join is still posting.
    @Test func testAStaleAttemptStillBlocksItsOwnToken() {
        var gate = BuddyInviteConsumeGate()
        #expect(gate.acquire(generation: 1, token: "invite-1") != nil)
        #expect(gate.blocks(generation: 2, token: "invite-1"))
        #expect(gate.acquire(generation: 2, token: "invite-1") == nil)
    }

    /// The stale join's release frees only its own attempt, so the newer one keeps
    /// holding the gate for its generation.
    @Test func testAStaleReleaseLeavesTheNewerAttemptHeld() throws {
        var gate = BuddyInviteConsumeGate()
        let staleResult = gate.acquire(generation: 1, token: "invite-1")
        let stale = try #require(staleResult)
        let liveResult = gate.acquire(generation: 2, token: "invite-2")
        let live = try #require(liveResult)

        gate.release(stale)

        #expect(gate.isHeld(liveGeneration: 2))
        #expect(gate.acquire(generation: 2, token: "invite-2") == nil, "the stale release freed the live attempt")
        gate.release(live)
        #expect(!gate.isHeld(liveGeneration: 2))
        #expect(gate.inFlight.isEmpty)
    }

    /// The consume releases early before its re-consume and again in its `defer`.
    /// The second release must not free a re-consume that took the gate in between.
    @Test func testReleasingTwiceDoesNotFreeALaterAttempt() throws {
        var gate = BuddyInviteConsumeGate()
        let firstResult = gate.acquire(generation: 1, token: "invite-1")
        let first = try #require(firstResult)
        gate.release(first)
        let reconsumeResult = gate.acquire(generation: 1, token: "invite-2")
        let reconsume = try #require(reconsumeResult)

        gate.release(first)

        #expect(gate.isHeld(liveGeneration: 1))
        gate.release(reconsume)
        #expect(!gate.isHeld(liveGeneration: 1))
    }

    /// A caller that checks before reading the token blocks on the generation alone.
    @Test func testANilTokenBlocksOnTheGenerationOnly() {
        var gate = BuddyInviteConsumeGate()
        #expect(gate.acquire(generation: 1, token: "invite-1") != nil)
        #expect(gate.blocks(generation: 1, token: nil))
        #expect(!gate.blocks(generation: 2, token: nil))
    }
}
