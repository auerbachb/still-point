import XCTest
@testable import StillPointShared

final class SessionIntroPrefsTests: XCTestCase {
    override func setUp() {
        super.setUp()
        SessionIntroPrefs.resetPersistedPrefs()
    }

    override func tearDown() {
        SessionIntroPrefs.resetPersistedPrefs()
        super.tearDown()
    }

    func testDefaultIsNotHidden() {
        XCTAssertFalse(SessionIntroPrefs.isIntroOverlayHidden)
    }

    func testSetHiddenPersists() {
        SessionIntroPrefs.setIntroOverlayHidden(true)
        XCTAssertTrue(SessionIntroPrefs.isIntroOverlayHidden)
    }

    func testResetClearsHiddenFlag() {
        SessionIntroPrefs.setIntroOverlayHidden(true)
        SessionIntroPrefs.resetPersistedPrefs()
        XCTAssertFalse(SessionIntroPrefs.isIntroOverlayHidden)
    }

    func testReEnableAfterHide() {
        SessionIntroPrefs.setIntroOverlayHidden(true)
        SessionIntroPrefs.setIntroOverlayHidden(false)
        XCTAssertFalse(SessionIntroPrefs.isIntroOverlayHidden)
    }
}
