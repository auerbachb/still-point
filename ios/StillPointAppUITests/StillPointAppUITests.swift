import XCTest

final class StillPointAppUITests: XCTestCase {
    // macos-26 runners can spend 30s+ setting up the automation session before
    // the first root view is queryable.
    private let launchTimeout: TimeInterval = 60

    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    override func tearDownWithError() throws {
        XCUIApplication().terminate()
        try super.tearDownWithError()
    }

    @MainActor
    func testPasswordResetEntryIsDiscoverable() throws {
        let app = makeApp(seedAuthenticated: false, resetStore: true)
        app.launch()

        waitForAuthScreen(in: app)

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
            sessionSeconds: 90,
            timerMultiplier: 3.0
        )
        app.launch()

        waitForAuthScreen(in: app)
        assertColdStartBoundIfAvailable(root: app.otherElements["root.currentView.auth"], maxMs: 5_000)

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
        beginSession(in: app)
        let timerLabel = app.staticTexts["session.timerLabel"]
        XCTAssertTrue(timerLabel.waitForExistence(timeout: 3))
        XCTAssertTrue(timerLabel.label.contains(":"), "Timer format should contain mm:ss delimiter")
        XCTAssertTrue(timerLabel.label.contains("Time remaining"), "Timer should expose VoiceOver-friendly label")

        let lightHold = app.staticTexts["session.lightDistractionHoldButton"]
        XCTAssertTrue(lightHold.waitForExistence(timeout: launchTimeout))
        XCTAssertEqual(lightHold.value as? String, "inactive")

        let hyperfocusHold = app.staticTexts["session.hyperfocusHoldButton"]
        XCTAssertTrue(hyperfocusHold.waitForExistence(timeout: launchTimeout))
        let dimmedChrome = app.otherElements["session.secondaryChromeMarker"]
        XCTAssertTrue(dimmedChrome.waitForExistence(timeout: launchTimeout), "Secondary controls should expose dim state")
        waitForAccessibilityValue(dimmedChrome, "dimmed", timeout: launchTimeout)
        XCTAssertTrue(app.buttons["session.pauseResumeButton"].exists, "Dimmed controls should remain rendered")

        assertHoldControlResponds(
            lightHold,
            activeMessage: "Hold should enter active state while gesture is in progress",
            releaseMessage: "Release should end hold state and avoid stuck distraction"
        )
        assertHoldControlResponds(
            hyperfocusHold,
            activeMessage: "Hyperfocus should enter active state while gesture is in progress",
            releaseMessage: "Release should end hyperfocus hold state"
        )

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
            sessionSeconds: 6,
            timerMultiplier: 3.0
        )
        relaunch.launch()

        XCTAssertTrue(relaunch.otherElements["root.currentView.home"].waitForExistence(timeout: launchTimeout))
        assertColdStartBound(root: relaunch.otherElements["root.currentView.home"], maxMs: 5_000)

        openTab(identifier: "tab.progress", in: relaunch)
        XCTAssertTrue(relaunch.staticTexts["history.title"].waitForExistence(timeout: 8))
        let dayRow = relaunch.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "history.session.day.")).firstMatch
        XCTAssertTrue(dayRow.waitForExistence(timeout: 8), "Expected persisted history row after relaunch")
    }

    @MainActor
    func testHistoryAndSettingsNavigationSmoke() throws {
        let app = makeApp(seedAuthenticated: true, resetStore: true)
        app.launch()

        XCTAssertTrue(app.otherElements["root.currentView.home"].waitForExistence(timeout: launchTimeout))
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

        waitForAuthScreen(in: app)
        let emailField = app.textFields["auth.emailField"]
        let passwordField = app.secureTextFields["auth.passwordField"]
        let submitButton = app.buttons["auth.submitButton"]

        XCTAssertTrue(emailField.waitForExistence(timeout: 5))
        XCTAssertTrue(passwordField.waitForExistence(timeout: 5))
        XCTAssertTrue(submitButton.waitForExistence(timeout: 5))

        focusAndType("ios.fixture@stillpoint.test", into: emailField, in: app)
        focusAndType("stillpoint-pass", into: passwordField, in: app)
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

        waitForAuthScreen(in: app)
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

        waitForAuthScreen(in: app)
        let message = app.staticTexts["authView.launchAuthStatusMessage"]
        XCTAssertTrue(message.waitForExistence(timeout: 5))
        XCTAssertTrue(message.label.localizedCaseInsensitiveContains("expired")
                        || message.label.localizedCaseInsensitiveContains("log in"))
    }

    @MainActor
    func testRotationDecisionSessionRemainsUsableInLandscape() throws {
        let app = makeApp(seedAuthenticated: true, resetStore: true, sessionSeconds: 8, timerMultiplier: 2.0)
        app.launch()

        XCTAssertTrue(app.otherElements["root.currentView.home"].waitForExistence(timeout: launchTimeout))
        beginSession(in: app)

        XCUIDevice.shared.orientation = .landscapeLeft
        defer { XCUIDevice.shared.orientation = .portrait }

        let timerLabel = app.staticTexts["session.timerLabel"]
        XCTAssertTrue(timerLabel.waitForExistence(timeout: 3))
        XCTAssertTrue(timerLabel.exists, "Timer should remain visible after rotation")
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
        let app = makeApp(seedAuthenticated: true, resetStore: true, sessionSeconds: 8, timerMultiplier: 2.0)
        app.launch()

        XCTAssertTrue(app.otherElements["root.currentView.home"].waitForExistence(timeout: launchTimeout))
        let beginButton = app.buttons["home.beginButton"]
        XCTAssertTrue(beginButton.waitForExistence(timeout: 5))
        XCTAssertEqual(beginButton.label, "Start session")
        beginSession(in: app)
        let timerLabel = app.staticTexts["session.timerLabel"]
        XCTAssertTrue(timerLabel.waitForExistence(timeout: 3))
        XCTAssertTrue(timerLabel.label.localizedCaseInsensitiveContains("time remaining"))
    }

    @MainActor
    func testSessionsFailureShowsVisibleRetryMessage() throws {
        let app = makeApp(seedAuthenticated: true, resetStore: true, forceSessionsFailure: true)
        app.launch()

        XCTAssertTrue(app.otherElements["root.currentView.home"].waitForExistence(timeout: launchTimeout))
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
        XCTAssertTrue(tabButton.waitForExistence(timeout: 5))
        tabButton.tap()
    }

    private func tap(_ element: XCUIElement, untilExists destination: XCUIElement, timeout: TimeInterval) {
        let deadline = Date().addingTimeInterval(timeout)
        repeat {
            XCTAssertTrue(element.waitForExistence(timeout: 5))
            element.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
            if destination.waitForExistence(timeout: 2) {
                return
            }
            RunLoop.current.run(until: Date().addingTimeInterval(0.1))
        } while Date() < deadline

        XCTFail("Expected \(destination.identifier) after tapping \(element.identifier)")
    }

    private func pressAndHold(element: XCUIElement, duration: TimeInterval, onHold: @escaping () -> Void) {
        let start = element.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
        start.press(forDuration: duration)
        onHold()
    }

    private func assertHoldControlResponds(_ element: XCUIElement, activeMessage: String, releaseMessage: String) {
        pressAndHold(element: element, duration: 1.0) {
            XCTAssertEqual(element.value as? String, "active", activeMessage)
        }
        XCTAssertEqual(element.value as? String, "inactive", releaseMessage)
    }

    private func waitForAuthScreen(in app: XCUIApplication) {
        XCTAssertTrue(
            app.textFields["auth.emailField"].waitForExistence(timeout: launchTimeout),
            "Auth email field did not appear"
        )
    }

    private func beginSession(in app: XCUIApplication) {
        let beginButton = app.buttons["home.beginButton"]
        XCTAssertTrue(beginButton.waitForExistence(timeout: 5))
        XCTAssertTrue(beginButton.isHittable)

        let sessionRoot = app.otherElements["root.currentView.session"]
        let deadline = Date().addingTimeInterval(20)
        repeat {
            beginButton.tap()
            if sessionRoot.waitForExistence(timeout: 2) {
                return
            }
            RunLoop.current.run(until: Date().addingTimeInterval(0.2))
        } while Date() < deadline

        XCTFail("Session screen did not appear after tapping Begin")
    }

    private func waitForAccessibilityValue(_ element: XCUIElement, _ value: String, timeout: TimeInterval) {
        let predicate = NSPredicate(format: "value == %@", value)
        let expectation = expectation(for: predicate, evaluatedWith: element)
        wait(for: [expectation], timeout: timeout)
    }

    private func focusAndType(_ text: String, into element: XCUIElement, in app: XCUIApplication) {
        XCTAssertTrue(element.waitForExistence(timeout: 5))
        let deadline = Date().addingTimeInterval(5)
        repeat {
            element.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
            if app.keyboards.firstMatch.waitForExistence(timeout: 1) {
                app.typeText(text)
                return
            }
            RunLoop.current.run(until: Date().addingTimeInterval(0.1))
        } while Date() < deadline

        XCTFail("Keyboard did not appear for \(element.identifier)")
    }

    private func assertColdStartBoundIfAvailable(root: XCUIElement, maxMs: Int) {
        guard root.waitForExistence(timeout: 1) else {
            XCTFail("Auth root did not appear; cold-start metric could not be asserted")
            return
        }
        assertColdStartBound(root: root, maxMs: maxMs)
    }

    private func assertColdStartBound(root: XCUIElement, maxMs: Int) {
        let deadline = Date().addingTimeInterval(5)
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
