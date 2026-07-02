import XCTest

extension XCTestCase {
    func makeApp(
        seedAuthenticated: Bool,
        resetStore: Bool,
        sessionSeconds: Int = 10,
        timerMultiplier: Double = 1.0,
        forceLaunchOffline: Bool = false,
        forceTokenExpired: Bool = false,
        forceSessionsFailure: Bool = false,
        appBlockingSelected: Bool = false,
        forceProgressTab: Bool = false,
        forceSettingsTab: Bool = false,
        forceUsernameConflict: Bool = false,
        forceStartSession: Bool = false,
        forceBreathCounting: Bool = false,
        forceBuddyHub: Bool = false
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
        app.launchEnvironment["SP_UI_TEST_FORCE_START_SESSION"] = forceStartSession ? "1" : "0"
        app.launchEnvironment["SP_UI_TEST_FORCE_BREATH_COUNTING"] = forceBreathCounting ? "1" : "0"
        app.launchEnvironment["SP_UI_TEST_FORCE_BUDDY_HUB"] = forceBuddyHub ? "1" : "0"
        app.launchEnvironment["SP_UI_TEST_APP_BLOCKING_SELECTED"] = appBlockingSelected ? "1" : "0"
        app.launchEnvironment["SP_UI_TEST_FORCE_PROGRESS_TAB"] = forceProgressTab ? "1" : "0"
        app.launchEnvironment["SP_UI_TEST_FORCE_SETTINGS_TAB"] = forceSettingsTab ? "1" : "0"
        app.launchEnvironment["SP_UI_TEST_FORCE_USERNAME_CONFLICT"] = forceUsernameConflict ? "1" : "0"
        return app
    }

    @discardableResult
    func waitForRoot(
        _ slug: String,
        in app: XCUIApplication,
        timeout: TimeInterval = 45,
        failureMessage: String,
        assertColdStart: Bool = false,
        coldStartMaxMs: Int = 50_000,
        file: StaticString = #filePath,
        line: UInt = #line
    ) -> XCUIElement {
        let root = app.otherElements["root.currentView.\(slug)"]
        guard root.waitForExistence(timeout: timeout) else {
            XCTFail(failureMessage, file: file, line: line)
            return root
        }
        if assertColdStart {
            assertColdStartBound(root: root, maxMs: coldStartMaxMs, timeout: timeout, file: file, line: line)
        }
        return root
    }

    private func assertColdStartBound(
        root: XCUIElement,
        maxMs: Int,
        timeout: TimeInterval,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        let deadline = Date().addingTimeInterval(min(45, timeout))
        var observedValue = ""
        while Date() < deadline {
            observedValue = (root.value as? String) ?? ""
            if let ms = parseMetricMs(from: observedValue) {
                XCTAssertLessThanOrEqual(
                    ms,
                    maxMs,
                    "Cold start auth check exceeded documented bound",
                    file: file,
                    line: line
                )
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

    @discardableResult
    func stableFrame(
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

        XCTFail(
            "Element existed but never had a stable tappable frame: \(element.debugDescription)",
            file: file,
            line: line
        )
        return nil
    }

    /// Policy §9 rendering gate: visibility, hit-testing, and capsule geometry
    /// without pixel-diff baselines.
    func assertCapsuleButtonRendering(
        _ element: XCUIElement,
        in app: XCUIApplication,
        minHeight: CGFloat = 44,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        guard let frame = stableFrame(for: element, in: app, file: file, line: line) else { return }
        XCTAssertTrue(element.isHittable, file: file, line: line)
        XCTAssertGreaterThan(frame.width, frame.height, "Capsule button should be wider than tall", file: file, line: line)
        XCTAssertGreaterThanOrEqual(
            frame.height,
            minHeight - 1,
            "Capsule tap target should meet minimum height",
            file: file,
            line: line
        )
    }

    /// Non-interactive capsule pills (e.g. selected-count badge) skip hit-testing.
    func assertCapsulePillRendering(
        _ element: XCUIElement,
        in app: XCUIApplication,
        minHeight: CGFloat = 24,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        guard let frame = stableFrame(for: element, in: app, file: file, line: line) else { return }
        XCTAssertGreaterThan(frame.width, frame.height, "Capsule pill should be wider than tall", file: file, line: line)
        XCTAssertGreaterThanOrEqual(frame.height, minHeight - 1, file: file, line: line)
    }
}
