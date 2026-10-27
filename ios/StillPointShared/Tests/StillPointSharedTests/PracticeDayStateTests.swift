import XCTest
@testable import StillPointShared

/// What the yesterday lookup returns once the test lets it settle.
private enum YesterdayRead: Sendable {
    case answered(primary: Bool, second: Bool)
    case failed
}

/// The order `AppViewModel` works in, cut down to its practice-day state and the two
/// paths that race in #894: the yesterday lookup in `resolvePreviousPracticeDay(now:)`,
/// which the tests hold open, and the network-free path a finished sit takes,
/// `markPracticeDoneToday` followed by the rollover its `syncWidgetData()` opens with.
@MainActor
private final class PracticeDayScreen {
    private(set) var state = PracticeDayState()
    let calendar: Calendar
    var dualTrack = false

    /// - Parameter lastUsed: when the app last rolled its flags over, with nothing
    ///   sat since.
    init(calendar: Calendar, lastUsed: Date) {
        self.calendar = calendar
        state.rollOverIfNeeded(now: lastUsed, dualTrack: dualTrack, calendar: calendar)
    }

    /// `resolvePreviousPracticeDay(now:)`, with `read` standing in for
    /// `getTracksDoneToday(date:)` on yesterday.
    func resolvePreviousPracticeDay(now: Date, reading read: () async -> YesterdayRead) async {
        guard let ticket = state.beginPreviousDayRead(now: now, calendar: calendar) else { return }
        switch await read() {
        case let .answered(primary, second):
            state.applyPreviousDayAnswer(
                TracksDoneTodayDTO(primary: primary, second: second),
                ticket: ticket,
                now: now,
                dualTrack: dualTrack,
                calendar: calendar
            )
        case .failed:
            state.applyFailedPreviousDayRead(ticket: ticket, now: now, dualTrack: dualTrack, calendar: calendar)
        }
    }

    /// `markPracticeDoneToday(sessionType:track:)`, then the rollover its
    /// `syncWidgetData()` opens with.
    func finishSit(_ sessionType: SessionType, track: Track = .primary, at now: Date) {
        state.recordCompletion(sessionType: sessionType, track: track, now: now, dualTrack: dualTrack, calendar: calendar)
        state.rollOverIfNeeded(now: now, dualTrack: dualTrack, calendar: calendar)
    }

    /// `resetTrackCompletionBadges()`: a sign-out, a sign-in, or an auth check that
    /// adopts the account.
    func reset() {
        state.reset()
    }

    /// The day the next sit is stored on.
    func creditedSessionDate(at now: Date) -> String {
        state.creditedSessionDate(now: now, dualTrack: dualTrack, calendar: calendar)
    }
}

/// Issue #894: before 6:00, a sit that finishes yesterday must not be outvoted by a
/// server answer about yesterday that was read before the sit ended. That answer cannot
/// have seen the sit, so its "incomplete" is the server lagging, not contradicting it.
/// Before the fix, the next sit before 6:00 was stored on yesterday again. Web keeps a
/// sit remembered across the same read (#855, PR #878).
@MainActor
final class PracticeDayStateTests: XCTestCase {
    private let yesterday = "2026-10-26"
    private let today = "2026-10-27"

    /// A fixed zone, so the hour checks do not depend on where the tests run.
    private var newYork: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "America/New_York")!
        return calendar
    }

    private func october(_ day: Int, _ hour: Int, _ minute: Int = 0) -> Date {
        newYork.date(from: DateComponents(year: 2026, month: 10, day: day, hour: hour, minute: minute))!
    }

    /// The app was last used at 20:00 yesterday, and nothing was sat that day.
    private func makeScreen() -> PracticeDayScreen {
        PracticeDayScreen(calendar: newYork, lastUsed: october(26, 20))
    }

    // MARK: - A sit that ends while the lookup is in flight

    /// The order the issue names. The lookup leaves at 1:00, the sit that finishes
    /// yesterday ends at 1:30, and the lookup then lands with the "incomplete" it read
    /// before that sit reached the server.
    func testAnIncompleteAnswerLandingAfterTheSitEndsDoesNotReopenYesterday() async {
        let screen = makeScreen()
        let read = HeldSave(settlingWith: YesterdayRead.answered(primary: false, second: false))
        let leftAt = october(27, 1)
        let resolving = Task { await screen.resolvePreviousPracticeDay(now: leftAt, reading: read.perform) }
        await read.untilStarted()

        // The sit itself is stored on yesterday, and finishes it.
        XCTAssertEqual(screen.creditedSessionDate(at: october(27, 1, 10)), yesterday)
        screen.finishSit(.standard, at: october(27, 1, 30))
        XCTAssertEqual(screen.creditedSessionDate(at: october(27, 1, 30)), today)

        read.settle()
        await resolving.value

        XCTAssertEqual(
            screen.creditedSessionDate(at: october(27, 1, 40)), today,
            "an answer read before the sit ended reopened yesterday"
        )
    }

    /// A lookup that fails is no better. By the time it lands, the sit has rolled the
    /// flags onto today, so the failure fallback used to read "before 6:00, still open".
    func testAFailedLookupLandingAfterTheSitEndsDoesNotReopenYesterday() async {
        let screen = makeScreen()
        let read = HeldSave(settlingWith: YesterdayRead.failed)
        let leftAt = october(27, 1)
        let resolving = Task { await screen.resolvePreviousPracticeDay(now: leftAt, reading: read.perform) }
        await read.untilStarted()

        screen.finishSit(.standard, at: october(27, 1, 30))
        read.settle()
        await resolving.value

        XCTAssertEqual(
            screen.creditedSessionDate(at: october(27, 1, 40)), today,
            "a lookup that failed after the sit ended reopened yesterday"
        )
    }

    /// The same answer, landing before the sit ends. It is still current when the sit
    /// ends, and the rollover used to prefer it to the flags.
    func testAnIncompleteAnswerThatLandedBeforeTheSitDoesNotOutvoteIt() async {
        let screen = makeScreen()
        await screen.resolvePreviousPracticeDay(now: october(27, 1), reading: { .answered(primary: false, second: false) })
        XCTAssertEqual(screen.creditedSessionDate(at: october(27, 1, 10)), yesterday)

        screen.finishSit(.standard, at: october(27, 1, 30))

        XCTAssertEqual(
            screen.creditedSessionDate(at: october(27, 1, 40)), today,
            "an answer read before the sit ended outvoted it"
        )
    }

    /// Once a sit has finished yesterday, the next refresh asks nothing more about it.
    /// The only news a lookup could bring is the server lagging that sit, or, offline as
    /// on the trip home after it, a failure whose fallback reads "before 6:00, still
    /// open" once the flags are on today.
    func testARefreshAfterTheSitFinishesYesterdayDoesNotAskAgain() async {
        let screen = makeScreen()
        screen.finishSit(.standard, at: october(27, 1, 30))

        await screen.resolvePreviousPracticeDay(now: october(27, 1, 35), reading: {
            XCTFail("asked about yesterday again after a sit finished it")
            return .failed
        })

        XCTAssertEqual(screen.creditedSessionDate(at: october(27, 1, 40)), today)
    }

    /// Two-a-day: the first sit does not finish yesterday, so the lookup's answer still
    /// applies and the day stays open. The second sit finishes it, and that answer,
    /// current by then, does not outvote it.
    func testTwoADayClosesYesterdayWhenItsSecondSitEnds() async {
        let screen = makeScreen()
        screen.dualTrack = true
        let read = HeldSave(settlingWith: YesterdayRead.answered(primary: false, second: false))
        let leftAt = october(27, 1)
        let resolving = Task { await screen.resolvePreviousPracticeDay(now: leftAt, reading: read.perform) }
        await read.untilStarted()

        screen.finishSit(.standard, track: .primary, at: october(27, 1, 30))
        read.settle()
        await resolving.value
        XCTAssertEqual(
            screen.creditedSessionDate(at: october(27, 1, 35)), yesterday,
            "the first of two sits finished yesterday"
        )

        screen.finishSit(.standard, track: .second, at: october(27, 2))

        XCTAssertEqual(screen.creditedSessionDate(at: october(27, 2, 5)), today)
    }

    // MARK: - Unchanged

    /// A quick sit is practice, but not one of yesterday's required sits. It finishes
    /// nothing, so the lookup's answer still applies.
    func testAQuickSitDuringTheLookupLeavesYesterdayOpen() async {
        let screen = makeScreen()
        let read = HeldSave(settlingWith: YesterdayRead.answered(primary: false, second: false))
        let leftAt = october(27, 1)
        let resolving = Task { await screen.resolvePreviousPracticeDay(now: leftAt, reading: read.perform) }
        await read.untilStarted()

        screen.finishSit(.quick, at: october(27, 1, 30))
        read.settle()
        await resolving.value

        XCTAssertEqual(screen.creditedSessionDate(at: october(27, 1, 40)), yesterday)
    }

    /// At 6:00 the new calendar day begins whatever is known about yesterday, so a
    /// lookup that left before 6:00 and lands after it changes nothing.
    func testALookupThatLeftBefore6AndLandsAfterItLeavesTheDayOnToday() async {
        let screen = makeScreen()
        let read = HeldSave(settlingWith: YesterdayRead.answered(primary: false, second: false))
        let leftAt = october(27, 5, 50)
        let resolving = Task { await screen.resolvePreviousPracticeDay(now: leftAt, reading: read.perform) }
        await read.untilStarted()

        screen.finishSit(.standard, at: october(27, 6, 5))
        read.settle()
        await resolving.value

        XCTAssertEqual(screen.creditedSessionDate(at: october(27, 6, 10)), today)
    }

    /// A reset disowns a lookup still in flight. Its answer here would have finished
    /// yesterday, so a day still open afterwards shows that it was dropped.
    func testAResetDuringTheLookupDropsItsAnswer() async {
        let screen = makeScreen()
        let read = HeldSave(settlingWith: YesterdayRead.answered(primary: true, second: false))
        let leftAt = october(27, 1)
        let resolving = Task { await screen.resolvePreviousPracticeDay(now: leftAt, reading: read.perform) }
        await read.untilStarted()

        screen.reset()
        read.settle()
        await resolving.value

        XCTAssertFalse(screen.state.previousDayResolved)
        XCTAssertEqual(screen.creditedSessionDate(at: october(27, 1, 40)), yesterday)
    }

    /// Before 6:00, nothing known and nothing sat keeps yesterday open, and an answer
    /// that says it is finished closes it.
    func testBefore6YesterdayStaysOpenUntilAnAnswerFinishesIt() async {
        let screen = makeScreen()
        XCTAssertEqual(screen.creditedSessionDate(at: october(27, 1)), yesterday)

        await screen.resolvePreviousPracticeDay(now: october(27, 1, 5), reading: { .answered(primary: true, second: false) })

        XCTAssertEqual(screen.creditedSessionDate(at: october(27, 1, 10)), today)
    }

    /// A failed lookup with nothing sat leaves yesterday open, and the next refresh
    /// asks again.
    func testAFailedLookupWithNothingSatLeavesYesterdayOpen() async {
        let screen = makeScreen()

        await screen.resolvePreviousPracticeDay(now: october(27, 1), reading: { .failed })

        XCTAssertEqual(screen.creditedSessionDate(at: october(27, 1, 10)), yesterday)
        var askedAgain = false
        await screen.resolvePreviousPracticeDay(now: october(27, 1, 20), reading: {
            askedAgain = true
            return .failed
        })
        XCTAssertTrue(askedAgain)
    }

    // MARK: - Focus sessions (#839)

    /// A focus session is not meditation practice (#765). On either track it raises
    /// none of the flags and leaves before the rollover, so the flags still describe
    /// the day they did before it.
    func testAFocusSessionRaisesNoFlagAndRollsNothingOver() {
        let lastUsed = october(26, 20)
        for track in [Track.primary, .second] {
            var state = PracticeDayState()
            state.rollOverIfNeeded(now: lastUsed, dualTrack: true, calendar: newYork)

            state.recordCompletion(sessionType: .focus, track: track, now: october(27, 9), dualTrack: true, calendar: newYork)

            XCTAssertFalse(state.practiceDoneToday, "a focus session on \(track) raised practiceDoneToday")
            XCTAssertFalse(state.primaryStandardDoneToday, "a focus session on \(track) raised primaryStandardDoneToday")
            XCTAssertFalse(state.secondPracticeDoneToday, "a focus session on \(track) raised secondPracticeDoneToday")
            XCTAssertEqual(state.doneTodayFlagsStamp, lastUsed, "a focus session on \(track) rolled the flags over")
        }
    }
}
