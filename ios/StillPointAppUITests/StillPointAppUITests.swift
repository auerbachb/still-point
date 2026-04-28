import XCTest

final class StillPointAppUITests: XCTestCase {
    // 30s is generous for cold simulator boots on macos-26 CI runners — the
    // previous 15s tripped intermittently on the first launch in a test run.
    // Issue #266.
    private let launchTimeout: TimeInterval = 30

    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    @MainActor
    func testPasswordResetEntryIsDiscoverable() throws {
        let app = makeApp(seedAuthenticated: false, resetStore: true)
        app.launch()

        let authRoot = rootElement("auth", in: app)
        XCTAssertTrue(authRoot.waitForExistence(timeout: launchTimeout), "Auth screen did not appear")

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
            sessionSeconds: 6,
            timerMultiplier: 3.0
        )
        app.launch()

        let authRoot = rootElement("auth", in: app)
        XCTAssertTrue(authRoot.waitForExistence(timeout: launchTimeout), "Auth screen did not appear")
        assertColdStartBound(root: authRoot, maxMs: 5_000)

        let emailField = app.textFields["auth.emailField"]
        XCTAssertTrue(emailField.waitForExistence(timeout: 5))
        emailField.tap()
        emailField.typeText("ios.fixture@stillpoint.test")

        let passwordField = app.secureTextFields["auth.passwordField"]
        XCTAssertTrue(passwordField.waitForExistence(timeout: 5))
        passwordField.tap()
        passwordField.typeText("stillpoint-pass")

        let submitButton = app.buttons["auth.submitButton"]
        tapWhenHittable(submitButton, timeout: 5)

        XCTAssertTrue(rootElement("home", in: app).waitForExistence(timeout: 8))
        let beginButton = app.buttons["home.beginButton"]
        tapWhenHittable(beginButton, timeout: 5)

        XCTAssertTrue(rootElement("session", in: app).waitForExistence(timeout: 8))
        XCTAssertTrue(rootElement("completion", in: app).waitForExistence(timeout: 12))
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
        tapWhenHittable(returnButton, timeout: 5)
        XCTAssertTrue(rootElement("home", in: app).waitForExistence(timeout: 8))

        app.terminate()

        let relaunch = makeApp(
            seedAuthenticated: true,
            resetStore: false,
            sessionSeconds: 6,
            timerMultiplier: 3.0
        )
        relaunch.launch()

        XCTAssertTrue(rootElement("home", in: relaunch).waitForExistence(timeout: launchTimeout))
        assertColdStartBound(root: rootElement("home", in: relaunch), maxMs: 5_000)

        openTab(identifier: "tab.progress", in: relaunch)
        XCTAssertTrue(relaunch.staticTexts["history.title"].waitForExistence(timeout: 8))
        let dayRow = relaunch.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "history.session.day.")).firstMatch
        XCTAssertTrue(dayRow.waitForExistence(timeout: 8), "Expected persisted history row after relaunch")
    }

    @MainActor
    func testHistoryAndSettingsNavigationSmoke() throws {
        let app = makeApp(seedAuthenticated: true, resetStore: true)
        app.launch()

        XCTAssertTrue(rootElement("home", in: app).waitForExistence(timeout: launchTimeout))
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

        XCTAssertTrue(rootElement("auth", in: app).waitForExistence(timeout: launchTimeout))
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

        XCTAssertTrue(rootElement("auth", in: app).waitForExistence(timeout: launchTimeout))
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

        XCTAssertTrue(rootElement("auth", in: app).waitForExistence(timeout: launchTimeout))
        let message = app.staticTexts["authView.launchAuthStatusMessage"]
        XCTAssertTrue(message.waitForExistence(timeout: 5))
        XCTAssertTrue(message.label.localizedCaseInsensitiveContains("expired")
                        || message.label.localizedCaseInsensitiveContains("log in"))
    }

    @MainActor
    func testRotationDecisionSessionRemainsUsableInLandscape() throws {
        let app = makeApp(seedAuthenticated: true, resetStore: true, sessionSeconds: 8, timerMultiplier: 2.0)
        app.launch()

        XCTAssertTrue(rootElement("home", in: app).waitForExistence(timeout: launchTimeout))
        tapWhenHittable(app.buttons["home.beginButton"], timeout: 5)
        XCTAssertTrue(rootElement("session", in: app).waitForExistence(timeout: 8))

        XCUIDevice.shared.orientation = .landscapeLeft
        defer { XCUIDevice.shared.orientation = .portrait }

        let lightHold = app.descendants(matching: .any)["session.lightDistractionHoldButton"]
        XCTAssertTrue(lightHold.waitForExistence(timeout: 3))
        XCTAssertTrue(lightHold.isHittable, "Distraction control should remain reachable after rotation")
        XCTAssertTrue(app.buttons["session.endEarlyButton"].isHittable, "Primary control should remain reachable in landscape")
    }

    @MainActor
    func testPrimaryControlsVisibleAboveHomeIndicator() throws {
        let app = makeApp(seedAuthenticated: true, resetStore: true)
        app.launch()

        XCTAssertTrue(rootElement("home", in: app).waitForExistence(timeout: launchTimeout))
        let beginButton = app.buttons["home.beginButton"]
        XCTAssertTrue(beginButton.waitForExistence(timeout: 5))
        XCTAssertTrue(beginButton.isHittable, "Home primary action should be visible above safe-area/home indicator")
    }

    @MainActor
    func testVoiceOverLabelsForTimerAndPrimaryButton() throws {
        let app = makeApp(seedAuthenticated: true, resetStore: true, sessionSeconds: 8, timerMultiplier: 2.0)
        app.launch()

        XCTAssertTrue(rootElement("home", in: app).waitForExistence(timeout: launchTimeout))
        let beginButton = app.buttons["home.beginButton"]
        XCTAssertTrue(beginButton.waitForExistence(timeout: 5))
        XCTAssertEqual(beginButton.label, "Start session")
        tapWhenHittable(beginButton, timeout: 5)

        XCTAssertTrue(rootElement("session", in: app).waitForExistence(timeout: 8))
        let lightHold = app.descendants(matching: .any)["session.lightDistractionHoldButton"]
        XCTAssertTrue(lightHold.waitForExistence(timeout: 3))
        XCTAssertTrue(lightHold.label.localizedCaseInsensitiveContains("light distraction"))
    }

    @MainActor
    func testSessionsFailureShowsVisibleRetryMessage() throws {
        let app = makeApp(seedAuthenticated: true, resetStore: true, forceSessionsFailure: true)
        app.launch()

        XCTAssertTrue(rootElement("home", in: app).waitForExistence(timeout: launchTimeout))
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
        tapWhenHittable(tabButton, timeout: 5)
    }

    private func rootElement(_ slug: String, in app: XCUIApplication) -> XCUIElement {
        app.descendants(matching: .any)["root.currentView.\(slug)"]
    }

    private func tapWhenHittable(_ element: XCUIElement, timeout: TimeInterval) {
        XCTAssertTrue(element.waitForExistence(timeout: timeout))
        let hittable = NSPredicate(format: "hittable == true")
        expectation(for: hittable, evaluatedWith: element)
        waitForExpectations(timeout: timeout)
        element.tap()
    }

    private func pressAndHold(element: XCUIElement, duration: TimeInterval, onHold: @escaping () -> Void) {
        let start = element.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
        let end = start.withOffset(CGVector(dx: 0, dy: 0))
        let holdFinished = expectation(description: "Hold gesture finished")
        DispatchQueue.global(qos: .userInitiated).async {
            start.press(forDuration: duration, thenDragTo: end)
            holdFinished.fulfill()
        }

        let holdBecameActive = NSPredicate(format: "value == %@", "active")
        let activeExpectation = expectation(for: holdBecameActive, evaluatedWith: element)
        wait(for: [activeExpectation], timeout: duration)
        onHold()
        wait(for: [holdFinished], timeout: duration + 2)
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
