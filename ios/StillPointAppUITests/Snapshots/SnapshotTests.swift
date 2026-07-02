import XCTest

/// Fastlane snapshot candidates for App Store marketing (Issue #325).
/// Uses `SP_UI_TEST_SNAPSHOT_SEED` for deterministic in-app data (no backend).
final class SnapshotTests: XCTestCase {
    private let launchTimeout: TimeInterval = 45

    override func setUpWithError() throws {
        continueAfterFailure = false
        XCUIDevice.shared.ensurePortraitOrientation()
    }

    override func tearDownWithError() throws {
        XCUIDevice.shared.ensurePortraitOrientation()
    }

    @MainActor
    func testStillPointMarketingSnapshots() throws {
        let app = makeSnapshotApp(seedAuthenticated: true)
        setupSnapshot(app, waitForAnimations: true)
        app.launch()

        waitForRoot("home", in: app, message: "Home did not appear for snapshots")

        snapshot("01-home", timeWaitingForIdle: 0)

        scrollHomeFAQIntoView(app)
        snapshot("02-home-faq-expanded", timeWaitingForIdle: 0)

        XCTAssertTrue(app.buttons["home.beginButton"].waitForExistence(timeout: 8))
        tapStable(app.buttons["home.beginButton"], in: app)
        waitForRoot("session", in: app, message: "Session did not open")

        XCTAssertTrue(app.staticTexts["session.timerLabel"].waitForExistence(timeout: 12))
        RunLoop.current.run(until: Date().addingTimeInterval(1.2))
        snapshot("03-session-active", timeWaitingForIdle: 0)

        let lightHold = app.staticTexts["session.lightDistractionHoldButton"]
        XCTAssertTrue(lightHold.waitForExistence(timeout: 8))
        pressAndHold(element: lightHold, duration: 2.0)
        snapshot("04-session-distraction-hold", timeWaitingForIdle: 0)
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.15)).tap()
        RunLoop.current.run(until: Date().addingTimeInterval(0.8))

        if app.textFields["thoughtCapture.textField"].waitForExistence(timeout: 3) {
            snapshot("05-session-thought-capture", timeWaitingForIdle: 0)
            dismissThoughtCaptureIfPresent(app)
        } else if app.buttons["session.captureButton"].waitForExistence(timeout: 3) {
            tapStable(app.buttons["session.captureButton"], in: app)
            XCTAssertTrue(app.textFields["thoughtCapture.textField"].waitForExistence(timeout: 5))
            snapshot("05-session-thought-capture", timeWaitingForIdle: 0)
            dismissThoughtCaptureIfPresent(app)
        } else {
            XCTFail("Thought capture did not appear for snapshot generation")
        }

        let hyperHold = app.staticTexts["session.hyperfocusHoldButton"]
        XCTAssertTrue(hyperHold.waitForExistence(timeout: 8))
        pressAndHold(element: hyperHold, duration: 2.0)
        snapshot("06-session-hyperfocus-hold", timeWaitingForIdle: 0)
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.15)).tap()

        tapStable(app.buttons["session.extendOneMinuteButton"], in: app)
        tapStable(app.buttons["session.extendFiveMinuteButton"], in: app)
        tapStable(app.buttons["session.endEarlyButton"], in: app)

        XCTAssertTrue(app.otherElements["root.currentView.completion"].waitForExistence(timeout: 35))
        XCTAssertTrue(app.staticTexts["completion.dayTitle"].waitForExistence(timeout: 5))
        snapshot("07-completion-bonus", timeWaitingForIdle: 0)

        let noteField = app.textViews["completion.endNoteEditor"]
        XCTAssertTrue(noteField.waitForExistence(timeout: 8))
        tapStable(noteField, in: app)
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5), "Keyboard did not appear for note entry")
        noteField.typeText("Steady attention through the full sit.")

        XCTAssertTrue(
            app.staticTexts["completion.savedIndicator"].waitForExistence(timeout: 12),
            "Expected UI-test auto-save of session note"
        )
        snapshot("08-completion-note-saved", timeWaitingForIdle: 0)

        tapStable(app.buttons["completion.returnButton"], in: app)
        XCTAssertTrue(app.otherElements["root.currentView.home"].waitForExistence(timeout: 12))

        XCTAssertTrue(app.buttons["home.quickMinuteButton"].waitForExistence(timeout: 8))
        tapStable(app.buttons["home.quickMinuteButton"], in: app)
        waitForRoot("session", in: app, message: "Quick minute session did not open")
        tapStable(app.buttons["session.endEarlyButton"], in: app)
        XCTAssertTrue(app.staticTexts["completion.dayTitle"].waitForExistence(timeout: 25))
        snapshot("17-quick-minute-complete", timeWaitingForIdle: 0)
        tapStable(app.buttons["completion.returnButton"], in: app)

        XCTAssertTrue(app.buttons["home.beginButton"].waitForExistence(timeout: 12))
        tapStable(app.buttons["home.beginButton"], in: app)
        waitForRoot("session", in: app, message: "Second session did not open")
        XCTAssertTrue(app.buttons["session.pauseResumeButton"].waitForExistence(timeout: 8))
        tapStable(app.buttons["session.pauseResumeButton"], in: app)
        RunLoop.current.run(until: Date().addingTimeInterval(0.6))
        snapshot("18-session-paused", timeWaitingForIdle: 0)
        tapStable(app.buttons["session.abandonButton"], in: app)
        XCTAssertTrue(app.otherElements["root.currentView.home"].waitForExistence(timeout: 15))

        openTab(index: 1, in: app)
        XCTAssertTrue(app.staticTexts["history.title"].waitForExistence(timeout: 12))
        snapshot("09-progress-history", timeWaitingForIdle: 0)

        let sessionRow = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "history.session.")).firstMatch
        XCTAssertTrue(sessionRow.waitForExistence(timeout: 8))
        tapStable(sessionRow, in: app)
        RunLoop.current.run(until: Date().addingTimeInterval(0.5))
        snapshot("10-progress-journey-expanded", timeWaitingForIdle: 0)

        openTab(index: 3, in: app)
        XCTAssertTrue(app.staticTexts["Practitioners"].waitForExistence(timeout: 12))
        snapshot("11-practitioners-board", timeWaitingForIdle: 0)

        openTab(index: 0, in: app)
        XCTAssertTrue(app.buttons["home.buddySessionButton"].waitForExistence(timeout: 8))
        tapStable(app.buttons["home.buddySessionButton"], in: app)
        XCTAssertTrue(app.staticTexts["Meditate with a friend"].waitForExistence(timeout: 12))
        snapshot("12-buddy-lobby", timeWaitingForIdle: 0)
        tapStable(app.buttons["buddy.backToHomeButton"], in: app)

        openTab(index: 4, in: app)
        XCTAssertTrue(app.staticTexts["settings.title"].waitForExistence(timeout: 12))
        snapshot("14-settings-account", timeWaitingForIdle: 0)

        let appGateHeader = app.staticTexts["APP GATE"]
        var scrollTries = 0
        while !appGateHeader.isHittable && scrollTries < 12 {
            app.swipeUp(velocity: .fast)
            scrollTries += 1
        }
        XCTAssertTrue(appGateHeader.waitForExistence(timeout: 3))
        snapshot("15-settings-app-gate", timeWaitingForIdle: 0)

        openTab(index: 2, in: app)
        XCTAssertTrue(app.staticTexts["Thought Journal"].waitForExistence(timeout: 12))
        snapshot("16-thought-journal", timeWaitingForIdle: 0)

        terminateAppReliably(app)

        let authApp = makeSnapshotApp(seedAuthenticated: false)
        setupSnapshot(authApp, waitForAnimations: true)
        authApp.launch()
        waitForRoot("auth", in: authApp, message: "Auth screen did not appear")
        snapshot("13-auth-sign-in", timeWaitingForIdle: 0)
    }

    // MARK: - App factory

    private func makeSnapshotApp(seedAuthenticated: Bool) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchEnvironment["SP_UI_TEST_MODE"] = "1"
        app.launchEnvironment["SP_UI_TEST_SNAPSHOT_SEED"] = "1"
        app.launchEnvironment["SP_UI_TEST_RESET_STORE"] = "1"
        app.launchEnvironment["SP_UI_TEST_SEED_AUTH"] = seedAuthenticated ? "1" : "0"
        app.launchEnvironment["SP_UI_TEST_SESSION_SECONDS"] = "120"
        app.launchEnvironment["SP_UI_TEST_TIMER_MULTIPLIER"] = "0.25"
        app.launchEnvironment["SP_UI_TEST_FORCE_START_SESSION"] = "0"
        app.launchEnvironment["SP_UI_TEST_FORCE_BREATH_COUNTING"] = "0"
        app.launchEnvironment["SP_UI_TEST_FORCE_BUDDY_HUB"] = "0"
        app.launchEnvironment["SP_UI_TEST_FORCE_LAUNCH_OFFLINE"] = "0"
        app.launchEnvironment["SP_UI_TEST_FORCE_TOKEN_EXPIRED"] = "0"
        app.launchEnvironment["SP_UI_TEST_FORCE_SESSIONS_FAILURE"] = "0"
        app.launchEnvironment["SP_UI_TEST_APP_BLOCKING_SELECTED"] = "1"
        app.launchEnvironment["SP_UI_TEST_FORCE_PROGRESS_TAB"] = "0"
        app.launchEnvironment["SP_UI_TEST_FORCE_SETTINGS_TAB"] = "0"
        app.launchEnvironment["SP_UI_TEST_FORCE_USERNAME_CONFLICT"] = "0"
        return app
    }

    // MARK: - Navigation

    private func openTab(index: Int, in app: XCUIApplication) {
        let tab = app.tabBars.buttons.element(boundBy: index)
        XCTAssertTrue(tab.waitForExistence(timeout: 10))
        tapStable(tab, in: app)
        RunLoop.current.run(until: Date().addingTimeInterval(0.4))
    }

    private func scrollHomeFAQIntoView(_ app: XCUIApplication) {
        let marker = app.staticTexts["This app is incredibly boring. What's the point?"]
        var tries = 0
        while !marker.isHittable && tries < 15 {
            app.swipeUp(velocity: .fast)
            tries += 1
        }
        XCTAssertTrue(marker.waitForExistence(timeout: 5))
        XCTAssertTrue(marker.isHittable, "FAQ marker not hittable after scrolling — cannot capture 02-home-faq-expanded snapshot")
    }

    // MARK: - Interaction

    private func dismissThoughtCaptureIfPresent(_ app: XCUIApplication) {
        let dismiss = app.buttons["thoughtCapture.dismissButton"]
        if dismiss.waitForExistence(timeout: 2) {
            dismiss.tap()
        } else {
            app.swipeDown()
        }
        RunLoop.current.run(until: Date().addingTimeInterval(0.3))
    }

    private func pressAndHold(element: XCUIElement, duration: TimeInterval) {
        element.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).press(forDuration: duration)
    }

    private func tapStable(_ element: XCUIElement, in app: XCUIApplication) {
        XCTAssertTrue(element.waitForExistence(timeout: 12))
        element.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
    }

    private func waitForRoot(_ slug: String, in app: XCUIApplication, message: String) {
        let root = app.otherElements["root.currentView.\(slug)"]
        XCTAssertTrue(root.waitForExistence(timeout: launchTimeout), message)
    }

    private func terminateAppReliably(_ app: XCUIApplication, attempts: Int = 6) {
        if app.state == .notRunning { return }

        for _ in 1 ... attempts {
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
        XCTFail("App did not terminate")
    }
}
