import Foundation
import Testing
@testable import StillPointShared

/// #1199: the account-state seeds behind the `SP_UI_TEST_DUAL_TRACK`,
/// `SP_UI_TEST_DUAL_TRACK_PRIMARY_DONE`, `SP_UI_TEST_RECOVERY_RAMP` and
/// `SP_UI_TEST_FOCUS_HISTORY` launch flags. Each state is checked on the seeded
/// store, and the flags are checked through the same `UITestConfig` parse the app uses.
struct UITestStoreStateSeedsTests {
    private static let fixedNow = Date(timeIntervalSince1970: 1_800_000_000)

    private static func today() -> String {
        SessionCalendar.localIsoDate(now: fixedNow)
    }

    private static func seeded(
        dualTrack: UITestDualTrackSeed = .none,
        recoveryRamp: Bool = false,
        focusHistory: Bool = false,
        now: Date = fixedNow
    ) -> UITestStore {
        UITestStore.makeStateSeeded(
            seedAuthenticated: true,
            dualTrack: dualTrack,
            recoveryRamp: recoveryRamp,
            focusHistory: focusHistory,
            now: now
        )
    }

    /// A local wall-clock time on 15 January 2027, for the before-6:00 cases.
    private static func localTime(hour: Int) -> Date {
        var components = DateComponents()
        components.year = 2027
        components.month = 1
        components.day = 15
        components.hour = hour
        return Calendar.current.date(from: components) ?? fixedNow
    }

    private static func completedStandardToday(in store: UITestStore, track: Track) -> Bool {
        store.sessions.contains {
            $0.completed && $0.sessionType == .standard && $0.sessionDate == today()
                && ($0.track ?? .primary) == track
        }
    }

    // MARK: - Dual track

    @Test func bothDueSeedTurnsOnDualTrackWithNoSitToday() {
        let store = Self.seeded(dualTrack: .bothDue)

        #expect(store.user.dualTrackEnabled)
        #expect(store.user.secondTrackDay == 2)
        #expect(!Self.completedStandardToday(in: store, track: .primary))
        #expect(!Self.completedStandardToday(in: store, track: .second))
    }

    @Test func primaryDoneSeedLeavesOnlyTrackTwoDue() {
        let store = Self.seeded(dualTrack: .primaryDone)

        #expect(store.user.dualTrackEnabled)
        #expect(Self.completedStandardToday(in: store, track: .primary))
        #expect(!Self.completedStandardToday(in: store, track: .second))
        // Dual track opts in past the fork (day 55), so the account sits on
        // forkDay + 2 once today's Track One sit is done.
        #expect(store.user.currentDay == StillPoint.forkDay + 2)
        #expect(StillPoint.isDualTrackEligible(currentDay: store.user.currentDay))
    }

    @Test func bothDueSeedSitsOnTheDayAfterTheFork() {
        let store = Self.seeded(dualTrack: .bothDue)

        #expect(store.user.currentDay == StillPoint.forkDay + 1)
        #expect(StillPoint.isDualTrackEligible(currentDay: store.user.currentDay))
    }

    @Test func singleTrackSeedKeepsDualTrackOff() {
        let store = Self.seeded()

        #expect(!store.user.dualTrackEnabled)
        #expect(store.user.secondTrackDay == 1)
        #expect(store.sessions.allSatisfy { ($0.track ?? .primary) == .primary })
    }

    // MARK: - Recovery ramp

    @Test func recoveryRampSeedIsAnActiveRampWithAMissedDayGap() throws {
        let store = Self.seeded(recoveryRamp: true)

        let ramp = try #require(DurationRecovery.activeRecovery(DurationRecovery.recoveryFields(from: store.user)))
        #expect(ramp.recoveryTargetDay == 3)
        #expect(ramp.recoveryCurrentStep == 2)
        #expect(ramp.recoveryTotalSteps == 3)

        let practice = SessionCalendar.effectiveLocalIsoDate(previousDayComplete: false, now: Self.fixedNow)
        let lastPrimaryDate = store.sessions
            .filter { $0.sessionType == .standard && $0.completed }
            .map(\.sessionDate)
            .max()
        #expect(lastPrimaryDate == SessionCalendar.addDays(toIsoDate: practice, deltaDays: -4))
    }

    /// Both flags together: the ramp freezes `currentDay` at its target, so the
    /// final step completing advances to target + 1, not past it.
    @Test func combinedDualTrackAndRecoveryRampFreezesCurrentDayAtTheTarget() throws {
        let store = Self.seeded(dualTrack: .primaryDone, recoveryRamp: true)

        let ramp = try #require(DurationRecovery.activeRecovery(DurationRecovery.recoveryFields(from: store.user)))
        #expect(ramp.recoveryTargetDay == store.user.currentDay)
        #expect(store.user.currentDay == StillPoint.forkDay + 1)
        #expect(store.user.dualTrackEnabled)
        #expect(store.sessions.filter { $0.sessionType == .standard && $0.track != .second }
            .allSatisfy { $0.dayNumber <= store.user.currentDay })
    }

    @Test func combinedBothDueAndRampLeavesBothTracksDue() {
        let store = Self.seeded(dualTrack: .bothDue, recoveryRamp: true)

        #expect(!Self.completedStandardToday(in: store, track: .primary))
        #expect(!Self.completedStandardToday(in: store, track: .second))
    }

    // MARK: - Before 6:00 (grace rule)

    /// Before 6:00 with yesterday unfinished, the app's practice day is yesterday.
    /// A done-today seed must land on that day, or Track One reads as due.
    @Test func beforeSixPrimaryDoneStampsTheDayTheAppRequests() {
        let now = Self.localTime(hour: 3)
        let store = Self.seeded(dualTrack: .primaryDone, recoveryRamp: true, now: now)

        let practice = SessionCalendar.effectiveLocalIsoDate(previousDayComplete: false, now: now)
        #expect(practice == SessionCalendar.localIsoDate(now: now, offsetDays: -1))
        let doneSit = store.sessions.first { $0.id == "ui-seed-primary-today" }
        #expect(doneSit?.sessionDate == practice)
        #expect(doneSit?.completed == true)
    }

    /// Before 6:00 with yesterday complete, the practice day is today, so the
    /// done-today sit stays on the calendar day and yesterday's sits still count.
    @Test func beforeSixWithYesterdayCompleteStampsToday() {
        let now = Self.localTime(hour: 3)
        let store = Self.seeded(dualTrack: .primaryDone, now: now)

        let practice = SessionCalendar.effectiveLocalIsoDate(previousDayComplete: true, now: now)
        #expect(practice == SessionCalendar.localIsoDate(now: now))
        let doneSit = store.sessions.first { $0.id == "ui-seed-primary-today" }
        #expect(doneSit?.sessionDate == practice)
    }

    // MARK: - Focus history

    @Test func focusHistorySeedHasCategorisedAndUncategorisedFocusSits() {
        let store = Self.seeded(focusHistory: true)
        let focus = store.sessions.filter { $0.sessionType == .focus }

        #expect(focus.count == 3)
        #expect(focus.allSatisfy { $0.completed })
        #expect(focus.contains { $0.focusCategory == .reading })
        #expect(focus.contains { $0.focusCategory == .writing })
        #expect(focus.contains { $0.focusCategory == nil })
    }

    // MARK: - Config parse

    @Test func flagsParseOnlyWithUITestMode() {
        #expect(UITestConfig.from(environment: [
            "SP_UI_TEST_DUAL_TRACK": "1",
            "SP_UI_TEST_RECOVERY_RAMP": "1",
            "SP_UI_TEST_FOCUS_HISTORY": "1",
        ]) == nil)

        let config = UITestConfig.from(environment: [
            "SP_UI_TEST_MODE": "1",
            "SP_UI_TEST_DUAL_TRACK": "1",
            "SP_UI_TEST_RECOVERY_RAMP": "true",
            "SP_UI_TEST_FOCUS_HISTORY": "on",
        ])
        #expect(config?.dualTrackSeed == .bothDue)
        #expect(config?.recoveryRampSeed == true)
        #expect(config?.focusHistorySeed == true)
        #expect(config?.hasStateSeed == true)
    }

    @Test func primaryDoneFlagWinsOverDualTrackFlag() {
        let config = UITestConfig.from(environment: [
            "SP_UI_TEST_MODE": "1",
            "SP_UI_TEST_DUAL_TRACK": "1",
            "SP_UI_TEST_DUAL_TRACK_PRIMARY_DONE": "1",
        ])
        #expect(config?.dualTrackSeed == .primaryDone)
    }

    @Test func noStateFlagsMeansNoStateSeed() {
        let config = UITestConfig.from(environment: [
            "SP_UI_TEST_MODE": "1",
            "SP_UI_TEST_SEED_AUTH": "1",
        ])
        #expect(config?.dualTrackSeed == UITestDualTrackSeed.none)
        #expect(config?.hasStateSeed == false)
    }

    // MARK: - Through the fake backend

    @Test func fakeBackendServesTheSeededTracksAndRamp() async throws {
        let key = "still-point.ui-test-store.tests.\(UUID().uuidString)"
        defer { UserDefaults.standard.removeObject(forKey: key) }
        let store = try #require(UITestAPIStore.make(
            environment: [
                "SP_UI_TEST_MODE": "1",
                "SP_UI_TEST_SEED_AUTH": "1",
                "SP_UI_TEST_DUAL_TRACK_PRIMARY_DONE": "1",
                "SP_UI_TEST_RECOVERY_RAMP": "1",
            ],
            defaultsKey: key
        ))

        // The launch path seeds from the device clock. With a ramp, yesterday is
        // open, so the practice day is the one the seed stamps (before 6:00 it is yesterday).
        let realToday = SessionCalendar.effectiveLocalIsoDate(previousDayComplete: false)
        let tracks = try await store.getTracksDoneToday(date: realToday)
        #expect(tracks.primary)
        #expect(!tracks.second)

        let user = try #require(try await store.me(today: realToday))
        #expect(user.recoveryTargetDay == StillPoint.forkDay + 1)
    }
}
