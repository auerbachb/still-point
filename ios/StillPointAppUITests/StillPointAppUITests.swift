import XCTest

final class StillPointAppUITests: XCTestCase {
    private let launchTimeout: TimeInterval = 15

    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    @MainActor
    func testLaunchLoginCompleteSessionAndHistoryPersistence() throws {
        let app = makeApp(
            seedAuthenticated: false,
            resetStore: true,
            sessionSeconds: 6,
            timerMultiplier: 3
        )
        app.launch()

        let authRoot = app.otherElements["root.currentView.auth"]
        XCTAssertTrue(authRoot.waitForExistence(timeout: launchTimeout), "Auth screen did not appear")
        assertColdStartBound(app: app, maxMs: 5_000)

        let emailField = app.textFields["auth.emailField"]
        XCTAssertTrue(emailField.waitForExistence(timeout: 5))
        emailField.tap()
        emailField.typeText("ios.fixture@stillpoint.test")

        let passwordField = app.secureTextFields["auth.passwordField"]
        XCTAssertTrue(passwordField.waitForExistence(timeout: 5))
        passwordField.tap()
        passwordField.typeText("stillpoint-pass")

        let submitButton = app.buttons["auth.submitButton"]
        XCTAssertTrue(submitButton.isHittable)
        submitButton.tap()

        XCTAssertTrue(app.otherElements["root.currentView.home"].waitForExistence(timeout: 8))
        let beginButton = app.buttons["home.beginButton"]
        XCTAssertTrue(beginButton.waitForExistence(timeout: 5))
        XCTAssertTrue(beginButton.isHittable)
        beginButton.tap()

        XCTAssertTrue(app.otherElements["root.currentView.session"].waitForExistence(timeout: 8))
        let timerLabel = app.staticTexts["session.timerLabel"]
        XCTAssertTrue(timerLabel.waitForExistence(timeout: 3))
        XCTAssertTrue(timerLabel.label.contains(":"), "Timer format should contain mm:ss delimiter")
        XCTAssertTrue(timerLabel.label.contains("Time remaining"), "Timer should expose VoiceOver-friendly label")

        let lightHold = app.staticTexts["session.lightDistractionHoldButton"]
        XCTAssertTrue(lightHold.waitForExistence(timeout: 3))
        XCTAssertEqual(lightHold.value as? String, "inactive")
        pressAndHold(element: lightHold, duration: 1.0)
        XCTAssertEqual(lightHold.value as? String, "inactive", "Release should end hold state and avoid stuck distraction")

        XCTAssertTrue(app.otherElements["root.currentView.completion"].waitForExistence(timeout: 12))
        XCTAssertTrue(app.staticTexts["completion.dayTitle"].exists)
        XCTAssertTrue(app.staticTexts["completion.durationLabel"].exists)

        let returnButton = app.buttons["completion.returnButton"]
        XCTAssertTrue(returnButton.waitForExistence(timeout: 5))
        returnButton.tap()
        XCTAssertTrue(app.otherElements["root.currentView.home"].waitForExistence(timeout: 8))

        app.terminate()

        let relaunch = makeApp(
            seedAuthenticated: true,
            resetStore: false,
            sessionSeconds: 6,
            timerMultiplier: 3
        )
        relaunch.launch()

        XCTAssertTrue(relaunch.otherElements["root.currentView.home"].waitForExistence(timeout: launchTimeout))
        assertColdStartBound(app: relaunch, maxMs: 5_000)

        openTab(named: "PROGRESS", in: relaunch)
        XCTAssertTrue(relaunch.staticTexts["history.title"].waitForExistence(timeout: 8))
        let dayRow = relaunch.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "history.session.day.")).firstMatch
        XCTAssertTrue(dayRow.waitForExistence(timeout: 8), "Expected persisted history row after relaunch")
    }

    @MainActor
    func testHistoryAndSettingsNavigationSmoke() throws {
        let app = makeApp(seedAuthenticated: true, resetStore: true)
        app.launch()

        XCTAssertTrue(app.otherElements["root.currentView.home"].waitForExistence(timeout: launchTimeout))
        openTab(named: "PROGRESS", in: app)
        XCTAssertTrue(app.staticTexts["history.title"].waitForExistence(timeout: 6))

        openTab(named: "SETTINGS", in: app)
        XCTAssertTrue(app.staticTexts["settings.title"].waitForExistence(timeout: 6))
        XCTAssertTrue(app.buttons["settings.logoutButton"].exists)
    }

    @MainActor
    func testKeyboardOverlapKeepsSubmitReachable() throws {
        let app = makeApp(seedAuthenticated: false, resetStore: true)
        app.launch()

        XCTAssertTrue(app.otherElements["root.currentView.auth"].waitForExistence(timeout: launchTimeout))
        let emailField = app.textFields["auth.emailField"]
        let passwordField = app.secureTextFields["auth.passwordField"]
        let submitButton = app.buttons["auth.submitButton"]

        XCTAssertTrue(emailField.waitForExistence(timeout: 5))
        XCTAssertTrue(passwordField.waitForExistence(timeout: 5))
        XCTAssertTrue(submitButton.waitForExistence(timeout: 5))

        emailField.tap()
        emailField.typeText("ios.fixture@stillpoint.test")
        passwordField.tap()
        passwordField.typeText("stillpoint-pass")
        XCTAssertTrue(submitButton.isHittable, "Submit should remain reachable with keyboard visible")
    }

    @MainActor
    func testLaunchOfflineShowsUserVisibleMessage() throws {
        let app = makeApp(
            seedAuthenticated: true,
            resetStore: true,
            forceLaunchOffline: true
        )
        app.launch()

        XCTAssertTrue(app.otherElements["root.currentView.auth"].waitForExistence(timeout: launchTimeout))
        let message = app.staticTexts["auth.launchStatusMessage"]
        XCTAssertTrue(message.waitForExistence(timeout: 5))
        XCTAssertTrue(message.label.localizedCaseInsensitiveContains("internet")
                        || message.label.localizedCaseInsensitiveContains("connection"))
    }

    @MainActor
    func testTokenExpiryRoutesToReauthMessage() throws {
        let app = makeApp(
            seedAuthenticated: true,
            resetStore: true,
            forceTokenExpired: true
        )
        app.launch()

        XCTAssertTrue(app.otherElements["root.currentView.auth"].waitForExistence(timeout: launchTimeout))
        let message = app.staticTexts["auth.launchStatusMessage"]
        XCTAssertTrue(message.waitForExistence(timeout: 5))
        XCTAssertTrue(message.label.localizedCaseInsensitiveContains("expired")
                        || message.label.localizedCaseInsensitiveContains("log in"))
    }

    @MainActor
    func testRotationDecisionSessionRemainsUsableInLandscape() throws {
        let app = makeApp(seedAuthenticated: true, resetStore: true, sessionSeconds: 8, timerMultiplier: 2)
        app.launch()

        XCTAssertTrue(app.otherElements["root.currentView.home"].waitForExistence(timeout: launchTimeout))
        app.buttons["home.beginButton"].tap()
        XCTAssertTrue(app.otherElements["root.currentView.session"].waitForExistence(timeout: 8))

        XCUIDevice.shared.orientation = .landscapeLeft
        defer { XCUIDevice.shared.orientation = .portrait }

        let timerLabel = app.staticTexts["session.timerLabel"]
        XCTAssertTrue(timerLabel.waitForExistence(timeout: 3))
        XCTAssertTrue(timerLabel.isHittable, "Timer should remain visible and usable after rotation")
        XCTAssertTrue(app.buttons["session.endEarlyButton"].isHittable, "Primary control should remain reachable in landscape")
    }

    @MainActor
    func testPrimaryControlsVisibleAboveHomeIndicator() throws {
        let app = makeApp(seedAuthenticated: true, resetStore: true)
        app.launch()

        XCTAssertTrue(app.otherElements["root.currentView.home"].waitForExistence(timeout: launchTimeout))
        let beginButton = app.buttons["home.beginButton"]
        XCTAssertTrue(beginButton.waitForExistence(timeout: 5))
        XCTAssertTrue(beginButton.isHittable, "Home primary action should be visible above safe-area/home indicator")
    }

    @MainActor
    func testVoiceOverLabelsForTimerAndPrimaryButton() throws {
        let app = makeApp(seedAuthenticated: true, resetStore: true, sessionSeconds: 8, timerMultiplier: 2)
        app.launch()

        XCTAssertTrue(app.otherElements["root.currentView.home"].waitForExistence(timeout: launchTimeout))
        let beginButton = app.buttons["home.beginButton"]
        XCTAssertTrue(beginButton.waitForExistence(timeout: 5))
        XCTAssertEqual(beginButton.label, "Start session")
        beginButton.tap()

        XCTAssertTrue(app.otherElements["root.currentView.session"].waitForExistence(timeout: 8))
        let timerLabel = app.staticTexts["session.timerLabel"]
        XCTAssertTrue(timerLabel.waitForExistence(timeout: 3))
        XCTAssertTrue(timerLabel.label.localizedCaseInsensitiveContains("time remaining"))
    }

    @MainActor
    func testSessionsFailureShowsVisibleRetryMessage() throws {
        let app = makeApp(seedAuthenticated: true, resetStore: true, forceSessionsFailure: true)
        app.launch()

        XCTAssertTrue(app.otherElements["root.currentView.home"].waitForExistence(timeout: launchTimeout))
        openTab(named: "PROGRESS", in: app)

        let errorLabel = app.staticTexts["history.errorMessage"]
        XCTAssertTrue(errorLabel.waitForExistence(timeout: 8))
        XCTAssertTrue(errorLabel.label.localizedCaseInsensitiveContains("failed")
                        || errorLabel.label.localizedCaseInsensitiveContains("connection"))
    }

    private func makeApp(
        seedAuthenticated: Bool,
        resetStore: Bool,
        sessionSeconds: Int = 10,
        timerMultiplier: Int = 1,
        forceLaunchOffline: Bool = false,
        forceTokenExpired: Bool = false,
        forceSessionsFailure: Bool = false
    ) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchEnvironment["SP_UI_TEST_MODE"] = "1"
        app.launchEnvironment["SP_UI_TEST_SEED_AUTH"] = seedAuthenticated ? "1" : "0"
        app.launchEnvironment["SP_UI_TEST_RESET_STORE"] = resetStore ? "1" : "0"
        app.launchEnvironment["SP_UI_TEST_SESSION_SECONDS"] = String(sessionSeconds)
        app.launchEnvironment["SP_UI_TEST_TIMER_MULTIPLIER"] = String(timerMultiplier)
        app.launchEnvironment["SP_UI_TEST_FORCE_LAUNCH_OFFLINE"] = forceLaunchOffline ? "1" : "0"
        app.launchEnvironment["SP_UI_TEST_FORCE_TOKEN_EXPIRED"] = forceTokenExpired ? "1" : "0"
        app.launchEnvironment["SP_UI_TEST_FORCE_SESSIONS_FAILURE"] = forceSessionsFailure ? "1" : "0"
        return app
    }

    private func openTab(named tabTitle: String, in app: XCUIApplication) {
        let tabButton = app.tabBars.buttons[tabTitle]
        XCTAssertTrue(tabButton.waitForExistence(timeout: 5))
        tabButton.tap()
    }

    private func pressAndHold(element: XCUIElement, duration: TimeInterval) {
        let start = element.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
        let end = start.withOffset(CGVector(dx: 0, dy: 0))
        start.press(forDuration: duration, thenDragTo: end)
    }

    private func assertColdStartBound(app: XCUIApplication, maxMs: Int) {
        let roots = app.otherElements.matching(NSPredicate(format: "identifier BEGINSWITH %@", "root.currentView."))
        let root = roots.firstMatch
        let value = (root.value as? String) ?? ""
        guard let ms = parseMetricMs(from: value) else {
            XCTFail("Missing cold-start metric in root accessibility value: \(value)")
            return
        }
        XCTAssertLessThanOrEqual(ms, maxMs, "Cold start auth check exceeded documented bound")
    }

    private func parseMetricMs(from value: String) -> Int? {
        let prefix = "coldStartAuthCheckMs="
        guard let range = value.range(of: prefix) else { return nil }
        let msRaw = value[range.upperBound...]
        return Int(msRaw)
    }
}
