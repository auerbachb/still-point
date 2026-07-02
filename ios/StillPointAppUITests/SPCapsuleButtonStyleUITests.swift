import XCTest

/// Targeted rendering/geometry coverage for `SPCapsuleButtonStyle` on screens
/// that were not reachable in smoke without dedicated seed knobs (issue #498).
final class SPCapsuleButtonStyleUITests: XCTestCase {
    private let launchTimeout: TimeInterval = 45

    override func setUpWithError() throws {
        continueAfterFailure = false
        XCUIDevice.shared.ensurePortraitOrientation()
    }

    override func tearDownWithError() throws {
        XCUIDevice.shared.ensurePortraitOrientation()
    }

    @MainActor
    func testBuddyHubCapsulePrimaryCTARendering() throws {
        let app = makeApp(
            seedAuthenticated: true,
            resetStore: true,
            forceBuddyHub: true
        )
        app.launch()

        waitForRoot(
            "buddyHub",
            in: app,
            timeout: launchTimeout,
            failureMessage: "Buddy hub did not appear"
        )

        let startButton = app.buttons["buddy.startSharedSessionButton"]
        assertCapsuleButtonRendering(startButton, in: app, minHeight: 44)
    }

    @MainActor
    func testBreathCountingEndCapsuleRendering() throws {
        let app = makeApp(
            seedAuthenticated: true,
            resetStore: true,
            forceBreathCounting: true
        )
        app.launch()

        waitForRoot(
            "breathCounting",
            in: app,
            timeout: launchTimeout,
            failureMessage: "Breath counting screen did not appear"
        )

        let endButton = app.buttons["breath.endButton"]
        assertCapsuleButtonRendering(endButton, in: app, minHeight: 32)
    }

    @MainActor
    func testAppBlockingCapsuleControlsRendering() throws {
        let app = makeApp(
            seedAuthenticated: true,
            resetStore: true,
            appBlockingSelected: true,
            forceSettingsTab: true
        )
        app.launch()

        waitForRoot(
            "home",
            in: app,
            timeout: launchTimeout,
            failureMessage: "Authenticated shell did not appear"
        )
        XCTAssertTrue(
            app.staticTexts["settings.title"].waitForExistence(timeout: 8),
            "Settings tab should open via SP_UI_TEST_FORCE_SETTINGS_TAB"
        )

        let chooseAppsButton = app.buttons["appBlocking.chooseAppsButton"]
        assertCapsuleButtonRendering(chooseAppsButton, in: app, minHeight: 44)

        let selectedCount = app.staticTexts["appBlocking.selectedCount"]
        assertCapsulePillRendering(selectedCount, in: app, minHeight: 24)
    }
}
