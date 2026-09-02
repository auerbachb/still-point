import XCTest
@testable import StillPointShared

/// Issue #709 — a stale read must not revive the value a newer write already
/// replaced. The scenario these tests encode is the notification-preferences one:
/// the Settings screen's `load()` and its `persist()` are separate callers with
/// separate locks, so they overlap freely, and `AppViewModel` issues a third fetch
/// of its own that is serialized against neither.
final class StaleResponseGuardTests: XCTestCase {
    func testFirstResponseApplies() {
        var ordering = StaleResponseGuard()
        let ticket = ordering.nextTicket()
        XCTAssertTrue(ordering.shouldApply(ticket: ticket, from: .read))
    }

    /// The #709 race itself: a read starts, the user toggles, the write lands
    /// first, then the read's pre-toggle answer arrives and must be dropped.
    func testSlowReadCannotOverwriteNewerWrite() {
        var ordering = StaleResponseGuard()
        let read = ordering.nextTicket()
        let write = ordering.nextTicket()

        XCTAssertTrue(ordering.shouldApply(ticket: write, from: .write), "the write is newest")
        XCTAssertFalse(
            ordering.shouldApply(ticket: read, from: .read),
            "the read left before the write, so its answer is stale"
        )
    }

    /// A read that *started* after the write was issued is still stale: it can
    /// reach the server before the write commits and come back describing the old
    /// value. Only a confirmed write knows what actually landed, so it supersedes
    /// everything outstanding — not just requests older than itself.
    func testReadStartedAfterAWriteIsStillDroppedOnceTheWriteLands() {
        var ordering = StaleResponseGuard()
        let write = ordering.nextTicket()
        let laterRead = ordering.nextTicket()

        XCTAssertTrue(ordering.shouldApply(ticket: write, from: .write))
        XCTAssertFalse(
            ordering.shouldApply(ticket: laterRead, from: .read),
            "the read was in flight across the commit, so it may predate it"
        )
    }

    /// The mirror image, and the reason a plain "did anything change since?" check
    /// is not enough: an older read landing first must not then block the write.
    func testWriteStillAppliesAfterAnOlderReadLanded() {
        var ordering = StaleResponseGuard()
        let read = ordering.nextTicket()
        let write = ordering.nextTicket()

        XCTAssertTrue(ordering.shouldApply(ticket: read, from: .read))
        XCTAssertTrue(
            ordering.shouldApply(ticket: write, from: .write),
            "the user's toggle started later, so it wins even when it returns second"
        )
    }

    /// A read that merely landed first is not evidence the write is obsolete: it
    /// may have observed the row before the write committed. Testing writes
    /// against the read barrier would drop this write and silently keep the value
    /// the user just replaced — the very bug this type exists to stop.
    func testWriteStillAppliesAfterALaterReadAlreadyLanded() {
        var ordering = StaleResponseGuard()
        let write = ordering.nextTicket()
        let laterRead = ordering.nextTicket()

        XCTAssertTrue(ordering.shouldApply(ticket: laterRead, from: .read))
        XCTAssertTrue(
            ordering.shouldApply(ticket: write, from: .write),
            "only a newer write may overrule a write"
        )
    }

    /// ...but a newer write still does overrule it, whatever reads landed between.
    func testOlderWriteIsDroppedAfterANewerWriteEvenWithReadsBetween() {
        var ordering = StaleResponseGuard()
        let olderWrite = ordering.nextTicket()
        let read = ordering.nextTicket()
        let newerWrite = ordering.nextTicket()

        XCTAssertTrue(ordering.shouldApply(ticket: newerWrite, from: .write))
        XCTAssertFalse(ordering.shouldApply(ticket: read, from: .read))
        XCTAssertFalse(ordering.shouldApply(ticket: olderWrite, from: .write))
    }

    /// A write supersedes what was outstanding when it landed — not reads issued
    /// afterwards, which genuinely do observe the committed value.
    func testReadIssuedAfterAWriteLandedStillApplies() {
        var ordering = StaleResponseGuard()
        let write = ordering.nextTicket()
        XCTAssertTrue(ordering.shouldApply(ticket: write, from: .write))

        let laterRead = ordering.nextTicket()
        XCTAssertTrue(ordering.shouldApply(ticket: laterRead, from: .read))
    }

    /// Two writes in flight at once (the Settings screen serializes its saves, but
    /// only against each other): the one that started later still wins.
    func testOlderWriteCannotOverwriteNewerWrite() {
        var ordering = StaleResponseGuard()
        let first = ordering.nextTicket()
        let second = ordering.nextTicket()

        XCTAssertTrue(ordering.shouldApply(ticket: second, from: .write))
        XCTAssertFalse(ordering.shouldApply(ticket: first, from: .write))
    }

    /// Three overlapping callers (Settings load, Settings persist, AppViewModel
    /// hydrate) draining in a scrambled order: only the newest word sticks.
    func testOnlyTheNewestWordSticksAmongThree() {
        var ordering = StaleResponseGuard()
        let hydrate = ordering.nextTicket()
        let load = ordering.nextTicket()
        let persist = ordering.nextTicket()

        XCTAssertTrue(ordering.shouldApply(ticket: load, from: .read))
        XCTAssertTrue(ordering.shouldApply(ticket: persist, from: .write))
        XCTAssertFalse(ordering.shouldApply(ticket: hydrate, from: .read))
        XCTAssertFalse(ordering.shouldApply(ticket: load, from: .read), "already superseded")
    }

    func testSameTicketCannotApplyTwice() {
        var ordering = StaleResponseGuard()
        let ticket = ordering.nextTicket()
        XCTAssertTrue(ordering.shouldApply(ticket: ticket, from: .read))
        XCTAssertFalse(ordering.shouldApply(ticket: ticket, from: .read))
    }

    func testSequentialRequestsAllApply() {
        var ordering = StaleResponseGuard()
        for _ in 0..<5 {
            let ticket = ordering.nextTicket()
            XCTAssertTrue(ordering.shouldApply(ticket: ticket, from: .read))
        }
    }

    /// A number that never came from `nextTicket()` is rejected rather than
    /// trusted — otherwise one stray value could park the guard above every ticket
    /// it will ever issue and silently drop all later responses.
    func testUnissuedTicketIsRejectedAndLeavesTheGuardUsable() {
        var ordering = StaleResponseGuard()
        XCTAssertFalse(ordering.shouldApply(ticket: 9_999, from: .write))

        let ticket = ordering.nextTicket()
        XCTAssertTrue(ordering.shouldApply(ticket: ticket, from: .read))
    }

    func testNonPositiveTicketsAreRejected() {
        var ordering = StaleResponseGuard()
        XCTAssertFalse(ordering.shouldApply(ticket: 0, from: .read))
        XCTAssertFalse(ordering.shouldApply(ticket: -1, from: .write))
    }

    func testTicketsAreMonotonic() {
        var ordering = StaleResponseGuard()
        let tickets = (0..<4).map { _ in ordering.nextTicket() }
        XCTAssertEqual(tickets, tickets.sorted())
        XCTAssertEqual(Set(tickets).count, tickets.count, "tickets must be unique")
    }

    /// An unconsumed ticket — a request whose response never arrives — must not
    /// wedge the guard: later responses still apply.
    func testAbandonedRequestDoesNotBlockLaterResponses() {
        var ordering = StaleResponseGuard()
        _ = ordering.nextTicket()
        let next = ordering.nextTicket()
        XCTAssertTrue(ordering.shouldApply(ticket: next, from: .read))
    }

    /// Each subject gets its own guard: preference ordering must not be disturbed
    /// by some other screen's in-flight request.
    func testGuardsAreIndependent() {
        var first = StaleResponseGuard()
        var second = StaleResponseGuard()

        let firstTicket = first.nextTicket()
        _ = second.nextTicket()
        _ = second.nextTicket()

        XCTAssertTrue(first.shouldApply(ticket: firstTicket, from: .read))
    }

    // MARK: - #699: overlapping `refreshTracksDoneToday()` responses
    //
    // Every test above pits a read against a *write*. The `getTracksDoneToday`
    // race has no write in it at all: six callers issue the same observation of
    // the same account on the same local day, nothing serializes them, and the
    // one that returns second is not the one that left second. These pin the
    // all-reads ordering `refreshTracksDoneToday()` now depends on.

    /// The #699 race itself. A superseded refresh *assigns* the Home badges from
    /// its pre-flush view, so letting it land un-checks a card the user earned.
    func testSupersededRefreshIsDroppedWhenEveryRequestIsARead() {
        var ordering = StaleResponseGuard()
        let superseded = ordering.nextTicket()
        let newest = ordering.nextTicket()

        XCTAssertTrue(ordering.shouldApply(ticket: newest, from: .read))
        XCTAssertFalse(
            ordering.shouldApply(ticket: superseded, from: .read),
            "it left first, so its answer predates the newer one's"
        )
    }

    /// ...and the reason this is a ticketed guard rather than a bare "is my ID
    /// still the latest?" counter. Two refreshes overlap and drain *in* order:
    /// the first is still the newest thing applied when it lands, so it must
    /// apply. A latest-ID-wins counter would discard it and leave the badges
    /// stale for the rest of the second refresh's flight.
    func testOverlappingRefreshesBothApplyWhenTheyLandInOrder() {
        var ordering = StaleResponseGuard()
        let first = ordering.nextTicket()
        let second = ordering.nextTicket()

        XCTAssertTrue(
            ordering.shouldApply(ticket: first, from: .read),
            "nothing newer has landed yet, so this is still the freshest word"
        )
        XCTAssertTrue(ordering.shouldApply(ticket: second, from: .read))
    }

    /// The failure path. `refreshTracksDoneToday()` fails closed by clearing both
    /// Home badges, which is right only for the newest refresh: an absent answer
    /// is not the server contradicting the success that just landed.
    func testStaleRefreshFailureCannotClearWhatANewerRefreshSet() {
        var ordering = StaleResponseGuard()
        let slowRefresh = ordering.nextTicket()
        let newestRefresh = ordering.nextTicket()

        XCTAssertTrue(ordering.shouldApply(ticket: newestRefresh, from: .read))
        XCTAssertFalse(
            ordering.shouldApply(ticket: slowRefresh, from: .read),
            "a superseded refresh must not fail closed over a newer success"
        )
    }

    /// All six callers of `refreshTracksDoneToday()` in flight at once, draining
    /// scrambled: each response applies only while nothing newer already has.
    func testOnlyTheNewestRefreshSticksAcrossAllSixCallers() {
        var ordering = StaleResponseGuard()
        let checkAuth = ordering.nextTicket()
        let offlineCatchUp = ordering.nextTicket()
        let reconnect = ordering.nextTicket()
        let loginCatchUp = ordering.nextTicket()
        let enableDualTrack = ordering.nextTicket()
        let returnHome = ordering.nextTicket()

        XCTAssertTrue(ordering.shouldApply(ticket: reconnect, from: .read))
        XCTAssertFalse(ordering.shouldApply(ticket: checkAuth, from: .read))
        XCTAssertFalse(ordering.shouldApply(ticket: offlineCatchUp, from: .read))
        XCTAssertTrue(ordering.shouldApply(ticket: returnHome, from: .read), "the newest sit wins")
        XCTAssertFalse(ordering.shouldApply(ticket: loginCatchUp, from: .read))
        XCTAssertFalse(ordering.shouldApply(ticket: enableDualTrack, from: .read))
    }
}
