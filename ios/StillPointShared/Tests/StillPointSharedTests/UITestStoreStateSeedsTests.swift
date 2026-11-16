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
        focusHistory: Bool = false
    ) -> UITestStore {
        UITestStore.makeStateSeeded(
            seedAuthenticated: true,
            dualTrack: dualTrack,
            recoveryRamp: recoveryRamp,
            focusHistory: focusHistory,
            now: fixedNow
        )
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
        #expect(store.user.currentDay == 4)
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

        let lastPrimaryDate = store.sessions
            .filter { $0.sessionType == .standard && $0.completed }
            .map(\.sessionDate)
            .max()
        #expect(lastPrimaryDate == SessionCalendar.localIsoDate(now: Self.fixedNow, offsetDays: -4))
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

        // The launch path seeds from the device clock, so the day to ask about is the real today.
        let realToday = SessionCalendar.localTodayIsoDate()
        let tracks = try await store.getTracksDoneToday(date: realToday)
        #expect(tracks.primary)
        #expect(!tracks.second)

        let user = try #require(try await store.me(today: realToday))
        #expect(user.recoveryTargetDay == 3)
    }
}
