import XCTest

final class StillPointAppUITests: XCTestCase {
    // macos-26/iOS 26 CI can take tens of seconds before XCTest observes a
    // stable accessibility tree. Issues #266/#276.
    private let launchTimeout: TimeInterval = 45
    private let coldStartMaxMs = 45_000

    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    @MainActor
    func testPasswordResetEntryIsDiscoverable() throws {
        let app = makeApp(seedAuthenticated: false, resetStore: true)
        app.launch()

        waitForRoot("auth", in: app, failureMessage: "Auth screen did not appear")

        let emailField = app.textFields["auth.emailField"]
        XCTAssertTrue(emailField.waitForExistence(timeout: 5))
        emailField.tap()
        emailField.typeText("ios.fixture@stillpoint.test")

        let forgotPasswordButton = app.buttons["auth.forgotPasswordButton"]
        XCTAssertTrue(forgotPasswordButton.waitForExistence(timeout: 5))
        XCTAssertTrue(forgotPasswordButton.isHittable)
        forgotPasswordButton.tap()

        XCTAssertTrue(
            app.staticTexts["auth.passwordResetMessage"].waitForExistence(timeout: 5),
            "Password reset request confirmation should be visible"
        )
    }

    @MainActor
    func testLaunchLoginCompleteSessionAndHistoryPersistence() throws {
        let app = makeApp(
            seedAuthenticated: false,
            resetStore: true,
            sessionSeconds: 30,
            timerMultiplier: 3.0
        )
        app.launch()

        waitForRoot("auth", in: app, failureMessage: "Auth screen did not appear")

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
        tap(beginButton, thenWaitForRoot: "session", in: app)

        let timerLabel = app.staticTexts["session.timerLabel"]
        XCTAssertTrue(timerLabel.waitForExistence(timeout: 8))
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

        // Save Note happy path — guards the regression class from issue #254
        // (note save errored in production) and exercises the path the iOS
        // E2E gate from issue #253 must catch.
        let endNoteEditor = app.textViews["completion.endNoteEditor"]
        XCTAssertTrue(endNoteEditor.waitForExistence(timeout: 5), "End-of-session note editor should be present")
        endNoteEditor.tap()
        endNoteEditor.typeText("e2e end note")

        let saveNoteButton = app.buttons["completion.saveNoteButton"]
        XCTAssertTrue(saveNoteButton.waitForExistence(timeout: 3))
        XCTAssertTrue(saveNoteButton.isHittable)
        saveNoteButton.tap()

        XCTAssertTrue(
            app.staticTexts["completion.savedIndicator"].waitForExistence(timeout: 5),
            "Save note should produce a 'Saved' indicator"
        )

        let returnButton = app.buttons["completion.returnButton"]
        XCTAssertTrue(returnButton.waitForExistence(timeout: 5))
        returnButton.tap()
        XCTAssertTrue(app.otherElements["root.currentView.home"].waitForExistence(timeout: 8))

        app.terminate()

        let relaunch = makeApp(
            seedAuthenticated: true,
            resetStore: false,
            sessionSeconds: 30,
            timerMultiplier: 3.0
        )
        relaunch.launch()

        waitForRoot("home", in: relaunch, failureMessage: "Home screen did not appear after relaunch")

        openTab(identifier: "tab.progress", in: relaunch)
        XCTAssertTrue(relaunch.staticTexts["history.title"].waitForExistence(timeout: 8))
        let dayRow = relaunch.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "history.session.day.")).firstMatch
        XCTAssertTrue(dayRow.waitForExistence(timeout: 8), "Expected persisted history row after relaunch")
    }

    @MainActor
    func testHistoryAndSettingsNavigationSmoke() throws {
        let app = makeApp(seedAuthenticated: true, resetStore: true)
        app.launch()

        waitForRoot("home", in: app, failureMessage: "Home screen did not appear")
        openTab(identifier: "tab.progress", in: app)
        XCTAssertTrue(app.staticTexts["history.title"].waitForExistence(timeout: 6))

        openTab(identifier: "tab.settings", in: app)
        XCTAssertTrue(app.staticTexts["settings.title"].waitForExistence(timeout: 6))
        XCTAssertTrue(app.buttons["settings.logoutButton"].exists)
    }

    @MainActor
    func testKeyboardOverlapKeepsSubmitReachable() throws {
        let app = makeApp(seedAuthenticated: false, resetStore: true)
        app.launch()

        waitForRoot("auth", in: app, failureMessage: "Auth screen did not appear")
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
        let keyboard = app.keyboards.firstMatch
        XCTAssertTrue(keyboard.waitForExistence(timeout: 5), "Keyboard should be visible for overlap reachability check")
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

        waitForRoot("auth", in: app, failureMessage: "Auth screen did not appear")
        let message = app.staticTexts["authView.launchAuthStatusMessage"]
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

        waitForRoot("auth", in: app, failureMessage: "Auth screen did not appear")
        let message = app.staticTexts["authView.launchAuthStatusMessage"]
        XCTAssertTrue(message.waitForExistence(timeout: 5))
        XCTAssertTrue(message.label.localizedCaseInsensitiveContains("expired")
                        || message.label.localizedCaseInsensitiveContains("log in"))
    }

    @MainActor
    func testRotationDecisionSessionRemainsUsableInLandscape() throws {
        let app = makeApp(seedAuthenticated: true, resetStore: true, sessionSeconds: 30, timerMultiplier: 2.0)
        app.launch()

        waitForRoot("home", in: app, failureMessage: "Home screen did not appear")
        let beginButton = app.buttons["home.beginButton"]
        XCTAssertTrue(beginButton.waitForExistence(timeout: 5))
        tap(beginButton, thenWaitForRoot: "session", in: app)

        XCUIDevice.shared.orientation = .landscapeLeft
        defer { XCUIDevice.shared.orientation = .portrait }

        let timerLabel = app.staticTexts["session.timerLabel"]
        XCTAssertTrue(timerLabel.waitForExistence(timeout: 8))
        XCTAssertTrue(timerLabel.isHittable, "Timer should remain visible and usable after rotation")
        XCTAssertTrue(app.buttons["session.endEarlyButton"].isHittable, "Primary control should remain reachable in landscape")
    }

    @MainActor
    func testPrimaryControlsVisibleAboveHomeIndicator() throws {
        let app = makeApp(seedAuthenticated: true, resetStore: true)
        app.launch()

        waitForRoot("home", in: app, failureMessage: "Home screen did not appear")
        let beginButton = app.buttons["home.beginButton"]
        XCTAssertTrue(beginButton.waitForExistence(timeout: 5))
        XCTAssertTrue(beginButton.isHittable, "Home primary action should be visible above safe-area/home indicator")
    }

    @MainActor
    func testVoiceOverLabelsForTimerAndPrimaryButton() throws {
        let app = makeApp(seedAuthenticated: true, resetStore: true, sessionSeconds: 8, timerMultiplier: 2.0)
        app.launch()

        waitForRoot("home", in: app, failureMessage: "Home screen did not appear")
        let beginButton = app.buttons["home.beginButton"]
        XCTAssertTrue(beginButton.waitForExistence(timeout: 5))
        XCTAssertEqual(beginButton.label, "Start session")
        tap(beginButton, thenWaitForRoot: "session", in: app)

        let timerLabel = app.staticTexts["session.timerLabel"]
        XCTAssertTrue(timerLabel.waitForExistence(timeout: 3))
        XCTAssertTrue(timerLabel.label.localizedCaseInsensitiveContains("time remaining"))
    }

    @MainActor
    func testSessionsFailureShowsVisibleRetryMessage() throws {
        let app = makeApp(seedAuthenticated: true, resetStore: true, forceSessionsFailure: true)
        app.launch()

        waitForRoot("home", in: app, failureMessage: "Home screen did not appear")
        openTab(identifier: "tab.progress", in: app)

        let errorLabel = app.staticTexts["history.errorMessage"]
        XCTAssertTrue(errorLabel.waitForExistence(timeout: 8))
        XCTAssertTrue(errorLabel.label.localizedCaseInsensitiveContains("failed")
                        || errorLabel.label.localizedCaseInsensitiveContains("connection"))
    }

    private func makeApp(
        seedAuthenticated: Bool,
        resetStore: Bool,
        sessionSeconds: Int = 10,
        timerMultiplier: Double = 1.0,
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

    private func openTab(identifier: String, in app: XCUIApplication) {
        let tabButton = app.tabBars.buttons[identifier]
        if tabButton.waitForExistence(timeout: 10) {
            tabButton.tap()
            return
        }
        let fallbackButton = app.buttons[identifier]
        XCTAssertTrue(fallbackButton.waitForExistence(timeout: 5), "Expected tab button \(identifier) to exist")
        fallbackButton.tap()
    }

    private func pressAndHold(element: XCUIElement, duration: TimeInterval) {
        let start = element.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
        start.press(forDuration: duration)
    }

    private func tap(_ element: XCUIElement, thenWaitForRoot slug: String, in app: XCUIApplication) {
        let root = app.otherElements["root.currentView.\(slug)"]
        for attempt in 1...3 {
            let center = element.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
            center.tap()
            if root.waitForExistence(timeout: 12) {
                return
            }
            XCTAssertTrue(attempt < 3, "Expected tap to transition to root.currentView.\(slug)")
        }
    }

    @discardableResult
    private func waitForRoot(_ slug: String, in app: XCUIApplication, failureMessage: String) -> XCUIElement {
        let root = app.otherElements["root.currentView.\(slug)"]
        XCTAssertTrue(root.waitForExistence(timeout: launchTimeout), failureMessage)
        assertColdStartBound(root: root, maxMs: coldStartMaxMs)
        return root
    }

    private func assertColdStartBound(root: XCUIElement, maxMs: Int) {
        let deadline = Date().addingTimeInterval(min(45, launchTimeout))
        var observedValue = ""
        while Date() < deadline {
            observedValue = (root.value as? String) ?? ""
            if let ms = parseMetricMs(from: observedValue) {
                XCTAssertLessThanOrEqual(ms, maxMs, "Cold start auth check exceeded documented bound")
                return
            }
            RunLoop.current.run(until: Date().addingTimeInterval(0.1))
        }
        XCTFail("Missing cold-start metric in root accessibility value: \(observedValue)")
    }

    private func parseMetricMs(from value: String) -> Int? {
        let prefix = "coldStartAuthCheckMs="
        guard let range = value.range(of: prefix) else { return nil }
        let msRaw = value[range.upperBound...]
        return Int(msRaw)
    }
}
