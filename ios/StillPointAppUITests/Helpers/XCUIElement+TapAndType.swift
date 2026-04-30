import XCTest

extension XCUIElement {
    /// Taps the element, waits for keyboard focus on this element, then types.
    ///
    /// Does not require the software keyboard to be visible (hardware keyboard / CI variants).
    /// Avoids `typeText` failures when the field is not yet first responder
    /// (“Neither element nor any descendant has keyboard focus”).
    func tapAndType(
        _ text: String,
        in app: XCUIApplication,
        timeout: TimeInterval = 10,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        tap()

        let focusPredicate = NSPredicate(format: "hasKeyboardFocus == true")
        // Fresh waiter instance so predicate timeouts return `.timedOut` instead of XCTest auto-failing
        // via the default XCTestCase delegate (allows one descriptive `XCTFail` below).
        let waiter = XCTWaiter()
        let primaryFocus = XCTNSPredicateExpectation(predicate: focusPredicate, object: self)
        var outcome = waiter.wait(for: [primaryFocus], timeout: timeout)

        if outcome != .completed {
            // Keyboard can appear slightly after focus on some simulator builds; optional short wait
            // then re-check focus without requiring `keyboards` to exist (hardware keyboard).
            let keyboard = app.keyboards.firstMatch
            if keyboard.waitForExistence(timeout: min(2.0, timeout)) {
                let retryFocus = XCTNSPredicateExpectation(predicate: focusPredicate, object: self)
                outcome = waiter.wait(for: [retryFocus], timeout: min(3.0, timeout))
            }
        }

        guard outcome == .completed else {
            XCTFail(
                "Field did not become keyboard first responder within \(timeout)s (wait outcome: \(outcome.rawValue))",
                file: file,
                line: line
            )
            return
        }

        typeText(text)
    }
}
