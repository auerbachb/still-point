import XCTest

/// Screen, navigation, tap, and scroll helpers for `StillPointAppUITests` (#1050).
///
/// Scoped to `StillPointAppUITests` rather than `XCTestCase` because
/// `SnapshotTests` keeps its own private helpers under some of the same names
/// (`terminateAppReliably`, `scrollElementIntoVisibleFrame`, ...), and an
/// `XCTestCase` extension member would clash with them.
extension StillPointAppUITests {
    // MARK: - Fixture account

    /// The account `UITestAPIStore` accepts at the Log In form.
    static let fixtureEmail = "ios.fixture@stillpoint.test"
    static let fixturePassword = "stillpoint-pass"

    /// Types the fixture account into the Log In form's email and password fields.
    /// Leaves the keyboard up and does not submit.
    func fillFixtureLogin(in app: XCUIApplication, file: StaticString = #filePath, line: UInt = #line) {
        let emailField = app.textFields["auth.emailField"]
        XCTAssertTrue(emailField.waitForExistence(timeout: 5), file: file, line: line)
        emailField.tapAndType(Self.fixtureEmail, in: app, file: file, line: line)

        let passwordField = app.secureTextFields["auth.passwordField"]
        XCTAssertTrue(passwordField.waitForExistence(timeout: 5), file: file, line: line)
        passwordField.tapAndType(Self.fixturePassword, in: app, file: file, line: line)
    }

    // MARK: - Settings

    /// Opens the Settings tab and waits for its title.
    func openSettings(in app: XCUIApplication, file: StaticString = #filePath, line: UInt = #line) {
        openTab(identifier: "tab.settings", in: app, waitingFor: app.staticTexts["settings.title"], file: file, line: line)
    }

    /// Opens the inline username editor on Settings, replaces the field's text
    /// with `username`, and taps Save. Callers assert the outcome.
    func submitSettingsUsername(_ username: String, in app: XCUIApplication, file: StaticString = #filePath, line: UInt = #line) {
        let editButton = app.buttons["settings.usernameEditButton"]
        XCTAssertTrue(editButton.waitForExistence(timeout: 5), file: file, line: line)
        tapByStableCenter(editButton, in: app, file: file, line: line)

        let field = app.textFields["settings.usernameField"]
        XCTAssertTrue(field.waitForExistence(timeout: 5), file: file, line: line)
        clearUsernameFieldForUITest(field, in: app)
        field.typeText(username)

        let saveButton = app.buttons["settings.usernameSaveButton"]
        XCTAssertTrue(saveButton.waitForExistence(timeout: 5), file: file, line: line)
        tapByStableCenter(saveButton, in: app, file: file, line: line)
    }

    // MARK: - Launch and completion

    /// Status text during launch may be attached to `AuthView` or the transient
    /// loading overlay in `RootView` (same copy, different accessibility ids).
    func launchAuthStatusStaticText(in app: XCUIApplication) -> XCUIElement {
        app.staticTexts.matching(
            NSPredicate(
                format: "identifier == %@ OR identifier == %@",
                "authView.launchAuthStatusMessage",
                "root.authStatusMessage"
            )
        ).firstMatch
    }

    /// Launches straight into a short standard sit and ends it, returning the app on
    /// the completion screen.
    @MainActor
    func finishSitToCompletion(
        forceCreateSessionFailure: Bool,
        file: StaticString = #filePath,
        line: UInt = #line
    ) -> XCUIApplication {
        let app = makeApp(
            seedAuthenticated: true,
            resetStore: true,
            sessionSeconds: 10,
            timerMultiplier: 2.0,
            forceCreateSessionFailure: forceCreateSessionFailure,
            forceStartSession: true
        )
        app.launch()

        waitForRoot("session", in: app, failureMessage: "Session screen did not appear", assertColdStart: false)
        let completionRoot = app.otherElements["root.currentView.completion"]
        if !completionRoot.waitForExistence(timeout: 3) {
            let endEarlyButton = app.buttons["session.endEarlyButton"]
            if endEarlyButton.waitForExistence(timeout: 8) {
                tapByStableCenter(endEarlyButton, in: app)
            }
        }
        XCTAssertTrue(completionRoot.waitForExistence(timeout: 35), "Completion screen did not appear", file: file, line: line)
        XCTAssertTrue(app.staticTexts["completion.dayTitle"].waitForExistence(timeout: 8), file: file, line: line)
        return app
    }

    /// Mood matrix cells on the completion screen (`completion.moodMatrix.<mood>.<side>.<level>`).
    func moodRatingCells(in app: XCUIApplication) -> XCUIElementQuery {
        app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "completion.moodMatrix."))
    }

    /// Retries termination since XCTest occasionally reports "Failed to terminate … :0" on loaded CI simulators.
    func terminateAppReliably(_ app: XCUIApplication, attempts: Int = 6) {
        if app.state == .notRunning { return }

        for _ in 1...attempts {
            RunLoop.current.run(until: Date().addingTimeInterval(0.5))
            if app.state == .notRunning { return }

            _ = app.terminate()

            let deadline = Date().addingTimeInterval(20)
            while Date() < deadline {
                if app.state == .notRunning { return }
                RunLoop.current.run(until: Date().addingTimeInterval(0.25))
            }

            XCUIDevice.shared.press(.home)
            RunLoop.current.run(until: Date().addingTimeInterval(0.5))
            if app.state == .notRunning { return }
        }
        XCTFail("App did not reach notRunning after \(attempts) terminate attempts")
    }

    // MARK: - Navigation

    func openTab(
        identifier: String,
        in app: XCUIApplication,
        waitingFor destination: XCUIElement? = nil,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        for attempt in 1...3 {
            if tapTab(identifier: identifier, in: app, shouldFailOnMissing: attempt == 3, file: file, line: line),
               destination?.waitForExistence(timeout: 8) ?? true {
                return
            }
            RunLoop.current.run(until: Date().addingTimeInterval(0.5))
            XCTAssertTrue(attempt < 3, "Expected tab \(identifier) to open destination", file: file, line: line)
        }
    }

    func tapTab(
        identifier: String,
        in app: XCUIApplication,
        shouldFailOnMissing: Bool = true,
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
        if shouldFailOnMissing {
            XCTFail("Expected tab button \(identifier) to exist", file: file, line: line)
        }
        return false
    }

    func tabBarIndex(for identifier: String) -> Int? {
        switch identifier {
        case "tab.progress":
            return 1
        case "tab.journal":
            return 2
        case "tab.board":
            return 3
        case "tab.settings":
            return 4
        default:
            return nil
        }
    }

    func openHistoryJourneyView(in app: XCUIApplication) {
        let journeyToggle = app.buttons["history.viewMode.journey"]
        guard journeyToggle.waitForExistence(timeout: 5) else { return }
        tapByStableCenter(journeyToggle, in: app)
    }

    func tap(_ element: XCUIElement, thenWaitForRoot slug: String, in app: XCUIApplication) {
        let root = app.otherElements["root.currentView.\(slug)"]
        for attempt in 1...3 {
            tapByStableCenter(element, in: app)
            if root.waitForExistence(timeout: 12) {
                return
            }
            XCTAssertTrue(attempt < 3, "Expected tap to transition to root.currentView.\(slug)")
        }
    }

    // MARK: - Taps and waits

    @discardableResult
    func tapByStableCenter(
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

    /// Taps a SwiftUI `Toggle` on its switch. The element's frame spans the label
    /// too, and a tap on the label does not flip the switch, so this taps near the
    /// trailing edge, where the switch is drawn.
    func tapSwitch(_ toggle: XCUIElement, in app: XCUIApplication) {
        guard let frame = stableFrame(for: toggle, in: app) else { return }
        toggle.coordinate(withNormalizedOffset: .zero)
            .withOffset(CGVector(dx: frame.width - 26, dy: frame.height / 2))
            .tap()
    }

    func waitForAccessibilityValue(_ element: XCUIElement, _ value: String, timeout: TimeInterval) {
        let predicate = NSPredicate(format: "value == %@", value)
        let expectation = expectation(for: predicate, evaluatedWith: element)
        wait(for: [expectation], timeout: timeout)
    }

    // MARK: - Scrolling and keyboard

    func isElementInVisibleFrame(_ element: XCUIElement, in app: XCUIApplication) -> Bool {
        let frame = element.frame
        let center = CGPoint(x: frame.midX, y: frame.midY)
        return !frame.isEmpty
            && frame.width > 1
            && frame.height > 1
            && app.frame.insetBy(dx: -1, dy: -1).contains(center)
    }

    func scrollElementIntoVisibleFrame(
        _ element: XCUIElement,
        in app: XCUIApplication,
        maxSwipes: Int = 4
    ) {
        for _ in 0..<maxSwipes {
            if isElementInVisibleFrame(element, in: app) { return }
            app.swipeUp()
            RunLoop.current.run(until: Date().addingTimeInterval(0.3))
        }
    }

    /// Swipes the screen up until `element` sits above the on-screen keyboard. A
    /// no-op without a keyboard. `isElementInVisibleFrame` counts the area under the
    /// keyboard as visible, so a tap there lands on the keyboard instead.
    func scrollElementAboveKeyboard(
        _ element: XCUIElement,
        in app: XCUIApplication,
        maxSwipes: Int = 4,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        let keyboard = app.keyboards.firstMatch
        for _ in 0..<maxSwipes {
            guard keyboard.exists else { return }
            if element.frame.maxY <= keyboard.frame.minY { return }
            app.scrollViews.firstMatch.swipeUp()
            RunLoop.current.run(until: Date().addingTimeInterval(0.3))
        }
        if keyboard.exists {
            XCTAssertLessThanOrEqual(
                element.frame.maxY,
                keyboard.frame.minY,
                "Could not scroll the element clear of the keyboard",
                file: file,
                line: line
            )
        }
    }

    func dismissKeyboardIfPresent(in app: XCUIApplication) {
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

    /// Replaces field contents without relying on the "Select All" context menu (flaky in CI).
    func clearUsernameFieldForUITest(_ field: XCUIElement, in app: XCUIApplication) {
        field.tap()
        field.press(forDuration: 1.2)
        let selectAll = app.menuItems["Select All"]
        if selectAll.waitForExistence(timeout: 2) {
            selectAll.tap()
            return
        }
        let deleteKey = app.keyboards.keys["Delete"]
        XCTAssertTrue(
            deleteKey.waitForExistence(timeout: 3),
            "Expected keyboard with Delete after focusing username field"
        )
        for _ in 0..<40 {
            deleteKey.tap()
        }
    }
}
