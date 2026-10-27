import Foundation
import Testing
@testable import StillPointShared

struct SessionLogicClearPercentTests {
    // Cross-platform parity: the same clear-percent golden set is asserted by web
    // computeClearPercentFromLog (#421). Cases avoid .5 boundaries so JS Math.round
    // and Swift rounded() agree.
    @Test func testSharedClearPercentFixtures() throws {
        let fixture = try SharedFixtures.load("clearPercent.json", as: ClearPercentFixture.self)

        for testCase in fixture.cases {
            let log = testCase.log.map { MindStateEntry(time: $0.time, state: $0.state) }
            let actual = SessionLogic.calculateClearPercent(
                mindStateLog: log,
                totalElapsed: testCase.endTime
            )
            #expect(actual == testCase.expected, Comment(rawValue: testCase.name))
        }
    }
}
