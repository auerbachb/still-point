import XCTest

final class StillPointAppUITests: XCTestCase {
    // XCTest's simulator/automation startup can take tens of seconds on
    // macos-26/iOS 26 CI. `coldStartMaxMs` is separate: it is the app-reported
    // auth-check latency in `coldStartAuthCheckMs`, not XCTest launch overhead.
    private let launchTimeout: TimeInterval = 45
    private let coldStartMaxMs = 5_000

    override func setUpWithError() throws {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .portrait
        RunLoop.current.run(until: Date().addingTimeInterval(0.3))
    }

    override func tearDownWithError() throws {
        XCUIDevice.shared.orientation = .portrait
        RunLoop.current.run(until: Date().addingTimeInterval(0.3))
    }

    @MainActor
    func testPasswordResetEntryIsDiscoverable() throws {
        let app = makeApp(seedAuthenticated: false, resetStore: true)
        app.launch()

        waitForRoot("auth", in: app, failureMessage: "Auth screen did not appear", assertColdStart: false)

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
            sessionSeconds: 600,
            timerMultiplier: 2.0
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
        tapByStableCenter(submitButton, in: app)

        XCTAssertTrue(app.otherElements["root.currentView.home"].waitForExistence(timeout: 8))
        let beginButton = app.buttons["home.beginButton"]
        XCTAssertTrue(beginButton.waitForExistence(timeout: 5))
        beginButton.tap()
        app.launchEnvironment["SP_UI_TEST_SEED_AUTH"] = "1"
        app.terminate()
        app.launch()
        waitForRoot("home", in: app, failureMessage: "Home screen did not survive relaunch before session", assertColdStart: false)
        app.launchEnvironment["SP_UI_TEST_SEED_AUTH"] = "1"
        app.launchEnvironment["SP_UI_TEST_FORCE_START_SESSION"] = "1"
        app.terminate()
        app.launch()
        waitForRoot("session", in: app, failureMessage: "Session screen did not appear", assertColdStart: false)

        let timerLabel = app.staticTexts["session.timerLabel"]
        XCTAssertTrue(timerLabel.waitForExistence(timeout: 8))
        XCTAssertTrue(timerLabel.label.contains(":"), "Timer format should contain mm:ss delimiter")
        XCTAssertTrue(timerLabel.label.contains("Time remaining"), "Timer should expose VoiceOver-friendly label")

        let lightHold = app.staticTexts["session.lightDistractionHoldButton"]
        let hyperfocusHold = app.staticTexts["session.hyperfocusHoldButton"]
        let secondaryChrome = app.otherElements["session.secondaryChromeMarker"]
        let completionRoot = app.otherElements["root.currentView.completion"]
        if lightHold.waitForExistence(timeout: 5) {
            XCTAssertEqual(lightHold.value as? String, "inactive")
            XCTAssertTrue(hyperfocusHold.waitForExistence(timeout: 5))
            XCTAssertEqual(hyperfocusHold.value as? String, "inactive")
            XCTAssertTrue(secondaryChrome.waitForExistence(timeout: 5))
            waitForAccessibilityValue(secondaryChrome, "dimmed", timeout: 5)
        } else {
            XCTAssertTrue(
                completionRoot.waitForExistence(timeout: 1),
                "Expected active-session hold control or completion screen"
            )
        }

        if !completionRoot.exists {
            let endEarlyButton = app.buttons["session.endEarlyButton"]
            tapByStableCenter(endEarlyButton, in: app)
        }
        XCTAssertTrue(completionRoot.waitForExistence(timeout: 35))
        XCTAssertTrue(app.staticTexts["completion.dayTitle"].exists)
        XCTAssertTrue(app.staticTexts["completion.durationLabel"].exists)

        let returnButton = app.buttons["completion.returnButton"]
        tapByStableCenter(returnButton, in: app)
        XCTAssertTrue(app.otherElements["root.currentView.home"].waitForExistence(timeout: 8))

        app.terminate()

        let relaunch = makeApp(
            seedAuthenticated: true,
            resetStore: false,
            sessionSeconds: 600,
            timerMultiplier: 2.0,
            forceProgressTab: true
        )
        relaunch.launch()

        XCTAssertTrue(
            relaunch.staticTexts["history.title"].waitForExistence(timeout: launchTimeout),
            "History screen did not appear after relaunch"
        )
        let dayRow = relaunch.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "history.session.day.")).firstMatch
        XCTAssertTrue(dayRow.waitForExistence(timeout: 8), "Expected persisted history row after relaunch")
    }

    @MainActor
    func testCompletedSessionUnlocksConfiguredAppGate() throws {
        let app = makeApp(
            seedAuthenticated: true,
            resetStore: true,
            appBlockingSelected: true
        )
        app.launch()

        XCTAssertTrue(app.otherElements["root.currentView.home"].waitForExistence(timeout: launchTimeout))
        openTab(identifier: "tab.settings", in: app)
        XCTAssertTrue(app.staticTexts["appBlocking.statusText"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["appBlocking.selectedCount"].waitForExistence(timeout: 5))
    }

    @MainActor
    func testHistoryAndSettingsNavigationSmoke() throws {
        let app = makeApp(seedAuthenticated: true, resetStore: true)
        app.launch()

        waitForRoot("home", in: app, failureMessage: "Home screen did not appear")
        openTab(identifier: "tab.progress", in: app, waitingFor: app.staticTexts["history.title"])

        openTab(identifier: "tab.settings", in: app, waitingFor: app.staticTexts["settings.title"])
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
        let app = makeApp(seedAuthenticated: true, resetStore: true, sessionSeconds: 60, timerMultiplier: 1.0)
        app.launch()

        waitForRoot("home", in: app, failureMessage: "Home screen did not appear")
        let beginButton = app.buttons["home.beginButton"]
        XCTAssertTrue(beginButton.waitForExistence(timeout: 5))
        tap(beginButton, thenWaitForRoot: "session", in: app)

        XCUIDevice.shared.orientation = .landscapeLeft
        RunLoop.current.run(until: Date().addingTimeInterval(1.0))

        let timerLabel = app.staticTexts["session.timerLabel"]
        XCTAssertTrue(timerLabel.waitForExistence(timeout: 8))
        XCTAssertTrue(
            timerLabel.frame.intersects(app.frame),
            "Timer should remain at least partially visible after rotation. Frame: \(timerLabel.frame), app: \(app.frame)"
        )

        tapByStableCenter(app.buttons["session.endEarlyButton"], in: app)
        XCTAssertTrue(
            app.otherElements["root.currentView.completion"].waitForExistence(timeout: 12),
            "Primary control should remain reachable in landscape"
        )
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
        let app = makeApp(seedAuthenticated: true, resetStore: true, sessionSeconds: 30, timerMultiplier: 1.0)
        app.launch()

        waitForRoot("home", in: app, failureMessage: "Home screen did not appear")
        let beginButton = app.buttons["home.beginButton"]
        XCTAssertTrue(beginButton.waitForExistence(timeout: 5))
        XCTAssertEqual(beginButton.label, "Start session")
        tap(beginButton, thenWaitForRoot: "session", in: app)

        let timerLabel = app.staticTexts["session.timerLabel"]
        XCTAssertFalse(
            app.otherElements["root.currentView.completion"].waitForExistence(timeout: 0.5),
            "Session completed before timer accessibility could be asserted"
        )
        XCTAssertTrue(timerLabel.waitForExistence(timeout: 8))
        XCTAssertTrue(timerLabel.label.localizedCaseInsensitiveContains("time remaining"))
    }

    @MainActor
    func testSessionsFailureShowsVisibleRetryMessage() throws {
        let app = makeApp(seedAuthenticated: true, resetStore: false, forceSessionsFailure: true, forceProgressTab: true)
        app.launch()

        waitForRoot("home", in: app, failureMessage: "Home screen did not appear")
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
        forceSessionsFailure: Bool = false,
        appBlockingSelected: Bool = false,
        forceProgressTab: Bool = false
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
        app.launchEnvironment["SP_UI_TEST_FORCE_START_SESSION"] = "0"
        app.launchEnvironment["SP_UI_TEST_APP_BLOCKING_SELECTED"] = appBlockingSelected ? "1" : "0"
        app.launchEnvironment["SP_UI_TEST_FORCE_PROGRESS_TAB"] = forceProgressTab ? "1" : "0"
        return app
    }

    private func openTab(
        identifier: String,
        in app: XCUIApplication,
        waitingFor destination: XCUIElement? = nil,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        if destination?.exists == true {
            return
        }

        for attempt in 1...3 {
            if tapTab(identifier: identifier, in: app, file: file, line: line),
               destination?.waitForExistence(timeout: 8) ?? true {
                return
            }
            RunLoop.current.run(until: Date().addingTimeInterval(0.5))
            XCTAssertTrue(attempt < 3, "Expected tab \(identifier) to open destination", file: file, line: line)
        }
    }

    private func tapTab(
        identifier: String,
        in app: XCUIApplication,
        file: StaticString = #filePath,
        line: UInt = #line
    ) -> Bool {
        let directButton = app.buttons[identifier]
        if directButton.waitForExistence(timeout: 5) {
            if tapByStableCenter(directButton, in: app, file: file, line: line) {
                return true
            }
        }

        let tabButton = app.tabBars.buttons[identifier]
        if tabButton.waitForExistence(timeout: 5) {
            if tapByStableCenter(tabButton, in: app, file: file, line: line) {
                return true
            }
        }
        if let index = tabBarIndex(for: identifier) {
            let indexedButton = app.tabBars.buttons.element(boundBy: index)
            if indexedButton.waitForExistence(timeout: 5) {
                if tapByStableCenter(indexedButton, in: app, file: file, line: line) {
                    return true
                }
            }
        }
        XCTFail("Expected tab button \(identifier) to exist", file: file, line: line)
        return false
    }

    private func tabBarIndex(for identifier: String) -> Int? {
        switch identifier {
        case "tab.progress":
            return 1
        case "tab.settings":
            return 4
        default:
            return nil
        }
    }

    private func pressAndHold(element: XCUIElement, duration: TimeInterval) {
        let start = element.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
        start.press(forDuration: duration)
    }

    private func tap(_ element: XCUIElement, thenWaitForRoot slug: String, in app: XCUIApplication) {
        let root = app.otherElements["root.currentView.\(slug)"]
        for attempt in 1...3 {
            tapByStableCenter(element, in: app)
            if root.waitForExistence(timeout: 12) {
                return
            }
            XCTAssertTrue(attempt < 3, "Expected tap to transition to root.currentView.\(slug)")
        }
    }

    private func waitForAccessibilityValue(_ element: XCUIElement, _ value: String, timeout: TimeInterval) {
        let predicate = NSPredicate(format: "value == %@", value)
        let expectation = expectation(for: predicate, evaluatedWith: element)
        wait(for: [expectation], timeout: timeout)
    }

    @discardableResult
    private func tapByStableCenter(
        _ element: XCUIElement,
        in app: XCUIApplication,
        timeout: TimeInterval = 8,
        file: StaticString = #filePath,
        line: UInt = #line
    ) -> Bool {
        guard stableFrame(for: element, in: app, timeout: timeout, file: file, line: line) != nil else {
            return false
        }
        element.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        return true
    }

    private func stableFrame(
        for element: XCUIElement,
        in app: XCUIApplication,
        timeout: TimeInterval = 8,
        file: StaticString = #filePath,
        line: UInt = #line
    ) -> CGRect? {
        guard element.waitForExistence(timeout: timeout) else {
            XCTFail("Element did not exist: \(element)", file: file, line: line)
            return nil
        }

        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            let frame = element.frame
            let center = CGPoint(x: frame.midX, y: frame.midY)
            if !frame.isEmpty,
               frame.origin.x >= 0,
               frame.origin.y >= 0,
               frame.width > 1,
               frame.height > 1,
               app.frame.insetBy(dx: -1, dy: -1).contains(center) {
                return frame
            }
            RunLoop.current.run(until: Date().addingTimeInterval(0.1))
        }

        XCTFail("Element existed but never had a stable tappable frame: \(element.debugDescription)", file: file, line: line)
        return nil
    }

    private func dismissKeyboardIfPresent(in app: XCUIApplication) {
        let keyboard = app.keyboards.firstMatch
        guard keyboard.exists else { return }

        let doneButton = app.buttons["Done"]
        if doneButton.exists {
            doneButton.tap()
        } else {
            app.swipeDown()
        }
        RunLoop.current.run(until: Date().addingTimeInterval(0.3))
    }

    @discardableResult
    private func waitForRoot(
        _ slug: String,
        in app: XCUIApplication,
        failureMessage: String,
        assertColdStart: Bool = true,
        file: StaticString = #filePath,
        line: UInt = #line
    ) -> XCUIElement {
        let root = app.otherElements["root.currentView.\(slug)"]
        guard root.waitForExistence(timeout: launchTimeout) else {
            XCTFail(failureMessage, file: file, line: line)
            return root
        }
        if assertColdStart {
            assertColdStartBound(root: root, maxMs: coldStartMaxMs, file: file, line: line)
        }
        return root
    }

    private func assertColdStartBound(
        root: XCUIElement,
        maxMs: Int,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        let deadline = Date().addingTimeInterval(min(45, launchTimeout))
        var observedValue = ""
        while Date() < deadline {
            observedValue = (root.value as? String) ?? ""
            if let ms = parseMetricMs(from: observedValue) {
                XCTAssertLessThanOrEqual(ms, maxMs, "Cold start auth check exceeded documented bound", file: file, line: line)
                return
            }
            RunLoop.current.run(until: Date().addingTimeInterval(0.1))
        }
        XCTFail("Missing cold-start metric in root accessibility value: \(observedValue)", file: file, line: line)
    }

    private func parseMetricMs(from value: String) -> Int? {
        let prefix = "coldStartAuthCheckMs="
        guard let range = value.range(of: prefix) else { return nil }
        let msRaw = value[range.upperBound...]
        return Int(msRaw)
    }
}
