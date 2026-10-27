import XCTest
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
final class GenerationOwnedGateTests: XCTestCase {
    /// What the gate is for: a second End from the same account while its save runs
    /// must not write a duplicate row.
    func testASecondEndFromTheSameGenerationIsRefusedWhileItsSaveRuns() {
        var gate = GenerationOwnedGate()
        XCTAssertTrue(gate.acquire(for: 1))

        XCTAssertFalse(gate.acquire(for: 1))
        XCTAssertTrue(gate.isHeld(by: 1))
    }

    /// The previous account's save is still running when the next account taps End.
    /// A `Bool` reads as busy here and swallows that End.
    func testAHoldFromAnEarlierGenerationDoesNotBlockTheLiveOne() {
        var gate = GenerationOwnedGate()
        XCTAssertTrue(gate.acquire(for: 1))

        XCTAssertFalse(gate.isHeld(by: 3))
        XCTAssertTrue(gate.acquire(for: 3))
        XCTAssertTrue(gate.isHeld(by: 3))
    }

    /// When the previous account's save settles, its release must leave the next
    /// account's hold in place. Freeing it would let a second End from that account
    /// start a duplicate.
    func testAReleaseFromAnEarlierGenerationLeavesTheLiveHoldInPlace() {
        var gate = GenerationOwnedGate()
        XCTAssertTrue(gate.acquire(for: 1))
        XCTAssertTrue(gate.acquire(for: 3))

        gate.release(for: 1)

        XCTAssertTrue(gate.isHeld(by: 3))
        XCTAssertFalse(gate.acquire(for: 3))
    }

    /// The next account's save can also settle first. The previous account's release,
    /// arriving last, finds nothing of its own and leaves the gate free.
    func testAReleaseFromAnEarlierGenerationAfterTheLiveOneFinishedLeavesTheGateFree() {
        var gate = GenerationOwnedGate()
        XCTAssertTrue(gate.acquire(for: 1))
        XCTAssertTrue(gate.acquire(for: 3))
        gate.release(for: 3)

        gate.release(for: 1)

        XCTAssertFalse(gate.isHeld(by: 3))
        XCTAssertTrue(gate.acquire(for: 3))
    }

    func testTheOwnersReleaseFreesTheGate() {
        var gate = GenerationOwnedGate()
        XCTAssertTrue(gate.acquire(for: 1))

        gate.release(for: 1)

        XCTAssertFalse(gate.isHeld(by: 1))
        XCTAssertTrue(gate.acquire(for: 1))
    }

    /// Problems 1 and 2 together, with the previous account's breath save held open
    /// across a sign-out and a sign-in.
    func testAnEarlierAccountsPendingSaveNeitherSwallowsNorReleasesTheNextAccountsEnd() async {
        let screen = BreathScreen()
        var decisions = screen.gateDecisions.makeAsyncIterator()

        let earlierSave = HeldSave(settlingWith: ())
        let earlierEnd = Task { await screen.end(saving: earlierSave.perform) }
        let earlierPassed = await decisions.next()
        XCTAssertEqual(earlierPassed, true)

        screen.signOutAndSignIn()

        let laterSave = HeldSave(settlingWith: ())
        let laterEnd = Task { await screen.end(saving: laterSave.perform) }
        let laterPassed = await decisions.next()
        XCTAssertEqual(laterPassed, true, "the previous account's pending save swallowed this End")

        // The previous account's save settles first. It neither sends the next
        // account home nor frees the gate that account's save now holds.
        earlierSave.settle()
        let earlierOutcome = await earlierEnd.value
        XCTAssertEqual(earlierOutcome, .discarded)
        XCTAssertEqual(screen.wentHome, [])
        XCTAssertTrue(screen.saveGate.isHeld(by: 3), "the previous account's save freed the next account's gate")

        // So a second End from the next account is still refused while its save runs.
        let duplicateEnd = Task {
            await screen.end(saving: { XCTFail("a second End started a duplicate save") })
        }
        let duplicatePassed = await decisions.next()
        XCTAssertEqual(duplicatePassed, false)
        let duplicateOutcome = await duplicateEnd.value
        XCTAssertNil(duplicateOutcome)

        laterSave.settle()
        let laterOutcome = await laterEnd.value
        XCTAssertEqual(laterOutcome, .applied)
        XCTAssertEqual(screen.wentHome, [3])
        XCTAssertFalse(screen.saveGate.isHeld(by: 3))
    }
}
