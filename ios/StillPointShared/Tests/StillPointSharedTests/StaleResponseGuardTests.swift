import Foundation
import Testing
@testable import StillPointShared

/// Issue #709 — a stale read must not revive the value a newer write already
/// replaced. The scenario these tests encode is the notification-preferences one:
/// the Settings screen's `load()` and its `persist()` are separate callers with
/// separate locks, so they overlap freely, and `AppViewModel` issues a third fetch
/// of its own that is serialized against neither.
///
/// `shouldApply` and `isSuperseded` are `mutating`. `#expect` cannot call a
/// mutating member on the value it inspects, so these checks compare the result
/// with `true`/`false`, which evaluates the call outside the macro's closure.
struct StaleResponseGuardTests {
    @Test func testFirstResponseApplies() {
        var ordering = StaleResponseGuard()
        let ticket = ordering.nextTicket()
        #expect(ordering.shouldApply(ticket: ticket, from: .read) == true)
    }

    /// The #709 race itself: a read starts, the user toggles, the write lands
    /// first, then the read's pre-toggle answer arrives and must be dropped.
    @Test func testSlowReadCannotOverwriteNewerWrite() {
        var ordering = StaleResponseGuard()
        let read = ordering.nextTicket()
        let write = ordering.nextTicket()

        #expect(ordering.shouldApply(ticket: write, from: .write) == true, "the write is newest")
        #expect(
            ordering.shouldApply(ticket: read, from: .read) == false,
            "the read left before the write, so its answer is stale"
        )
    }

    /// A read that *started* after the write was issued is still stale: it can
    /// reach the server before the write commits and come back describing the old
    /// value. Only a confirmed write knows what actually landed, so it supersedes
    /// everything outstanding — not just requests older than itself.
    @Test func testReadStartedAfterAWriteIsStillDroppedOnceTheWriteLands() {
        var ordering = StaleResponseGuard()
        let write = ordering.nextTicket()
        let laterRead = ordering.nextTicket()

        #expect(ordering.shouldApply(ticket: write, from: .write) == true)
        #expect(
            ordering.shouldApply(ticket: laterRead, from: .read) == false,
            "the read was in flight across the commit, so it may predate it"
        )
    }

    /// The mirror image, and the reason a plain "did anything change since?" check
    /// is not enough: an older read landing first must not then block the write.
    @Test func testWriteStillAppliesAfterAnOlderReadLanded() {
        var ordering = StaleResponseGuard()
        let read = ordering.nextTicket()
        let write = ordering.nextTicket()

        #expect(ordering.shouldApply(ticket: read, from: .read) == true)
        #expect(
            ordering.shouldApply(ticket: write, from: .write) == true,
            "the user's toggle started later, so it wins even when it returns second"
        )
    }

    /// A read that merely landed first is not evidence the write is obsolete: it
    /// may have observed the row before the write committed. Testing writes
    /// against the read barrier would drop this write and silently keep the value
    /// the user just replaced — the very bug this type exists to stop.
    @Test func testWriteStillAppliesAfterALaterReadAlreadyLanded() {
        var ordering = StaleResponseGuard()
        let write = ordering.nextTicket()
        let laterRead = ordering.nextTicket()

        #expect(ordering.shouldApply(ticket: laterRead, from: .read) == true)
        #expect(ordering.shouldApply(ticket: write, from: .write) == true, "only a newer write may overrule a write")
    }

    /// ...but a newer write still does overrule it, whatever reads landed between.
    @Test func testOlderWriteIsDroppedAfterANewerWriteEvenWithReadsBetween() {
        var ordering = StaleResponseGuard()
        let olderWrite = ordering.nextTicket()
        let read = ordering.nextTicket()
        let newerWrite = ordering.nextTicket()

        #expect(ordering.shouldApply(ticket: newerWrite, from: .write) == true)
        #expect(ordering.shouldApply(ticket: read, from: .read) == false)
        #expect(ordering.shouldApply(ticket: olderWrite, from: .write) == false)
    }

    /// A write supersedes what was outstanding when it landed — not reads issued
    /// afterwards, which genuinely do observe the committed value.
    @Test func testReadIssuedAfterAWriteLandedStillApplies() {
        var ordering = StaleResponseGuard()
        let write = ordering.nextTicket()
        #expect(ordering.shouldApply(ticket: write, from: .write) == true)

        let laterRead = ordering.nextTicket()
        #expect(ordering.shouldApply(ticket: laterRead, from: .read) == true)
    }

    /// Two writes in flight at once (the Settings screen serializes its saves, but
    /// only against each other): the one that started later still wins.
    @Test func testOlderWriteCannotOverwriteNewerWrite() {
        var ordering = StaleResponseGuard()
        let first = ordering.nextTicket()
        let second = ordering.nextTicket()

        #expect(ordering.shouldApply(ticket: second, from: .write) == true)
        #expect(ordering.shouldApply(ticket: first, from: .write) == false)
    }

    /// Three overlapping callers (Settings load, Settings persist, AppViewModel
    /// hydrate) draining in a scrambled order: only the newest word sticks.
    @Test func testOnlyTheNewestWordSticksAmongThree() {
        var ordering = StaleResponseGuard()
        let hydrate = ordering.nextTicket()
        let load = ordering.nextTicket()
        let persist = ordering.nextTicket()

        #expect(ordering.shouldApply(ticket: load, from: .read) == true)
        #expect(ordering.shouldApply(ticket: persist, from: .write) == true)
        #expect(ordering.shouldApply(ticket: hydrate, from: .read) == false)
        #expect(ordering.shouldApply(ticket: load, from: .read) == false, "already superseded")
    }

    @Test func testSameTicketCannotApplyTwice() {
        var ordering = StaleResponseGuard()
        let ticket = ordering.nextTicket()
        #expect(ordering.shouldApply(ticket: ticket, from: .read) == true)
        #expect(ordering.shouldApply(ticket: ticket, from: .read) == false)
    }

    @Test func testSequentialRequestsAllApply() {
        var ordering = StaleResponseGuard()
        for _ in 0..<5 {
            let ticket = ordering.nextTicket()
            #expect(ordering.shouldApply(ticket: ticket, from: .read) == true)
        }
    }

    /// A number that never came from `nextTicket()` is rejected rather than
    /// trusted — otherwise one stray value could park the guard above every ticket
    /// it will ever issue and silently drop all later responses.
    @Test func testUnissuedTicketIsRejectedAndLeavesTheGuardUsable() {
        var ordering = StaleResponseGuard()
        #expect(ordering.shouldApply(ticket: 9_999, from: .write) == false)

        let ticket = ordering.nextTicket()
        #expect(ordering.shouldApply(ticket: ticket, from: .read) == true)
    }

    @Test func testNonPositiveTicketsAreRejected() {
        var ordering = StaleResponseGuard()
        #expect(ordering.shouldApply(ticket: 0, from: .read) == false)
        #expect(ordering.shouldApply(ticket: -1, from: .write) == false)
    }

    @Test func testTicketsAreMonotonic() {
        var ordering = StaleResponseGuard()
        let tickets = (0..<4).map { _ in ordering.nextTicket() }
        #expect(tickets == tickets.sorted())
        #expect(Set(tickets).count == tickets.count, "tickets must be unique")
    }

    /// An unconsumed ticket — a request whose response never arrives — must not
    /// wedge the guard: later responses still apply.
    @Test func testAbandonedRequestDoesNotBlockLaterResponses() {
        var ordering = StaleResponseGuard()
        _ = ordering.nextTicket()
        let next = ordering.nextTicket()
        #expect(ordering.shouldApply(ticket: next, from: .read) == true)
    }

    /// Each subject gets its own guard: preference ordering must not be disturbed
    /// by some other screen's in-flight request.
    @Test func testGuardsAreIndependent() {
        var first = StaleResponseGuard()
        var second = StaleResponseGuard()

        let firstTicket = first.nextTicket()
        _ = second.nextTicket()
        _ = second.nextTicket()

        #expect(first.shouldApply(ticket: firstTicket, from: .read) == true)
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
    @Test func testSupersededRefreshIsDroppedWhenEveryRequestIsARead() {
        var ordering = StaleResponseGuard()
        let superseded = ordering.nextTicket()
        let newest = ordering.nextTicket()

        #expect(ordering.shouldApply(ticket: newest, from: .read) == true)
        #expect(
            ordering.shouldApply(ticket: superseded, from: .read) == false,
            "it left first, so its answer predates the newer one's"
        )
    }

    /// ...and the reason this is a ticketed guard rather than a bare "is my ID
    /// still the latest?" counter. Two refreshes overlap and drain *in* order:
    /// the first is still the newest thing applied when it lands, so it must
    /// apply. A latest-ID-wins counter would discard it and leave the badges
    /// stale for the rest of the second refresh's flight.
    @Test func testOverlappingRefreshesBothApplyWhenTheyLandInOrder() {
        var ordering = StaleResponseGuard()
        let first = ordering.nextTicket()
        let second = ordering.nextTicket()

        #expect(
            ordering.shouldApply(ticket: first, from: .read) == true,
            "nothing newer has landed yet, so this is still the freshest word"
        )
        #expect(ordering.shouldApply(ticket: second, from: .read) == true)
    }

    /// The failure path. `refreshTracksDoneToday()` resets both Home badges to the
    /// local flags (#1021), which is right only for the newest refresh: an absent
    /// answer is not the server contradicting the success that just landed.
    @Test func testStaleRefreshFailureCannotClearWhatANewerRefreshSet() {
        var ordering = StaleResponseGuard()
        let slowRefresh = ordering.nextTicket()
        let newestRefresh = ordering.nextTicket()

        #expect(ordering.shouldApply(ticket: newestRefresh, from: .read) == true)
        #expect(
            ordering.shouldApply(ticket: slowRefresh, from: .read) == false,
            "a superseded refresh must not fail closed over a newer success"
        )
    }

    /// All six callers of `refreshTracksDoneToday()` in flight at once, draining
    /// scrambled: each response applies only while nothing newer already has.
    @Test func testOnlyTheNewestRefreshSticksAcrossAllSixCallers() {
        var ordering = StaleResponseGuard()
        let checkAuth = ordering.nextTicket()
        let offlineCatchUp = ordering.nextTicket()
        let reconnect = ordering.nextTicket()
        let loginCatchUp = ordering.nextTicket()
        let enableDualTrack = ordering.nextTicket()
        let returnHome = ordering.nextTicket()

        #expect(ordering.shouldApply(ticket: reconnect, from: .read) == true)
        #expect(ordering.shouldApply(ticket: checkAuth, from: .read) == false)
        #expect(ordering.shouldApply(ticket: offlineCatchUp, from: .read) == false)
        #expect(ordering.shouldApply(ticket: returnHome, from: .read) == true, "the newest sit wins")
        #expect(ordering.shouldApply(ticket: loginCatchUp, from: .read) == false)
        #expect(ordering.shouldApply(ticket: enableDualTrack, from: .read) == false)
    }

    // MARK: - #699: a failure ranks without recording

    /// The mirror of `testStaleRefreshFailureCannotClearWhatANewerRefreshSet`, and
    /// the reason the failure path asks `isSuperseded` rather than `shouldApply`.
    ///
    /// A sit is flushed, `returnHome()`'s refresh is in flight, the network drops,
    /// and the reconnect refresh fails *instantly* — later ticket, earlier arrival.
    /// It is entitled to fail closed, but it observed nothing, so it must not
    /// consume the barrier: the original refresh then lands confirming the sit and
    /// has to be allowed to repaint the badge the user just earned.
    @Test func testNewerFailureDoesNotBarAnEarlierSuccessStillInFlight() {
        var ordering = StaleResponseGuard()
        let returnHome = ordering.nextTicket()
        let reconnect = ordering.nextTicket()

        #expect(!ordering.isSuperseded(ticket: reconnect), "nothing newer has landed, so failing closed is still the newest word")
        #expect(
            ordering.shouldApply(ticket: returnHome, from: .read) == true,
            "the failure recorded nothing, so the real answer behind it still applies"
        )
    }

    /// ...while ranking still happens, so the original #699 direction holds: a
    /// failure that a newer response already outranked stays out.
    @Test func testSupersededFailureIsStillRejected() {
        var ordering = StaleResponseGuard()
        let slowFailure = ordering.nextTicket()
        let newestSuccess = ordering.nextTicket()

        #expect(ordering.shouldApply(ticket: newestSuccess, from: .read) == true)
        #expect(
            ordering.isSuperseded(ticket: slowFailure),
            "an absent answer must not clear what a newer response just confirmed"
        )
    }

    /// `isSuperseded` reports, it does not record: asking repeatedly leaves the
    /// barrier exactly where it was, so back-to-back failures both fail closed and
    /// neither shuts out the response still coming.
    @Test func testIsSupersededDoesNotAdvanceTheBarrier() {
        var ordering = StaleResponseGuard()
        let inFlight = ordering.nextTicket()
        let firstFailure = ordering.nextTicket()
        let secondFailure = ordering.nextTicket()

        #expect(!ordering.isSuperseded(ticket: firstFailure))
        #expect(!ordering.isSuperseded(ticket: secondFailure))
        #expect(!ordering.isSuperseded(ticket: firstFailure), "asking twice changes nothing")
        #expect(ordering.shouldApply(ticket: inFlight, from: .read) == true)
    }

    /// A ticket this guard never issued is reported superseded rather than trusted,
    /// matching how `shouldApply(ticket:from:)` rejects a stray number.
    @Test func testIsSupersededRejectsATicketItNeverIssued() {
        var ordering = StaleResponseGuard()
        let real = ordering.nextTicket()

        #expect(ordering.isSuperseded(ticket: real + 1))
        #expect(!ordering.isSuperseded(ticket: real))
    }
}
