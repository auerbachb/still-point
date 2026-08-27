import XCTest
import StillPointShared

/// #665 — the identity half of offline-first: the local copy of `UserDTO` that
/// lets a cold launch with no network still know who you are.
final class CachedIdentityStoreTests: XCTestCase {
    private var suiteName: String!
    private var defaults: UserDefaults!

    override func setUpWithError() throws {
        try super.setUpWithError()
        suiteName = "still-point.cached-identity.tests.\(UUID().uuidString)"
        defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
    }

    override func tearDownWithError() throws {
        UserDefaults.standard.removePersistentDomain(forName: suiteName)
        defaults = nil
        suiteName = nil
        try super.tearDownWithError()
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
    func testSaveThenLoadRestoresEveryField() throws {
        let user = makeUser()

        XCTAssertTrue(CachedIdentityStore.save(user, into: defaults))
        let restored = try XCTUnwrap(CachedIdentityStore.load(from: defaults))

        XCTAssertEqual(restored.id, user.id)
        XCTAssertEqual(restored.email, user.email)
        XCTAssertEqual(restored.username, user.username)
        XCTAssertEqual(restored.isPublic, user.isPublic)
        XCTAssertEqual(restored.currentDay, user.currentDay)
        XCTAssertEqual(restored.aphorismsEnabled, user.aphorismsEnabled)
        XCTAssertEqual(restored.attentionTrackingEnabled, user.attentionTrackingEnabled)
        XCTAssertEqual(restored.dualTrackEnabled, user.dualTrackEnabled)
        XCTAssertEqual(restored.secondTrackDay, user.secondTrackDay)
        XCTAssertEqual(restored.recoveryTargetDay, user.recoveryTargetDay)
        XCTAssertEqual(restored.recoveryCurrentStep, user.recoveryCurrentStep)
        XCTAssertEqual(restored.recoveryTotalSteps, user.recoveryTotalSteps)
        XCTAssertEqual(restored.ambientSoundEnabled, user.ambientSoundEnabled)
    }

    func testLoadReturnsNilWhenNothingCached() {
        XCTAssertNil(CachedIdentityStore.load(from: defaults))
    }

    /// A later `me()` must replace the local copy rather than accumulate — the day
    /// number moves, and an account switch must not leave the old identity behind.
    func testSaveOverwritesPriorIdentity() throws {
        CachedIdentityStore.save(makeUser(id: "user-1", currentDay: 24), into: defaults)
        CachedIdentityStore.save(makeUser(id: "user-2", currentDay: 3), into: defaults)

        let restored = try XCTUnwrap(CachedIdentityStore.load(from: defaults))
        XCTAssertEqual(restored.id, "user-2")
        XCTAssertEqual(restored.currentDay, 3)
    }

    func testClearRemovesIdentity() {
        CachedIdentityStore.save(makeUser(), into: defaults)
        CachedIdentityStore.clear(from: defaults)

        XCTAssertNil(CachedIdentityStore.load(from: defaults))
    }

    func testCorruptPayloadLoadsAsNilRatherThanThrowing() {
        defaults.set(Data("not json".utf8), forKey: CachedIdentityStore.key)

        XCTAssertNil(CachedIdentityStore.load(from: defaults))
    }

    // MARK: - Only an authoritative cause may clear

    /// AC: a 401 clears the cached identity.
    func testUnauthorizedClearsCachedIdentity() {
        CachedIdentityStore.save(makeUser(), into: defaults)

        XCTAssertTrue(CachedIdentityStore.clearIfAuthoritative(on: .unauthorized, from: defaults))
        XCTAssertNil(CachedIdentityStore.load(from: defaults))
    }

    /// An explicit sign-out, or the server reporting no session at all.
    func testSignedOutClearsCachedIdentity() {
        CachedIdentityStore.save(makeUser(), into: defaults)

        XCTAssertTrue(CachedIdentityStore.clearIfAuthoritative(on: .signedOut, from: defaults))
        XCTAssertNil(CachedIdentityStore.load(from: defaults))
    }

    /// AC: a transport failure must not trigger the sign-out teardown. Callers gate
    /// `trackingControlPrefsManager.clearOnLogout()` and the per-account unlock reset
    /// on this same `false`.
    func testUnreachableKeepsCachedIdentity() throws {
        CachedIdentityStore.save(makeUser(), into: defaults)

        XCTAssertFalse(CachedIdentityStore.clearIfAuthoritative(on: .unreachable, from: defaults))
        XCTAssertEqual(try XCTUnwrap(CachedIdentityStore.load(from: defaults)).id, "user-1")
    }

    func testServerErrorKeepsCachedIdentity() throws {
        CachedIdentityStore.save(makeUser(), into: defaults)

        XCTAssertFalse(CachedIdentityStore.clearIfAuthoritative(on: .serverError, from: defaults))
        XCTAssertEqual(try XCTUnwrap(CachedIdentityStore.load(from: defaults)).id, "user-1")
    }

    /// The clearing rule is not a second copy of the widget's — it is the widget's.
    func testClearingMatchesWidgetSnapshotPredicate() {
        for cause in [WidgetDataStore.SignedOutCause.signedOut, .unauthorized, .serverError, .unreachable] {
            CachedIdentityStore.save(makeUser(), into: defaults)
            XCTAssertEqual(
                CachedIdentityStore.clearIfAuthoritative(on: cause, from: defaults),
                WidgetDataStore.shouldClearStoredSnapshot(on: cause),
                "Cached identity and widget snapshot disagreed on \(cause)"
            )
            CachedIdentityStore.clear(from: defaults)
        }
    }

    /// The identity payload is stored under its own key, so clearing it never
    /// disturbs the widget's snapshot living in the same App Group container.
    func testClearingIdentityLeavesWidgetSnapshotKeyUntouched() {
        defaults.set(Data("widget-blob".utf8), forKey: WidgetAppGroup.dataKey)
        CachedIdentityStore.save(makeUser(), into: defaults)

        CachedIdentityStore.clear(from: defaults)

        XCTAssertNotNil(defaults.data(forKey: WidgetAppGroup.dataKey))
        XCTAssertNotEqual(CachedIdentityStore.key, WidgetAppGroup.dataKey)
    }
}
