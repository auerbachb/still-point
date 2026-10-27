import XCTest
@testable import StillPointShared

/// What the yesterday lookup returns once the test lets it settle.
private enum YesterdayRead: Sendable {
    case answered(primary: Bool, second: Bool)
    case failed
}

/// What the credited-day badge query returns (#970).
private enum BadgeRead: Sendable {
    case answered(primary: Bool, second: Bool)
    case failed
}

/// The order `AppViewModel` works in, cut down to its practice-day state and the two
/// paths that race in #894: the yesterday lookup in `resolvePreviousPracticeDay(now:)`,
/// which the tests hold open, and the network-free path a finished sit takes,
/// `markPracticeDoneToday` followed by the rollover its `syncWidgetData()` opens with.
/// For #969 and #970 it also runs the rest of a refresh, `refreshTracksDoneToday()`,
/// with its credited-day badge query.
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

    /// A launch, a sign-in or an account adoption (#969): `resetTrackCompletionBadges()`
    /// and no rollover since, so the flags have no stamp yet.
    init(launchedWith calendar: Calendar) {
        self.calendar = calendar
        state.reset()
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

    /// `refreshTracksDoneToday()` at rest: the yesterday lookup settling with
    /// `yesterdayRead`, the rollover, the credited-day badge query settling with
    /// `badgeRead`, then the rollover its `syncWidgetData()` opens with. It leaves out
    /// the rollover from the stored widget snapshot. That one only lowers local flags,
    /// once the snapshot's day is no longer open, and in these tests the rollover
    /// above has already retired them by then.
    func refresh(at now: Date, yesterday yesterdayRead: YesterdayRead, badges badgeRead: BadgeRead) async {
        await resolvePreviousPracticeDay(now: now, reading: { yesterdayRead })
        state.rollOverIfNeeded(now: now, dualTrack: dualTrack, calendar: calendar)
        let credited = state.creditedSessionDate(now: now, dualTrack: dualTrack, calendar: calendar)
        switch badgeRead {
        case let .answered(primary, second):
            state.applyTracksDoneAnswer(
                TracksDoneTodayDTO(primary: primary, second: second),
                creditedDate: credited,
                now: now,
                calendar: calendar
            )
        case .failed:
            state.applyFailedTracksDoneRead()
        }
        state.rollOverIfNeeded(now: now, dualTrack: dualTrack, calendar: calendar)
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
///
/// Issues #969 and #970: the same sit must close yesterday after a launch before 6:00,
/// and, two-a-day, with a server sit on the other track that only the yesterday lookup
/// reported, when the badge query fails.
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

    /// The app has just launched (#969), so nothing has rolled the flags over yet.
    private func makeLaunchedScreen() -> PracticeDayScreen {
        PracticeDayScreen(launchedWith: newYork)
    }

    /// The local day the flags' stamp names.
    private func stampDay(_ screen: PracticeDayScreen) -> String? {
        screen.state.doneTodayFlagsStamp.map { SessionCalendar.localIsoDate(now: $0, calendar: newYork) }
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

    // MARK: - A launch before 6:00 (#969)

    /// The issue's order: a launch at 3:00 with the network down, so the yesterday
    /// lookup and the badge query both fail. A sit that finishes yesterday still closes
    /// it, and the next sit is stored on today with no badge query answered in between.
    /// The launch rollover used to stamp the flags onto today, so nothing weighed them
    /// against yesterday until a badge query answered and moved the stamp back.
    func testAfterALaunchBefore6ASitClosesYesterdayWhenBothReadsFail() async {
        let screen = makeLaunchedScreen()
        await screen.refresh(at: october(27, 3), yesterday: .failed, badges: .failed)
        XCTAssertEqual(screen.creditedSessionDate(at: october(27, 3, 5)), yesterday)
        XCTAssertEqual(stampDay(screen), yesterday, "the launch stamped the flags onto a day no sit is credited to")

        screen.finishSit(.standard, at: october(27, 3, 30))

        XCTAssertEqual(
            screen.creditedSessionDate(at: october(27, 3, 40)), today,
            "a sit that finished yesterday after a launch left it open"
        )
        XCTAssertEqual(stampDay(screen), today)
    }

    /// The same with no refresh yet: the sit starts straight after the launch, so its
    /// own credited date runs the first rollover.
    func testAfterALaunchBefore6ASitClosesYesterdayBeforeAnyRead() {
        let screen = makeLaunchedScreen()
        XCTAssertEqual(screen.creditedSessionDate(at: october(27, 3)), yesterday)

        screen.finishSit(.standard, at: october(27, 3, 30))

        XCTAssertEqual(screen.creditedSessionDate(at: october(27, 3, 40)), today)
    }

    /// An answer that yesterday is unfinished, and a failed badge query. The sit still
    /// closes yesterday: the answer was read before the sit ended (#894).
    func testAfterALaunchBefore6ASitClosesYesterdayAfterAnIncompleteAnswer() async {
        let screen = makeLaunchedScreen()
        await screen.refresh(at: october(27, 3), yesterday: .answered(primary: false, second: false), badges: .failed)
        XCTAssertEqual(screen.creditedSessionDate(at: october(27, 3, 5)), yesterday)

        screen.finishSit(.standard, at: october(27, 3, 30))

        XCTAssertEqual(screen.creditedSessionDate(at: october(27, 3, 40)), today)
    }

    /// A lookup that leaves at the launch and fails after the sit has ended changes
    /// nothing, and the next refresh asks nothing more about yesterday.
    func testAfterALaunchBefore6ALookupThatFailsAfterTheSitDoesNotReopenYesterday() async {
        let screen = makeLaunchedScreen()
        let read = HeldSave(settlingWith: YesterdayRead.failed)
        let resolving = Task { await screen.resolvePreviousPracticeDay(now: october(27, 3), reading: read.perform) }
        await read.untilStarted()

        screen.finishSit(.standard, at: october(27, 3, 30))
        read.settle()
        await resolving.value

        XCTAssertEqual(screen.creditedSessionDate(at: october(27, 3, 40)), today)
        await screen.resolvePreviousPracticeDay(now: october(27, 3, 45), reading: {
            XCTFail("asked about yesterday again after a sit finished it")
            return .failed
        })
    }

    /// Unchanged: a quick or breath sit is practice, but not one of yesterday's required
    /// sits, so after a launch it leaves yesterday open, as it does at any other time.
    func testAfterALaunchBefore6AQuickOrBreathSitLeavesYesterdayOpen() async {
        for sessionType in [SessionType.quick, .breath] {
            let screen = makeLaunchedScreen()
            await screen.refresh(at: october(27, 3), yesterday: .failed, badges: .failed)

            screen.finishSit(sessionType, at: october(27, 3, 30))

            XCTAssertEqual(
                screen.creditedSessionDate(at: october(27, 3, 40)), yesterday,
                "a \(sessionType) sit after a launch closed yesterday"
            )
            XCTAssertTrue(screen.state.practiceDoneToday, "a \(sessionType) sit after a launch was not recorded")
        }
    }

    /// What a sit raises before 6:00 after a launch is about yesterday, the day it was
    /// credited to, so it retires at 6:00 instead of carrying into today. Stamped onto
    /// today, a quick sit at 3:30 stayed raised past 6:00, and the widget folded it
    /// into today's row.
    func testAfterALaunchBefore6TheFlagsRetireAt6() async {
        let screen = makeLaunchedScreen()
        await screen.refresh(at: october(27, 3), yesterday: .failed, badges: .failed)
        screen.finishSit(.quick, at: october(27, 3, 30))
        XCTAssertTrue(screen.state.practiceDoneToday)

        XCTAssertEqual(screen.creditedSessionDate(at: october(27, 6, 5)), today)

        XCTAssertFalse(screen.state.practiceDoneToday, "yesterday's quick sit carried into today")
    }

    /// Two-a-day after a launch: the first sit leaves yesterday open (unchanged), and
    /// the second closes it.
    func testAfterALaunchBefore6TwoADayClosesYesterdayWithItsSecondSit() async {
        let screen = makeLaunchedScreen()
        screen.dualTrack = true
        await screen.refresh(at: october(27, 3), yesterday: .failed, badges: .failed)

        screen.finishSit(.standard, track: .primary, at: october(27, 3, 30))
        XCTAssertEqual(
            screen.creditedSessionDate(at: october(27, 3, 35)), yesterday,
            "the first of two sits finished yesterday"
        )

        screen.finishSit(.standard, track: .second, at: october(27, 4))

        XCTAssertEqual(screen.creditedSessionDate(at: october(27, 4, 5)), today)
    }

    /// Unchanged: at 6:00 or later a launch credits today and stamps the flags there.
    func testALaunchAt6OrLaterStampsAndCreditsToday() async {
        let screen = makeLaunchedScreen()
        await screen.refresh(at: october(27, 6), yesterday: .failed, badges: .failed)

        XCTAssertEqual(stampDay(screen), today)
        XCTAssertEqual(screen.creditedSessionDate(at: october(27, 6, 5)), today)
    }

    /// The same rollover after a stamp older than yesterday: the app comes back before
    /// 6:00 after two days away, and the lookup says yesterday is unfinished. The flags
    /// roll onto yesterday, not today, so a sit closes it.
    func testAfterTwoDaysAwayASitBefore6ClosesTheYesterdayALookupKeptOpen() async {
        let screen = PracticeDayScreen(calendar: newYork, lastUsed: october(25, 20))
        await screen.refresh(at: october(27, 3), yesterday: .answered(primary: false, second: false), badges: .failed)
        XCTAssertEqual(screen.creditedSessionDate(at: october(27, 3, 5)), yesterday)

        screen.finishSit(.standard, at: october(27, 3, 30))

        XCTAssertEqual(screen.creditedSessionDate(at: october(27, 3, 40)), today)
    }

    // MARK: - Two-a-day and a failed badge query (#970)

    /// The issue's case. The primary sit is on the server only, sat on the web, and the
    /// yesterday lookup says so, but the badge query that would raise a flag for it
    /// fails. The second-track sit that finishes here still closes yesterday. The
    /// lookup's answer used to be kept only as "unfinished", which lost the primary
    /// sit, so the next sit was stored on yesterday again.
    func testTwoADayClosesYesterdayWithTheServersSitAndALocalSitWhenTheBadgeQueryFails() async {
        let screen = makeScreen()
        screen.dualTrack = true
        await screen.refresh(at: october(27, 3), yesterday: .answered(primary: true, second: false), badges: .failed)
        XCTAssertEqual(screen.creditedSessionDate(at: october(27, 3, 5)), yesterday)

        screen.finishSit(.standard, track: .second, at: october(27, 3, 30))

        XCTAssertEqual(
            screen.creditedSessionDate(at: october(27, 3, 40)), today,
            "the server's sit on the other track was lost with the failed badge query"
        )
    }

    /// The other way round: the second-track sit is on the server only, and the primary
    /// sit finishes here. The Home badge still fails closed: the kept answer counts for
    /// crediting only.
    func testTwoADayClosesYesterdayWithTheServersSecondTrackSitAndALocalPrimarySit() async {
        let screen = makeScreen()
        screen.dualTrack = true
        await screen.refresh(at: october(27, 3), yesterday: .answered(primary: false, second: true), badges: .failed)
        XCTAssertFalse(screen.state.secondDoneToday, "the Home badge showed a sit the failed badge query did not report")

        screen.finishSit(.standard, track: .primary, at: october(27, 3, 30))

        XCTAssertEqual(screen.creditedSessionDate(at: october(27, 3, 40)), today)
    }

    /// The same after a launch before 6:00, which needs the launch stamp (#969) as well:
    /// the flags have to describe yesterday before a sit is weighed against it.
    func testAfterALaunchTwoADayClosesYesterdayWithTheServersSitAndALocalSit() async {
        let screen = makeLaunchedScreen()
        screen.dualTrack = true
        await screen.refresh(at: october(27, 3), yesterday: .answered(primary: true, second: false), badges: .failed)

        screen.finishSit(.standard, track: .second, at: october(27, 3, 30))

        XCTAssertEqual(screen.creditedSessionDate(at: october(27, 3, 40)), today)
    }

    /// No badge query has answered yet: the second-track sit ends while the lookup is
    /// in flight, and the lookup then lands with the primary sit. Together they finish
    /// yesterday.
    func testTwoADayClosesYesterdayWhenTheLookupLandsWithTheOtherTracksSitAfterALocalOne() async {
        let screen = makeScreen()
        screen.dualTrack = true
        let read = HeldSave(settlingWith: YesterdayRead.answered(primary: true, second: false))
        let resolving = Task { await screen.resolvePreviousPracticeDay(now: october(27, 1), reading: read.perform) }
        await read.untilStarted()

        screen.finishSit(.standard, track: .second, at: october(27, 1, 30))
        read.settle()
        await resolving.value

        XCTAssertEqual(screen.creditedSessionDate(at: october(27, 1, 40)), today)
    }

    /// Unchanged: a badge query that answered is not lost to a later one that fails. Its
    /// primary sit is kept in a local flag (#679), and only the Home badges fail closed.
    func testTwoADayKeepsAnEarlierBadgeAnswerAcrossAFailedBadgeQuery() async {
        let screen = makeScreen()
        screen.dualTrack = true
        await screen.refresh(at: october(27, 3), yesterday: .failed, badges: .answered(primary: true, second: false))
        XCTAssertTrue(screen.state.primaryDoneToday)

        await screen.refresh(at: october(27, 3, 10), yesterday: .failed, badges: .failed)
        XCTAssertFalse(screen.state.primaryDoneToday, "a failed badge query left a Home badge on")
        XCTAssertTrue(screen.state.primaryStandardDoneToday, "a failed badge query dropped the sit it had reported")

        screen.finishSit(.standard, track: .second, at: october(27, 3, 30))

        XCTAssertEqual(screen.creditedSessionDate(at: october(27, 3, 40)), today)
    }

    /// Unchanged: a single-track user needs only the primary sit, so the server's sit on
    /// the second track, with one here on that track too, leaves yesterday open.
    func testASingleTrackUserStillNeedsThePrimarySit() async {
        let screen = makeScreen()
        await screen.refresh(at: october(27, 3), yesterday: .answered(primary: false, second: true), badges: .failed)

        screen.finishSit(.standard, track: .second, at: october(27, 3, 30))
        XCTAssertEqual(screen.creditedSessionDate(at: october(27, 3, 35)), yesterday)

        screen.finishSit(.standard, track: .primary, at: october(27, 4))
        XCTAssertEqual(screen.creditedSessionDate(at: october(27, 4, 5)), today)
    }

    /// Unchanged: two-a-day with only one track sat, on the server and here, leaves
    /// yesterday open.
    func testTwoADayWithOnlyOneTrackSatLeavesYesterdayOpen() async {
        let screen = makeScreen()
        screen.dualTrack = true
        await screen.refresh(at: october(27, 3), yesterday: .answered(primary: true, second: false), badges: .failed)

        screen.finishSit(.standard, track: .primary, at: october(27, 3, 30))

        XCTAssertEqual(screen.creditedSessionDate(at: october(27, 3, 40)), yesterday)
    }

    /// Unchanged: with no server read answered in this app run, nothing says the other
    /// track was sat, so one sit here leaves yesterday open. There is no answer to keep.
    func testTwoADayWithNoServerAnswerLeavesYesterdayOpenAfterOneSit() async {
        let screen = makeLaunchedScreen()
        screen.dualTrack = true
        await screen.refresh(at: october(27, 3), yesterday: .failed, badges: .failed)

        screen.finishSit(.standard, track: .second, at: october(27, 3, 30))

        XCTAssertEqual(screen.creditedSessionDate(at: october(27, 3, 40)), yesterday)
    }

    /// A reset drops the server's answer about yesterday with everything else: it
    /// belongs to the account that was signed in.
    func testAResetDropsTheServersAnswerAboutYesterday() async {
        let screen = makeScreen()
        screen.dualTrack = true
        await screen.refresh(at: october(27, 3), yesterday: .answered(primary: true, second: false), badges: .failed)

        screen.reset()
        screen.finishSit(.standard, track: .second, at: october(27, 3, 30))

        XCTAssertEqual(
            screen.creditedSessionDate(at: october(27, 3, 40)), yesterday,
            "the answer about yesterday outlived a reset"
        )
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
