import XCTest

extension XCUIDevice {
    /// Ensures portrait orientation without redundant simulator commands.
    /// Skipping the set when already portrait avoids CI timeouts waiting for
    /// confirmation of a no-op orientation change on contended simulators.
    func ensurePortraitOrientation() {
        guard orientation != .portrait else { return }
        orientation = .portrait
        RunLoop.current.run(until: Date().addingTimeInterval(0.3))
    }
}
