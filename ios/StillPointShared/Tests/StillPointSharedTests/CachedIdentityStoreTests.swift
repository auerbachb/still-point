import Foundation
import Testing
import StillPointShared

/// #665 — the identity half of offline-first: the local copy of `UserDTO` that
/// lets a cold launch with no network still know who you are.
final class CachedIdentityStoreTests {
    private let suiteName: String
    private let defaults: UserDefaults

    init() throws {
        suiteName = "still-point.cached-identity.tests.\(UUID().uuidString)"
        defaults = try #require(UserDefaults(suiteName: suiteName))
    }

    deinit {
        UserDefaults.standard.removePersistentDomain(forName: suiteName)
    }

    private func makeUser(
        id: String = "user-1",
        currentDay: Int = 24,
        dualTrackEnabled: Bool = true,
        secondTrackDay: Int = 8
    ) -> UserDTO {
        UserDTO(
            id: id,
            email: "sitter@example.com",
            username: "sitter",
            isPublic: true,
            currentDay: currentDay,
            aphorismsEnabled: true,
            attentionTrackingEnabled: true,
            dualTrackEnabled: dualTrackEnabled,
            secondTrackDay: secondTrackDay,
            recoveryTargetDay: 30,
            recoveryCurrentStep: 2,
            recoveryTotalSteps: 4,
            ambientSoundEnabled: true
        )
    }

    // MARK: - Round trip

    /// Everything the offline Home screen reads has to survive the round trip —
    /// the day number, the dual-track fork, and the recovery ramp especially,
    /// since those drive what a sit is *for* today.
    @Test func testSaveThenLoadRestoresEveryField() throws {
        let user = makeUser()

        #expect(CachedIdentityStore.save(user, into: defaults))
        let restored = try #require(CachedIdentityStore.load(from: defaults))

        #expect(restored.id == user.id)
        #expect(restored.email == user.email)
        #expect(restored.username == user.username)
        #expect(restored.isPublic == user.isPublic)
        #expect(restored.currentDay == user.currentDay)
        #expect(restored.aphorismsEnabled == user.aphorismsEnabled)
        #expect(restored.attentionTrackingEnabled == user.attentionTrackingEnabled)
        #expect(restored.dualTrackEnabled == user.dualTrackEnabled)
        #expect(restored.secondTrackDay == user.secondTrackDay)
        #expect(restored.recoveryTargetDay == user.recoveryTargetDay)
        #expect(restored.recoveryCurrentStep == user.recoveryCurrentStep)
        #expect(restored.recoveryTotalSteps == user.recoveryTotalSteps)
        #expect(restored.ambientSoundEnabled == user.ambientSoundEnabled)
    }

    @Test func testLoadReturnsNilWhenNothingCached() {
        #expect(CachedIdentityStore.load(from: defaults) == nil)
    }

    /// A later `me()` must replace the local copy rather than accumulate — the day
    /// number moves, and an account switch must not leave the old identity behind.
    @Test func testSaveOverwritesPriorIdentity() throws {
        CachedIdentityStore.save(makeUser(id: "user-1", currentDay: 24), into: defaults)
        CachedIdentityStore.save(makeUser(id: "user-2", currentDay: 3), into: defaults)

        let restored = try #require(CachedIdentityStore.load(from: defaults))
        #expect(restored.id == "user-2")
        #expect(restored.currentDay == 3)
    }

    @Test func testClearRemovesIdentity() {
        CachedIdentityStore.save(makeUser(), into: defaults)
        CachedIdentityStore.clear(from: defaults)

        #expect(CachedIdentityStore.load(from: defaults) == nil)
    }

    @Test func testCorruptPayloadLoadsAsNilRatherThanThrowing() {
        defaults.set(Data("not json".utf8), forKey: CachedIdentityStore.key)

        #expect(CachedIdentityStore.load(from: defaults) == nil)
    }

    // MARK: - Only an authoritative cause may clear

    /// AC: a 401 clears the cached identity.
    @Test func testUnauthorizedClearsCachedIdentity() {
        CachedIdentityStore.save(makeUser(), into: defaults)

        #expect(CachedIdentityStore.clearIfAuthoritative(on: .unauthorized, from: defaults))
        #expect(CachedIdentityStore.load(from: defaults) == nil)
    }

    /// An explicit sign-out, or the server reporting no session at all.
    @Test func testSignedOutClearsCachedIdentity() {
        CachedIdentityStore.save(makeUser(), into: defaults)

        #expect(CachedIdentityStore.clearIfAuthoritative(on: .signedOut, from: defaults))
        #expect(CachedIdentityStore.load(from: defaults) == nil)
    }

    /// AC: a transport failure must not trigger the sign-out teardown. Callers gate
    /// `trackingControlPrefsManager.clearOnLogout()` and the per-account unlock reset
    /// on this same `false`.
    @Test func testUnreachableKeepsCachedIdentity() throws {
        CachedIdentityStore.save(makeUser(), into: defaults)

        #expect(!CachedIdentityStore.clearIfAuthoritative(on: .unreachable, from: defaults))
        #expect(try #require(CachedIdentityStore.load(from: defaults)).id == "user-1")
    }

    @Test func testServerErrorKeepsCachedIdentity() throws {
        CachedIdentityStore.save(makeUser(), into: defaults)

        #expect(!CachedIdentityStore.clearIfAuthoritative(on: .serverError, from: defaults))
        #expect(try #require(CachedIdentityStore.load(from: defaults)).id == "user-1")
    }

    /// The clearing rule is not a second copy of the widget's — it is the widget's.
    @Test func testClearingMatchesWidgetSnapshotPredicate() {
        for cause in [WidgetDataStore.SignedOutCause.signedOut, .unauthorized, .serverError, .unreachable] {
            CachedIdentityStore.save(makeUser(), into: defaults)
            #expect(
                CachedIdentityStore.clearIfAuthoritative(on: cause, from: defaults) == WidgetDataStore.shouldClearStoredSnapshot(on: cause),
                "Cached identity and widget snapshot disagreed on \(cause)"
            )
            CachedIdentityStore.clear(from: defaults)
        }
    }

    /// The identity payload is stored under its own key, so clearing it never
    /// disturbs the widget's snapshot living in the same App Group container.
    @Test func testClearingIdentityLeavesWidgetSnapshotKeyUntouched() {
        defaults.set(Data("widget-blob".utf8), forKey: WidgetAppGroup.dataKey)
        CachedIdentityStore.save(makeUser(), into: defaults)

        CachedIdentityStore.clear(from: defaults)

        #expect(defaults.data(forKey: WidgetAppGroup.dataKey) != nil)
        #expect(CachedIdentityStore.key != WidgetAppGroup.dataKey)
    }
}
