import Foundation
import Testing
@testable import StillPointShared

@Suite(.serialized) final class SessionIntroPrefsTests {
    init() {
        SessionIntroPrefs.resetPersistedPrefs()
    }

    deinit {
        SessionIntroPrefs.resetPersistedPrefs()
    }

    @Test func testDefaultIsNotHidden() {
        #expect(!SessionIntroPrefs.isIntroOverlayHidden)
    }

    @Test func testSetHiddenPersists() {
        SessionIntroPrefs.setIntroOverlayHidden(true)
        #expect(SessionIntroPrefs.isIntroOverlayHidden)
    }

    @Test func testResetClearsHiddenFlag() {
        SessionIntroPrefs.setIntroOverlayHidden(true)
        SessionIntroPrefs.resetPersistedPrefs()
        #expect(!SessionIntroPrefs.isIntroOverlayHidden)
    }

    @Test func testReEnableAfterHide() {
        SessionIntroPrefs.setIntroOverlayHidden(true)
        SessionIntroPrefs.setIntroOverlayHidden(false)
        #expect(!SessionIntroPrefs.isIntroOverlayHidden)
    }
}
