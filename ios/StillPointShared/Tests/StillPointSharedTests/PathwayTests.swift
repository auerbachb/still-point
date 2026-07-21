import XCTest
import StillPointShared

final class PathwayTests: XCTestCase {
    func testProducesFiveNamedLevelsWithTenNodesEach() {
        let levels = Pathway.build()
        XCTAssertEqual(levels.count, Pathway.totalLevels)
        XCTAssertEqual(levels.map(\.name), Pathway.levelNames)
        for level in levels {
            XCTAssertEqual(level.nodes.count, Pathway.daysPerLevel)
        }
    }

    func testNodeDaysAreContiguousFromOneThroughFifty() {
        let days = Pathway.build().flatMap { $0.nodes.map(\.day) }
        XCTAssertEqual(days, Array(1...Pathway.pathwayMaxDay))
    }

    func testNodeStateForDay() {
        XCTAssertEqual(Pathway.nodeState(forDay: 1, currentDay: 5), .completed)
        XCTAssertEqual(Pathway.nodeState(forDay: 4, currentDay: 5), .completed)
        XCTAssertEqual(Pathway.nodeState(forDay: 5, currentDay: 5), .current)
        XCTAssertEqual(Pathway.nodeState(forDay: 6, currentDay: 5), .locked)
        XCTAssertEqual(Pathway.nodeState(forDay: 50, currentDay: 5), .locked)
    }

    func testDoesNotDeriveCompletedOrCurrentNodesFromDayCount() {
        let levels = Pathway.build()
        let allNodes = levels.flatMap(\.nodes)
        XCTAssertTrue(allNodes.allSatisfy { $0.state == .comingSoon })
        XCTAssertTrue(levels.allSatisfy { $0.state == .comingSoon })
        XCTAssertTrue(levels.allSatisfy { $0.completedCount == 0 })
        XCTAssertFalse(allNodes.contains { $0.state == .completed })
        XCTAssertFalse(allNodes.contains { $0.state == .current })
    }

    func testExposesComingSoonCopyForTapAffordance() {
        XCTAssertEqual(Pathway.comingSoonMessage, "Lessons coming soon")
    }

    // MARK: - Shared cross-platform fixtures (#421 / #525 / #587)

    func testSharedPathwayFixtures() throws {
        let fixture = try SharedFixtures.load("pathway.json", as: PathwayFixture.self)

        XCTAssertEqual(Pathway.daysPerLevel, fixture.daysPerLevel)
        XCTAssertEqual(Pathway.totalLevels, fixture.totalLevels)
        XCTAssertEqual(Pathway.pathwayMaxDay, fixture.pathwayMaxDay)
        XCTAssertEqual(Pathway.levelNames, fixture.levelNames)
        XCTAssertEqual(Pathway.comingSoonMessage, fixture.comingSoonMessage)

        for testCase in fixture.nodeStateForDay {
            let actual = Pathway.nodeState(forDay: testCase.day, currentDay: testCase.currentDay)
            XCTAssertEqual(actual.rawValue, testCase.expected, "day \(testCase.day) vs currentDay \(testCase.currentDay)")
        }

        for testCase in fixture.buildPathway {
            let levels = Pathway.build()

            if let expectedLevelCount = testCase.expectedLevelCount {
                XCTAssertEqual(levels.count, expectedLevelCount, testCase.name)
            }

            if let expectedAllDays = testCase.expectedAllDays {
                let days = levels.flatMap { $0.nodes.map(\.day) }
                XCTAssertEqual(days, expectedAllDays, testCase.name)
            }

            if testCase.expectedAllNodesComingSoon == true {
                XCTAssertTrue(levels.flatMap(\.nodes).allSatisfy { $0.state == .comingSoon }, testCase.name)
            }

            if testCase.expectedAllLevelsComingSoon == true {
                XCTAssertTrue(levels.allSatisfy { $0.state == .comingSoon }, testCase.name)
            }

            if testCase.expectedAllCompletedCountsZero == true {
                XCTAssertTrue(levels.allSatisfy { $0.completedCount == 0 }, testCase.name)
            }

            for expectedLevel in testCase.expectedLevels ?? [] {
                guard expectedLevel.level >= 1, expectedLevel.level <= levels.count else {
                    XCTFail("\(testCase.name): level \(expectedLevel.level) out of range")
                    continue
                }
                let level = levels[expectedLevel.level - 1]
                XCTAssertEqual(level.name, expectedLevel.name, testCase.name)
                XCTAssertEqual(level.state.rawValue, expectedLevel.state, testCase.name)
                XCTAssertEqual(level.completedCount, expectedLevel.completedCount, testCase.name)
                if let firstNodeState = expectedLevel.firstNodeState {
                    XCTAssertEqual(level.nodes[0].state.rawValue, firstNodeState, testCase.name)
                }
                if let lastNodeState = expectedLevel.lastNodeState {
                    XCTAssertEqual(level.nodes.last?.state.rawValue, lastNodeState, testCase.name)
                }
                if let nodeStates = expectedLevel.nodeStates {
                    XCTAssertEqual(level.nodes.map(\.state.rawValue), nodeStates, testCase.name)
                }
            }
        }
    }
}
