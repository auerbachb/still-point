import Foundation
import Testing
@testable import StillPointShared

/// #832: every `(sessionType, track)` pair a finished sit can arrive with, and the
/// exact set of flags it raises. Exact equality, so a test also fails when an extra
/// flag is raised.
struct PracticeCompletionFlagsTests {
    @Test func testAQuickSitOnThePrimaryTrackRaisesPracticeOnly() {
        #expect(PracticeCompletionFlags.raised(sessionType: .quick, track: .primary) == [.practice])
    }

    @Test func testAQuickSitOnTheSecondTrackIsStillTrackOnePractice() {
        #expect(PracticeCompletionFlags.raised(sessionType: .quick, track: .second) == [.practice])
    }

    @Test func testABreathSitOnThePrimaryTrackRaisesPracticeOnly() {
        #expect(PracticeCompletionFlags.raised(sessionType: .breath, track: .primary) == [.practice])
    }

    @Test func testABreathSitOnTheSecondTrackIsStillTrackOnePractice() {
        #expect(PracticeCompletionFlags.raised(sessionType: .breath, track: .second) == [.practice])
    }

    @Test func testAPrimaryStandardSitRaisesPracticeAndPrimaryStandard() {
        #expect(PracticeCompletionFlags.raised(sessionType: .standard, track: .primary) == [.practice, .primaryStandard])
    }

    @Test func testASecondTrackStandardSitRaisesSecondPracticeOnly() {
        #expect(PracticeCompletionFlags.raised(sessionType: .standard, track: .second) == [.secondPractice])
    }

    @Test func testAFocusSessionOnThePrimaryTrackRaisesNothing() {
        #expect(PracticeCompletionFlags.raised(sessionType: .focus, track: .primary) == [])
    }

    @Test func testAFocusSessionOnTheSecondTrackRaisesNothing() {
        #expect(PracticeCompletionFlags.raised(sessionType: .focus, track: .second) == [])
    }

    @Test func testTheThreeFlagsAreDistinct() {
        #expect(PracticeCompletionFlags.practice.isDisjoint(with: .secondPractice))
        #expect(PracticeCompletionFlags.practice.isDisjoint(with: .primaryStandard))
        #expect(PracticeCompletionFlags.secondPractice.isDisjoint(with: .primaryStandard))
    }
}
