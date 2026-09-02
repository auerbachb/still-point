import XCTest
@testable import StillPointShared

/// Issue #697 — a value the server confirmed for our own save must keep showing
/// until the account has *genuinely* caught up, which is not the same as the
/// account merely reporting that value once.
///
/// The scenario these encode is the Settings one: a toggle takes ticket N, the Home
/// "Add second track" opt-in takes ticket N+1 from outside Settings' own save gate,
/// N's response applies, and then N+1's response — serialized before N committed —
/// applies on top carrying the pre-save value. Releasing on the value alone drops
/// the hold in the gap between those two, so the second one reverts the control.
final class ConfirmedSettingHoldTests: XCTestCase {
    func testHoldStandsUntilSomethingOutranksItsBarrier() {
        let hold = ConfirmedSettingHold(value: true, barrier: 7)

        XCTAssertFalse(hold.isSettled(byAppliedTicket: 6), "a request that left before the confirmation cannot settle it")
        XCTAssertFalse(
            hold.isSettled(byAppliedTicket: 7),
            "the newest request outstanding when the confirmation arrived may still predate the commit"
        )
        XCTAssertTrue(hold.isSettled(byAppliedTicket: 8), "this one departed after the commit, so it reflects it")
    }

    /// The race itself. The overlapping write carries the barrier's own ticket, so it
    /// must not settle the hold — that is exactly the response that would revert the
    /// control if the hold were already gone.
    func testOverlappingWriteAppliedAfterTheConfirmationDoesNotSettleTheHold() {
        let toggleTicket = 4
        let overlappingWriteTicket = 5
        // Highest ticket issued when the toggle's own response arrived.
        let hold = ConfirmedSettingHold(value: true, barrier: overlappingWriteTicket)

        XCTAssertFalse(hold.isSettled(byAppliedTicket: toggleTicket), "our own response is not the account catching up")
        XCTAssertFalse(hold.isSettled(byAppliedTicket: overlappingWriteTicket))
        XCTAssertNotNil(hold.released(byAppliedTicket: overlappingWriteTicket), "still held")

        // The reconciling read scheduled when the toggle's response was handled took
        // the next ticket, so it departed after the commit and settles the hold.
        XCTAssertNil(hold.released(byAppliedTicket: overlappingWriteTicket + 1))
    }

    /// A response that outranks the barrier is the newest word on the account, so it
    /// settles the hold whatever value it carries. Re-checking the value here would
    /// strand a genuinely superseded value on screen for the life of the view.
    func testAnOutrankingResponseSettlesTheHoldEvenWhenItDisagrees() {
        let hold = ConfirmedSettingHold(value: "chosen-name", barrier: 3)

        XCTAssertTrue(hold.isSettled(byAppliedTicket: 4))
        XCTAssertNil(hold.released(byAppliedTicket: 4))
    }

    /// Nothing has been adopted yet (`lastAppliedSettingsTicket` starts at zero), so a
    /// hold taken before any response cannot be settled by that initial state.
    func testNoAdoptionYetLeavesTheHoldStanding() {
        let hold = ConfirmedSettingHold(value: false, barrier: 1)

        XCTAssertFalse(hold.isSettled(byAppliedTicket: 0))
        XCTAssertNotNil(hold.released(byAppliedTicket: 0))
    }
}
