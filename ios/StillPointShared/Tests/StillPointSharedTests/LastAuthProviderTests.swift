import Foundation
import Testing
@testable import StillPointShared

@Suite(.serialized) final class LastAuthProviderTests {
    init() {
        LastAuthProvider.resetPersisted()
    }

    deinit {
        LastAuthProvider.resetPersisted()
    }

    @Test func testLoadReturnsNilWhenNothingStored() {
        #expect(LastAuthProvider.load() == nil)
    }

    @Test func testSaveAndLoadRoundTripForGoogle() {
        LastAuthProvider.save(.google)
        #expect(LastAuthProvider.load() == .google)
    }

    @Test func testSaveAndLoadRoundTripForApple() {
        LastAuthProvider.save(.apple)
        #expect(LastAuthProvider.load() == .apple)
    }

    @Test func testSaveAndLoadRoundTripForEmail() {
        LastAuthProvider.save(.email)
        #expect(LastAuthProvider.load() == .email)
    }

    @Test func testSaveOverwritesPreviousProvider() {
        LastAuthProvider.save(.google)
        LastAuthProvider.save(.email)
        #expect(LastAuthProvider.load() == .email)
    }

    @Test func testLoadReturnsNilForUnknownStoredValue() {
        UserDefaults.standard.set("github", forKey: LastAuthProvider.storageKey)
        #expect(LastAuthProvider.load() == nil)
    }

    @Test func testResetClearsStoredProvider() {
        LastAuthProvider.save(.apple)
        LastAuthProvider.resetPersisted()
        #expect(LastAuthProvider.load() == nil)
    }

    @Test func testStorageKeyMatchesWebLocalStorageKey() {
        #expect(LastAuthProvider.storageKey == "stillpoint_last_auth_provider")
    }
}
