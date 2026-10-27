import Foundation
import Testing
@testable import StillPointShared

/// The order `AppViewModel.completeBreathSession` works in, cut down to the gate, the
/// save and the trip home, so the previous account's save can be held open while the
/// next account taps End.
@MainActor
private final class BreathScreen {
    private(set) var generation = 1
    private(set) var saveGate = GenerationOwnedGate()
    /// The generations whose End went home once its save settled.
    private(set) var wentHome: [Int] = []
    /// One value per End, sent as it reaches the gate: whether it got past.
    let gateDecisions: AsyncStream<Bool>
    private let decide: AsyncStream<Bool>.Continuation

    init() {
        (gateDecisions, decide) = AsyncStream<Bool>.makeStream()
    }

    /// Signs out and back in: two identity transitions.
    func signOutAndSignIn() {
        generation += 2
    }

    /// One End tap.
    ///
    /// - Returns: `nil` when the gate refused the tap.
    func end(saving save: () async -> Void) async -> GenerationScopedWork.Outcome? {
        let generation = self.generation
        guard saveGate.acquire(for: generation) else {
            decide.yield(false)
            return nil
        }
        defer { saveGate.release(for: generation) }
        decide.yield(true)
        return await GenerationScopedWork.run(startedAt: generation, liveGeneration: { self.generation }) {
            await save()
        } apply: { _ in
            wentHome.append(generation)
        }
    }
}

/// Issue #854 problem 2 (#833 problem 5 on web): the breath End gate was a `Bool`. A
/// save still running for the previous account kept it raised, so the next account's
/// End returned without saving. Lowering it on sign-out would not have been enough:
/// the old save lowers it again when it settles, freeing a gate the next account's
/// save has taken by then. The gate now belongs to a generation.
@MainActor
struct GenerationOwnedGateTests {
    /// What the gate is for: a second End from the same account while its save runs
    /// must not write a duplicate row.
    @Test func testASecondEndFromTheSameGenerationIsRefusedWhileItsSaveRuns() {
        var gate = GenerationOwnedGate()
        #expect(gate.acquire(for: 1) == true)

        #expect(gate.acquire(for: 1) == false)
        #expect(gate.isHeld(by: 1))
    }

    /// The previous account's save is still running when the next account taps End.
    /// A `Bool` reads as busy here and swallows that End.
    @Test func testAHoldFromAnEarlierGenerationDoesNotBlockTheLiveOne() {
        var gate = GenerationOwnedGate()
        #expect(gate.acquire(for: 1) == true)

        #expect(!gate.isHeld(by: 3))
        #expect(gate.acquire(for: 3) == true)
        #expect(gate.isHeld(by: 3))
    }

    /// When the previous account's save settles, its release must leave the next
    /// account's hold in place. Freeing it would let a second End from that account
    /// start a duplicate.
    @Test func testAReleaseFromAnEarlierGenerationLeavesTheLiveHoldInPlace() {
        var gate = GenerationOwnedGate()
        #expect(gate.acquire(for: 1) == true)
        #expect(gate.acquire(for: 3) == true)

        gate.release(for: 1)

        #expect(gate.isHeld(by: 3))
        #expect(gate.acquire(for: 3) == false)
    }

    /// The next account's save can also settle first. The previous account's release,
    /// arriving last, finds nothing of its own and leaves the gate free.
    @Test func testAReleaseFromAnEarlierGenerationAfterTheLiveOneFinishedLeavesTheGateFree() {
        var gate = GenerationOwnedGate()
        #expect(gate.acquire(for: 1) == true)
        #expect(gate.acquire(for: 3) == true)
        gate.release(for: 3)

        gate.release(for: 1)

        #expect(!gate.isHeld(by: 3))
        #expect(gate.acquire(for: 3) == true)
    }

    @Test func testTheOwnersReleaseFreesTheGate() {
        var gate = GenerationOwnedGate()
        #expect(gate.acquire(for: 1) == true)

        gate.release(for: 1)

        #expect(!gate.isHeld(by: 1))
        #expect(gate.acquire(for: 1) == true)
    }

    /// Problems 1 and 2 together, with the previous account's breath save held open
    /// across a sign-out and a sign-in.
    @Test func testAnEarlierAccountsPendingSaveNeitherSwallowsNorReleasesTheNextAccountsEnd() async {
        let screen = BreathScreen()
        var decisions = screen.gateDecisions.makeAsyncIterator()

        let earlierSave = HeldSave(settlingWith: ())
        let earlierEnd = Task { await screen.end(saving: earlierSave.perform) }
        let earlierPassed = await decisions.next()
        #expect(earlierPassed == true)

        screen.signOutAndSignIn()

        let laterSave = HeldSave(settlingWith: ())
        let laterEnd = Task { await screen.end(saving: laterSave.perform) }
        let laterPassed = await decisions.next()
        #expect(laterPassed == true, "the previous account's pending save swallowed this End")

        // The previous account's save settles first. It neither sends the next
        // account home nor frees the gate that account's save now holds.
        earlierSave.settle()
        let earlierOutcome = await earlierEnd.value
        #expect(earlierOutcome == .discarded)
        #expect(screen.wentHome == [])
        #expect(screen.saveGate.isHeld(by: 3), "the previous account's save freed the next account's gate")

        // So a second End from the next account is still refused while its save runs.
        let duplicateEnd = Task {
            await screen.end(saving: { Issue.record("a second End started a duplicate save") })
        }
        let duplicatePassed = await decisions.next()
        #expect(duplicatePassed == false)
        let duplicateOutcome = await duplicateEnd.value
        #expect(duplicateOutcome == nil)

        laterSave.settle()
        let laterOutcome = await laterEnd.value
        #expect(laterOutcome == .applied)
        #expect(screen.wentHome == [3])
        #expect(!screen.saveGate.isHeld(by: 3))
    }
}
