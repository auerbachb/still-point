import XCTest
@testable import StillPointShared

/// #832: every `(sessionType, track)` pair a finished sit can arrive with, and the
/// exact set of flags it raises. Exact equality, so a test also fails when an extra
/// flag is raised.
final class PracticeCompletionFlagsTests: XCTestCase {
    func testAQuickSitOnThePrimaryTrackRaisesPracticeOnly() {
        XCTAssertEqual(PracticeCompletionFlags.raised(sessionType: .quick, track: .primary), [.practice])
    }

    func testAQuickSitOnTheSecondTrackIsStillTrackOnePractice() {
        XCTAssertEqual(PracticeCompletionFlags.raised(sessionType: .quick, track: .second), [.practice])
    }

    func testABreathSitOnThePrimaryTrackRaisesPracticeOnly() {
        XCTAssertEqual(PracticeCompletionFlags.raised(sessionType: .breath, track: .primary), [.practice])
    }

    func testABreathSitOnTheSecondTrackIsStillTrackOnePractice() {
        XCTAssertEqual(PracticeCompletionFlags.raised(sessionType: .breath, track: .second), [.practice])
    }

    func testAPrimaryStandardSitRaisesPracticeAndPrimaryStandard() {
        XCTAssertEqual(
            PracticeCompletionFlags.raised(sessionType: .standard, track: .primary),
            [.practice, .primaryStandard]
        )
    }

    func testASecondTrackStandardSitRaisesSecondPracticeOnly() {
        XCTAssertEqual(PracticeCompletionFlags.raised(sessionType: .standard, track: .second), [.secondPractice])
    }

    func testAFocusSessionOnThePrimaryTrackRaisesNothing() {
        XCTAssertEqual(PracticeCompletionFlags.raised(sessionType: .focus, track: .primary), [])
    }

    func testAFocusSessionOnTheSecondTrackRaisesNothing() {
        XCTAssertEqual(PracticeCompletionFlags.raised(sessionType: .focus, track: .second), [])
    }

    func testTheThreeFlagsAreDistinct() {
        XCTAssertTrue(PracticeCompletionFlags.practice.isDisjoint(with: .secondPractice))
        XCTAssertTrue(PracticeCompletionFlags.practice.isDisjoint(with: .primaryStandard))
        XCTAssertTrue(PracticeCompletionFlags.secondPractice.isDisjoint(with: .primaryStandard))
    }
}
