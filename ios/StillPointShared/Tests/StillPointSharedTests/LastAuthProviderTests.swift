import XCTest
@testable import StillPointShared

final class LastAuthProviderTests: XCTestCase {
    override func setUp() {
        super.setUp()
        LastAuthProvider.resetPersisted()
    }

    override func tearDown() {
        LastAuthProvider.resetPersisted()
        super.tearDown()
    }

    func testLoadReturnsNilWhenNothingStored() {
        XCTAssertNil(LastAuthProvider.load())
    }

    func testSaveAndLoadRoundTripForGoogle() {
        LastAuthProvider.save(.google)
        XCTAssertEqual(LastAuthProvider.load(), .google)
    }

    func testSaveAndLoadRoundTripForApple() {
        LastAuthProvider.save(.apple)
        XCTAssertEqual(LastAuthProvider.load(), .apple)
    }

    func testSaveAndLoadRoundTripForEmail() {
        LastAuthProvider.save(.email)
        XCTAssertEqual(LastAuthProvider.load(), .email)
    }

    func testSaveOverwritesPreviousProvider() {
        LastAuthProvider.save(.google)
        LastAuthProvider.save(.email)
        XCTAssertEqual(LastAuthProvider.load(), .email)
    }

    func testLoadReturnsNilForUnknownStoredValue() {
        UserDefaults.standard.set("github", forKey: LastAuthProvider.storageKey)
        XCTAssertNil(LastAuthProvider.load())
    }

    func testResetClearsStoredProvider() {
        LastAuthProvider.save(.apple)
        LastAuthProvider.resetPersisted()
        XCTAssertNil(LastAuthProvider.load())
    }

    func testStorageKeyMatchesWebLocalStorageKey() {
        XCTAssertEqual(LastAuthProvider.storageKey, "stillpoint_last_auth_provider")
    }
}
