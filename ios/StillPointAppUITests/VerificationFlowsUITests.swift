import XCTest

/// Tap-dependent verification checks that used to be manual owner checklists (#1215).
///
/// Each test names the source issue it covers (`testIssue1201_...`) and attaches a
/// screenshot at every asserted state. They live in `StillPointAppUITests` so they share
/// its helpers, but no CI lane lists them: `scripts/e2e/run-ios-tests.sh` runs explicit
/// test names, so these run only when asked for by name (see the PR for the command).
extension StillPointAppUITests {
    // MARK: - Shared steps

    private func attachScreenshot(_ name: String, of app: XCUIApplication) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    /// Looks up a Settings session-screen toggle, scrolled clear of the tab bar.
    private func sessionScreenToggle(_ slug: String, in app: XCUIApplication) -> XCUIElement {
        let toggle = app.switches["settings.sessionScreen.\(slug)Toggle"]
        XCTAssertTrue(toggle.waitForExistence(timeout: 8), "Missing \(slug) toggle")
        scrollIntoMiddleBand(toggle, in: app)
        return toggle
    }

    /// Scrolls in small steps, up or down, until the element sits below the top safe
    /// area and above the tab bar. `scrollElementAboveTabBar` only swipes up, which
    /// pushes an earlier toggle off the top once a later one has been scrolled to.
    private func scrollIntoMiddleBand(_ element: XCUIElement, in app: XCUIApplication, maxSteps: Int = 14) {
        let tabBar = app.tabBars.firstMatch
        let bottomLimit = tabBar.exists ? tabBar.frame.minY - 8 : app.frame.maxY - 8
        let topLimit = app.frame.minY + 90
        for _ in 0..<maxSteps {
            let frame = element.frame
            let tooHigh = frame.minY < topLimit
            let tooLow = frame.maxY > bottomLimit
            if !tooHigh && !tooLow { return }
            let from = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: tooLow ? 0.62 : 0.4))
            let to = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: tooLow ? 0.42 : 0.6))
            from.press(forDuration: 0.05, thenDragTo: to)
            RunLoop.current.run(until: Date().addingTimeInterval(0.4))
        }
        XCTFail("Could not scroll \(element) into view")
    }

    private func isOn(_ toggle: XCUIElement) -> Bool {
        (toggle.value as? String) == "1"
    }

    /// Flips a toggle and waits for its value to follow.
    private func setSessionScreenToggle(_ slug: String, on: Bool, in app: XCUIApplication) {
        let toggle = sessionScreenToggle(slug, in: app)
        if isOn(toggle) != on {
            tapSwitch(toggle, in: app)
        }
        waitForAccessibilityValue(toggle, on ? "1" : "0", timeout: 5)
        XCTAssertEqual(isOn(toggle), on, "\(slug) toggle did not turn \(on ? "on" : "off")")
    }

    /// Launches a signed-in account on Settings. `reset` wipes the store and the
    /// persisted toggles, so only the first launch of a persistence test passes `true`.
    @MainActor
    private func launchSettings(reset: Bool) -> XCUIApplication {
        let app = makeApp(
            seedAuthenticated: true,
            resetStore: reset,
            sessionSeconds: 600,
            timerMultiplier: 0.05,
            forceSettingsTab: true
        )
        app.launch()
        XCTAssertTrue(app.staticTexts["settings.title"].waitForExistence(timeout: 30), "Settings did not open")
        return app
    }

    /// Opens Home from Settings and begins a sit, waiting for the session screen.
    @MainActor
    private func beginSitFromSettings(in app: XCUIApplication) {
        let homeTab = app.tabBars.buttons["tab.home"]
        if homeTab.waitForExistence(timeout: 5) {
            tapByStableCenter(homeTab, in: app)
        } else {
            tapByStableCenter(app.tabBars.buttons.element(boundBy: 0), in: app)
        }
        let beginButton = app.buttons["home.beginButton"]
        XCTAssertTrue(beginButton.waitForExistence(timeout: 10), "Home did not open")
        tap(beginButton, thenWaitForRoot: "session", in: app)
    }

    /// The components the session screen reports as shown, from the UI-test marker.
    private func shownComponents(in app: XCUIApplication) -> String {
        let marker = app.otherElements["session.screenComponentsMarker"]
        XCTAssertTrue(marker.waitForExistence(timeout: 10), "Session screen components marker missing")
        return (marker.value as? String) ?? ""
    }

    // MARK: - Issue #1201

    /// Issue #1201 (iOS boxes 4 and 6): Settings > SESSION SCREEN toggles hide and
    /// restore the components during a sit, the countdown and end control stay, and the
    /// choice persists across an app relaunch.
    @MainActor
    func testIssue1201_sessionScreenTogglesHideRestoreAndPersistAcrossRelaunch() throws {
        // 1. Hide everything in Settings, then start a sit.
        let first = launchSettings(reset: true)
        for slug in ["blockGrid", "progressBar", "mindStateBar", "statusLabel"] {
            setSessionScreenToggle(slug, on: true, in: first)
        }
        attachScreenshot("1201-settings-all-on", of: first)
        for slug in ["blockGrid", "progressBar", "mindStateBar", "statusLabel"] {
            setSessionScreenToggle(slug, on: false, in: first)
        }
        attachScreenshot("1201-settings-all-off", of: first)

        beginSitFromSettings(in: first)
        XCTAssertEqual(shownComponents(in: first), "none", "All four components should be hidden")
        XCTAssertFalse(first.staticTexts["session.statusLabel"].exists, "Status label should be gone")
        XCTAssertTrue(first.staticTexts["session.timerLabel"].exists, "Countdown must stay visible")
        XCTAssertTrue(first.buttons["session.endEarlyButton"].waitForExistence(timeout: 8), "End control must stay")
        attachScreenshot("1201-session-all-hidden", of: first)

        // 2. Relaunch without a reset: the toggles are still off.
        terminateAppReliably(first)
        let second = launchSettings(reset: false)
        for slug in ["blockGrid", "progressBar", "mindStateBar", "statusLabel"] {
            XCTAssertFalse(isOn(sessionScreenToggle(slug, in: second)), "\(slug) came back on after relaunch")
        }
        attachScreenshot("1201-settings-after-relaunch-all-off", of: second)

        // 3. Restore two of them; the sit shows exactly those two, and they persist too.
        setSessionScreenToggle("blockGrid", on: true, in: second)
        setSessionScreenToggle("statusLabel", on: true, in: second)
        beginSitFromSettings(in: second)
        XCTAssertEqual(shownComponents(in: second), "blockGrid,statusLabel")
        XCTAssertTrue(second.staticTexts["session.statusLabel"].waitForExistence(timeout: 5), "Status label should return")
        XCTAssertTrue(second.staticTexts["session.timerLabel"].exists)
        attachScreenshot("1201-session-grid-and-status-restored", of: second)

        terminateAppReliably(second)
        let third = launchSettings(reset: false)
        XCTAssertTrue(isOn(sessionScreenToggle("blockGrid", in: third)))
        XCTAssertFalse(isOn(sessionScreenToggle("progressBar", in: third)))
        XCTAssertFalse(isOn(sessionScreenToggle("mindStateBar", in: third)))
        XCTAssertTrue(isOn(sessionScreenToggle("statusLabel", in: third)))
        attachScreenshot("1201-settings-after-second-relaunch", of: third)
    }

    /// Issue #1201 (iOS box 5, kept honest): with minimal view on, nothing optional shows
    /// whatever the toggles say, and turning minimal view off restores the saved layout.
    @MainActor
    func testIssue1201_minimalViewHidesEverythingThenRestoresSavedLayout() throws {
        let app = launchSettings(reset: true)
        setSessionScreenToggle("progressBar", on: false, in: app)
        beginSitFromSettings(in: app)
        XCTAssertEqual(shownComponents(in: app), "blockGrid,mindStateBar,statusLabel")
        attachScreenshot("1201-session-before-minimal", of: app)

        let minimalToggle = app.buttons["session.minimalViewToggle"]
        XCTAssertTrue(minimalToggle.waitForExistence(timeout: 8))
        tapByStableCenter(minimalToggle, in: app)
        XCTAssertTrue(app.staticTexts["session.minimalViewHint"].waitForExistence(timeout: 5))
        XCTAssertEqual(shownComponents(in: app), "none", "Minimal view must hide every optional component")
        XCTAssertFalse(app.staticTexts["session.statusLabel"].exists)
        XCTAssertTrue(app.staticTexts["session.timerLabel"].exists)
        attachScreenshot("1201-session-minimal", of: app)

        // Tap anywhere to come back: the saved layout (progress bar off) returns.
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.3)).tap()
        let restored = NSPredicate(format: "value == %@", "blockGrid,mindStateBar,statusLabel")
        expectation(for: restored, evaluatedWith: app.otherElements["session.screenComponentsMarker"])
        waitForExpectations(timeout: 8)
        XCTAssertTrue(app.staticTexts["session.statusLabel"].waitForExistence(timeout: 5))
        attachScreenshot("1201-session-after-minimal-exit", of: app)
    }

    // MARK: - Issue #1076

    /// Launches a seeded account on Home. `env` adds the #1199 state-seed flags.
    @MainActor
    private func launchHome(seeds env: [String: String]) -> XCUIApplication {
        let app = makeApp(
            seedAuthenticated: true,
            resetStore: true,
            sessionSeconds: 10,
            timerMultiplier: 2.0
        )
        for (key, value) in env { app.launchEnvironment[key] = value }
        app.launch()
        waitForRoot("home", in: app, failureMessage: "Home screen did not appear", assertColdStart: false)
        return app
    }

    /// The big day numbers on Home (one per track card), in screen order.
    private func homeDayNumbers(in app: XCUIApplication) -> [String] {
        app.staticTexts
            .matching(NSPredicate(format: "label MATCHES %@", "^[0-9]+$"))
            .allElementsBoundByIndex
            .map(\.label)
    }

    private func doneTodayBadgeCount(in app: XCUIApplication) -> Int {
        app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "DONE TODAY")).count
    }

    /// Issue #1076 scenario 1: with both tracks due the Combine action sits under Track
    /// Two; "Keep them separate" starts nothing; "Combine anyway" starts one sit that,
    /// when finished, credits both tracks, removes the action and shows "Combined" in History.
    @MainActor
    func testIssue1076_combineHappyPathCreditsBothTracksAndShowsCombinedInHistory() throws {
        let app = launchHome(seeds: ["SP_UI_TEST_DUAL_TRACK": "1"])
        let combineButton = app.buttons["home.combineButton"]
        scrollElementIntoVisibleFrame(combineButton, in: app)
        XCTAssertTrue(combineButton.waitForExistence(timeout: 10), "Combine action should be offered with both tracks due")
        XCTAssertEqual(doneTodayBadgeCount(in: app), 0)
        let dayNumbersBefore = homeDayNumbers(in: app)
        XCTAssertEqual(dayNumbersBefore.count, 2, "Expected a day number per track card: \(dayNumbersBefore)")
        attachScreenshot("1076-home-combine-offered", of: app)

        // Keep them separate: the confirmation closes and nothing starts.
        tapByStableCenter(combineButton, in: app)
        let keepSeparate = app.alerts.firstMatch.buttons["Keep them separate"].firstMatch
        XCTAssertTrue(keepSeparate.waitForExistence(timeout: 5), "Confirmation should open")
        attachScreenshot("1076-combine-confirmation", of: app)
        tapByStableCenter(keepSeparate, in: app)
        XCTAssertTrue(combineButton.waitForExistence(timeout: 5), "Action should remain after keeping them separate")
        XCTAssertFalse(app.otherElements["root.currentView.session"].exists, "Keep separate must start nothing")

        // Combine anyway: one sit starts, and finishing it credits both tracks.
        tapByStableCenter(combineButton, in: app)
        let confirm = app.alerts.firstMatch.buttons["Combine anyway"].firstMatch
        XCTAssertTrue(confirm.waitForExistence(timeout: 5))
        tapByStableCenter(confirm, in: app)
        waitForRoot("session", in: app, failureMessage: "Combined sit did not start", assertColdStart: false)

        // The sit runs to its natural end. Never fall back to End Early: that would credit
        // neither track and fail the both-track assertions below for the wrong reason.
        let completionRoot = app.otherElements["root.currentView.completion"]
        XCTAssertTrue(completionRoot.waitForExistence(timeout: 90), "Combined sit did not reach its natural completion")
        attachScreenshot("1076-combined-completion", of: app)
        let returnButton = app.buttons["completion.returnButton"]
        XCTAssertTrue(returnButton.waitForExistence(timeout: 8))
        scrollElementIntoVisibleFrame(returnButton, in: app)
        tap(returnButton, thenWaitForRoot: "home", in: app)

        XCTAssertTrue(
            app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "DONE TODAY")).firstMatch.waitForExistence(timeout: 10)
        )
        XCTAssertEqual(doneTodayBadgeCount(in: app), 2, "Both tracks should show done today")
        let dayNumbersAfter = homeDayNumbers(in: app)
        XCTAssertEqual(dayNumbersAfter.count, 2)
        for (before, after) in zip(dayNumbersBefore, dayNumbersAfter) {
            XCTAssertEqual(Int(after), (Int(before) ?? -2) + 1, "Each day number should be up by one")
        }
        XCTAssertFalse(app.buttons["home.combineButton"].exists, "Action should be gone once both tracks are done")
        attachScreenshot("1076-home-after-combined", of: app)

        openTab(identifier: "tab.progress", in: app, waitingFor: app.staticTexts["history.title"])
        openHistoryJourneyView(in: app)
        let combinedLabel = app.buttons.matching(
            NSPredicate(format: "identifier BEGINSWITH %@ AND label CONTAINS[c] %@", "history.session.", "Combined")
        ).firstMatch
        XCTAssertTrue(combinedLabel.waitForExistence(timeout: 10), "History should label the sit Combined")
        attachScreenshot("1076-history-combined", of: app)
    }

    /// Issue #1076 scenario 2: no Combine action with one track done, during a recovery
    /// ramp, or on a single-track account.
    @MainActor
    func testIssue1076_combineNotOfferedWhenOneTrackDoneInRecoveryOrSingleTrack() throws {
        let primaryDone = launchHome(seeds: ["SP_UI_TEST_DUAL_TRACK_PRIMARY_DONE": "1"])
        XCTAssertEqual(doneTodayBadgeCount(in: primaryDone), 1, "Track One should read done today")
        XCTAssertFalse(primaryDone.buttons["home.combineButton"].waitForExistence(timeout: 3))
        attachScreenshot("1076-no-combine-one-track-done", of: primaryDone)
        terminateAppReliably(primaryDone)

        let recovery = launchHome(seeds: ["SP_UI_TEST_DUAL_TRACK": "1", "SP_UI_TEST_RECOVERY_RAMP": "1"])
        XCTAssertTrue(recovery.descendants(matching: .any).matching(identifier: "home.trackTwo").firstMatch.waitForExistence(timeout: 10), "Expected a dual-track Home")
        XCTAssertFalse(recovery.buttons["home.combineButton"].waitForExistence(timeout: 3))
        attachScreenshot("1076-no-combine-during-recovery", of: recovery)
        terminateAppReliably(recovery)

        let single = launchHome(seeds: [:])
        XCTAssertTrue(single.buttons["home.beginButton"].waitForExistence(timeout: 10))
        XCTAssertFalse(single.buttons["home.combineButton"].waitForExistence(timeout: 3))
        attachScreenshot("1076-no-combine-single-track", of: single)
    }

    /// Starts a combined sit from Home (both tracks due) and returns the day numbers
    /// Home showed before it.
    @MainActor
    private func startCombinedSitAndReturnDayNumbers(_ app: XCUIApplication) -> [String] {
        waitForRoot("home", in: app, failureMessage: "Home screen did not appear", assertColdStart: false)
        let combineButton = app.buttons["home.combineButton"]
        scrollElementIntoVisibleFrame(combineButton, in: app)
        XCTAssertTrue(combineButton.waitForExistence(timeout: 10))
        let dayNumbersBefore = homeDayNumbers(in: app)
        tapByStableCenter(combineButton, in: app)
        let confirm = app.alerts.firstMatch.buttons["Combine anyway"].firstMatch
        XCTAssertTrue(confirm.waitForExistence(timeout: 5))
        tapByStableCenter(confirm, in: app)
        waitForRoot("session", in: app, failureMessage: "Combined sit did not start", assertColdStart: false)
        return dayNumbersBefore
    }

    private func assertNothingCreditedAndCombineOfferedAgain(
        in app: XCUIApplication,
        dayNumbersBefore: [String],
        screenshot: String
    ) {
        XCTAssertEqual(doneTodayBadgeCount(in: app), 0, "Nothing should be credited")
        XCTAssertEqual(homeDayNumbers(in: app), dayNumbersBefore, "Day numbers should be unchanged")
        let offeredAgain = app.buttons["home.combineButton"]
        scrollElementIntoVisibleFrame(offeredAgain, in: app)
        XCTAssertTrue(offeredAgain.waitForExistence(timeout: 10), "The Combine action should be offered again")
        attachScreenshot(screenshot, of: app)
    }

    /// Issue #1076 scenario 2: End Early on a combined sit credits nothing, leaves the day
    /// numbers alone and offers the action again.
    @MainActor
    func testIssue1076_endEarlyOnCombinedSitCreditsNothing() throws {
        let app = makeApp(seedAuthenticated: true, resetStore: true, sessionSeconds: 600, timerMultiplier: 0.05)
        app.launchEnvironment["SP_UI_TEST_DUAL_TRACK"] = "1"
        app.launch()
        let dayNumbersBefore = startCombinedSitAndReturnDayNumbers(app)

        let endEarly = app.buttons["session.endEarlyButton"]
        XCTAssertTrue(endEarly.waitForExistence(timeout: 8), "End Early control should show during the sit")
        attachScreenshot("1076-combined-sit-running", of: app)
        tapByStableCenter(endEarly, in: app)
        let completionRoot = app.otherElements["root.currentView.completion"]
        XCTAssertTrue(completionRoot.waitForExistence(timeout: 30), "End Early should open the completion screen")
        let returnButton = app.buttons["completion.returnButton"]
        XCTAssertTrue(returnButton.waitForExistence(timeout: 8))
        scrollElementIntoVisibleFrame(returnButton, in: app)
        tap(returnButton, thenWaitForRoot: "home", in: app)
        assertNothingCreditedAndCombineOfferedAgain(
            in: app, dayNumbersBefore: dayNumbersBefore, screenshot: "1076-home-after-end-early"
        )
    }

    /// Issue #1076 scenario 2, the discard path: Abandon on a combined sit credits nothing
    /// either. Separate from End Early, which saves the sit.
    @MainActor
    func testIssue1076_abandoningCombinedSitCreditsNothing() throws {
        let app = makeApp(seedAuthenticated: true, resetStore: true, sessionSeconds: 600, timerMultiplier: 0.05)
        app.launchEnvironment["SP_UI_TEST_DUAL_TRACK"] = "1"
        app.launch()
        let dayNumbersBefore = startCombinedSitAndReturnDayNumbers(app)

        let abandon = app.buttons["session.abandonButton"]
        XCTAssertTrue(abandon.waitForExistence(timeout: 8), "Abandon control should show during the sit")
        tapByStableCenter(abandon, in: app)
        waitForRoot("home", in: app, failureMessage: "Home did not return after abandoning", assertColdStart: false)
        assertNothingCreditedAndCombineOfferedAgain(
            in: app, dayNumbersBefore: dayNumbersBefore, screenshot: "1076-home-after-abandon"
        )
    }

    // MARK: - Issue #949

    /// Issue #949 box 1 (History half): web-logged focus sessions show as "Focus ·
    /// <category>" rows, and "Focus" when the session has no category.
    @MainActor
    func testIssue949_focusHistoryRowsShowCategoryLabelsInSessionBuildup() throws {
        let app = makeApp(seedAuthenticated: true, resetStore: true, forceProgressTab: true)
        app.launchEnvironment["SP_UI_TEST_FOCUS_HISTORY"] = "1"
        app.launch()
        XCTAssertTrue(app.staticTexts["history.title"].waitForExistence(timeout: 30), "History did not open")
        attachScreenshot("949-history-calendar", of: app)

        openHistoryJourneyView(in: app)
        let rows = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "history.session."))
        XCTAssertTrue(rows.firstMatch.waitForExistence(timeout: 10), "Session buildup should list the seeded sessions")
        attachScreenshot("949-session-buildup", of: app)

        func row(containing text: String) -> XCUIElement {
            app.buttons.matching(
                NSPredicate(format: "identifier BEGINSWITH %@ AND label CONTAINS %@", "history.session.", text)
            ).firstMatch
        }
        XCTAssertTrue(row(containing: "Focus \u{00B7} Reading").waitForExistence(timeout: 5), "Missing the Reading row")
        XCTAssertTrue(row(containing: "Focus \u{00B7} Writing").waitForExistence(timeout: 5), "Missing the Writing row")
        let labels = rows.allElementsBoundByIndex.map(\.label)
        XCTAssertTrue(
            labels.contains { $0.contains("Focus") && !$0.contains("\u{00B7} Reading") && !$0.contains("\u{00B7} Writing") },
            "Missing the uncategorised Focus row: \(labels)"
        )
        XCTAssertEqual(labels.filter { $0.contains("Focus") }.count, 3, "Expected the three seeded focus rows: \(labels)")
    }

    // MARK: - Issue #754

    /// Issue #754 box 1 and the badge-copy box: with an active recovery ramp, saving a
    /// setting (ambient sound) leaves the amber badge on screen and today's duration
    /// at the ramped value. The badge text is the shared `recoveryProgressText`, the
    /// same words as web; web renders it uppercase and iOS as written, which is
    /// recorded here, not changed.
    @MainActor
    func testIssue754_recoveryBadgeAndDurationSurviveASettingsToggle() throws {
        let app = makeApp(seedAuthenticated: true, resetStore: true)
        app.launchEnvironment["SP_UI_TEST_RECOVERY_RAMP"] = "1"
        // The ambient-sound toggle asks for the microphone; allow it if the prompt appears.
        addUIInterruptionMonitor(withDescription: "Microphone permission") { alert in
            for title in ["Allow", "OK", "Allow While Using App"] where alert.buttons[title].exists {
                alert.buttons[title].tap()
                return true
            }
            return false
        }
        app.launch()
        waitForRoot("home", in: app, failureMessage: "Home screen did not appear", assertColdStart: false)

        let badge = app.staticTexts["home.recoveryBadge"]
        XCTAssertTrue(badge.waitForExistence(timeout: 10), "Recovery badge should show on Home")
        let badgeBefore = badge.label
        XCTAssertNotNil(
            badgeBefore.range(of: "^recovery \\d+/\\d+ \u{00B7} ramping back to day \\d+$", options: .regularExpression),
            "Unexpected badge copy: \(badgeBefore)"
        )
        let durationLine = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "day \u{00B7} ")).firstMatch
        XCTAssertTrue(durationLine.waitForExistence(timeout: 5))
        let durationBefore = durationLine.label
        attachScreenshot("754-home-recovery-badge-before", of: app)

        openSettings(in: app)
        let ambient = app.switches["settings.ambientSoundToggle"]
        XCTAssertTrue(ambient.waitForExistence(timeout: 8))
        scrollIntoMiddleBand(ambient, in: app)
        let wasOn = isOn(ambient)
        tapSwitch(ambient, in: app)
        app.tap()  // lets the interruption monitor answer a microphone prompt
        waitForAccessibilityValue(ambient, wasOn ? "0" : "1", timeout: 8)
        // The toggle flips at once; the save runs behind the microphone prompt. Wait until the
        // fake backend has received the Settings request before leaving Settings.
        let requestCount = app.descendants(matching: .any).matching(identifier: "uiTest.settingsRequestCount").firstMatch
        XCTAssertTrue(requestCount.waitForExistence(timeout: 5), "Settings request marker missing")
        let saved = NSPredicate(format: "value != %@", "0")
        expectation(for: saved, evaluatedWith: requestCount)
        waitForExpectations(timeout: 15)
        attachScreenshot("754-settings-after-toggle", of: app)

        tapByStableCenter(app.tabBars.buttons.element(boundBy: 0), in: app)
        XCTAssertTrue(app.staticTexts["home.recoveryBadge"].waitForExistence(timeout: 10), "Badge should stay on Home")
        XCTAssertEqual(app.staticTexts["home.recoveryBadge"].label, badgeBefore, "Badge changed after a settings save")
        XCTAssertEqual(durationLine.label, durationBefore, "Ramped duration changed after a settings save")
        attachScreenshot("754-home-recovery-badge-after", of: app)
    }
}
