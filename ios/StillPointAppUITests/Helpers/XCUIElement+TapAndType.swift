import XCTest

extension XCUIElement {
    /// Taps the element, waits for the software keyboard and keyboard focus on this element, then types.
    ///
    /// Avoids `typeText` failures when CI is slow to promote the field to first responder
    /// (“Neither element nor any descendant has keyboard focus”).
    func tapAndType(
        _ text: String,
        in app: XCUIApplication,
        timeout: TimeInterval = 10,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        tap()

        let keyboard = app.keyboards.firstMatch
        XCTAssertTrue(
            keyboard.waitForExistence(timeout: timeout),
            "Keyboard did not appear after tapping text field",
            file: file,
            line: line
        )

        let focusPredicate = NSPredicate(format: "hasKeyboardFocus == true")
        let focusExpectation = XCTNSPredicateExpectation(predicate: focusPredicate, object: self)
        let outcome = XCTWaiter.wait(for: [focusExpectation], timeout: timeout)
        guard outcome == .completed else {
            XCTFail(
                "Field did not become keyboard first responder (wait outcome: \(outcome.rawValue))",
                file: file,
                line: line
            )
            return
        }

        typeText(text)
    }
}
