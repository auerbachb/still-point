import XCTest

// RED-gate verification for #397 — DO NOT MERGE. A deliberately failing test so
// `swift test` exits non-zero and turns the StillPointShared swift test check red.
final class RedGateDemoTests: XCTestCase {
    func testRedGateDeliberateFailure() {
        XCTFail("RED-gate verification: proves a failing unit test turns the check red.")
    }
}
