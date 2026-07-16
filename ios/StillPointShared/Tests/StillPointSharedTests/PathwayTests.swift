import XCTest
import StillPointShared

final class PathwayTests: XCTestCase {
    func testProducesFiveNamedLevelsWithTenNodesEach() {
        let levels = Pathway.build(currentDay: 1)
        XCTAssertEqual(levels.count, Pathway.totalLevels)
        XCTAssertEqual(levels.map(\.name), Pathway.levelNames)
        for level in levels {
            XCTAssertEqual(level.nodes.count, Pathway.daysPerLevel)
        }
    }

    func testNodeDaysAreContiguousFromOneThroughFifty() {
        let days = Pathway.build(currentDay: 1).flatMap { $0.nodes.map(\.day) }
        XCTAssertEqual(days, Array(1...Pathway.pathwayMaxDay))
    }

    func testNodeStateForDay() {
        XCTAssertEqual(Pathway.nodeState(forDay: 1, currentDay: 5), .completed)
        XCTAssertEqual(Pathway.nodeState(forDay: 4, currentDay: 5), .completed)
        XCTAssertEqual(Pathway.nodeState(forDay: 5, currentDay: 5), .current)
        XCTAssertEqual(Pathway.nodeState(forDay: 6, currentDay: 5), .locked)
        XCTAssertEqual(Pathway.nodeState(forDay: 50, currentDay: 5), .locked)
    }

    func testDayOneFirstNodeCurrentRestLocked() {
        let first = Pathway.build(currentDay: 1)[0]
        XCTAssertEqual(first.nodes[0].state, .current)
        XCTAssertTrue(first.nodes.dropFirst().allSatisfy { $0.state == .locked })
        XCTAssertEqual(first.completedCount, 0)
        XCTAssertEqual(first.state, .current)
    }

    func testMidLevelCurrentDayMarksStatesCorrectly() {
        let levels = Pathway.build(currentDay: 13)
        let l1 = levels[0]
        let l2 = levels[1]
        XCTAssertEqual(l1.state, .completed)
        XCTAssertEqual(l1.completedCount, Pathway.daysPerLevel)
        XCTAssertTrue(l1.nodes.allSatisfy { $0.state == .completed })

        XCTAssertEqual(l2.state, .current)
        XCTAssertEqual(l2.completedCount, 2)
        XCTAssertEqual(l2.nodes[0].state, .completed)
        XCTAssertEqual(l2.nodes[1].state, .completed)
        XCTAssertEqual(l2.nodes[2].state, .current)
        XCTAssertEqual(l2.nodes[3].state, .locked)
    }

    func testExactlyOneNodeIsCurrentWithinPathwayRange() {
        let currents = Pathway.build(currentDay: 27)
            .flatMap(\.nodes)
            .filter { $0.state == .current }
        XCTAssertEqual(currents.count, 1)
        XCTAssertEqual(currents[0].day, 27)
    }

    func testCurrentDayBeyondProgramCompletesEveryNode() {
        let levels = Pathway.build(currentDay: Pathway.pathwayMaxDay + 5)
        let allNodes = levels.flatMap(\.nodes)
        XCTAssertTrue(allNodes.allSatisfy { $0.state == .completed })
        XCTAssertTrue(levels.allSatisfy { $0.state == .completed })
    }

    func testCurrentDayExactlyAtLastDayKeepsItCurrent() {
        let last = Pathway.build(currentDay: Pathway.pathwayMaxDay)[Pathway.totalLevels - 1]
        XCTAssertEqual(last.nodes[Pathway.daysPerLevel - 1].state, .current)
        XCTAssertEqual(last.state, .current)
    }

    func testClampsSubOneInputToDayOne() {
        for input in [0, -5] {
            let levels = Pathway.build(currentDay: input)
            XCTAssertEqual(levels[0].nodes[0].state, .current, "input \(input)")
        }
    }

    // MARK: - Shared cross-platform fixtures (#421 / #525)

    func testSharedPathwayFixtures() throws {
        let fixture = try SharedFixtures.load("pathway.json", as: PathwayFixture.self)

        XCTAssertEqual(Pathway.daysPerLevel, fixture.daysPerLevel)
        XCTAssertEqual(Pathway.totalLevels, fixture.totalLevels)
        XCTAssertEqual(Pathway.pathwayMaxDay, fixture.pathwayMaxDay)
        XCTAssertEqual(Pathway.levelNames, fixture.levelNames)

        for testCase in fixture.nodeStateForDay {
            let actual = Pathway.nodeState(forDay: testCase.day, currentDay: testCase.currentDay)
            XCTAssertEqual(actual.rawValue, testCase.expected, "day \(testCase.day) vs currentDay \(testCase.currentDay)")
        }

        for testCase in fixture.buildPathway {
            let levels = Pathway.build(currentDay: testCase.currentDay)

            if let expectedLevelCount = testCase.expectedLevelCount {
                XCTAssertEqual(levels.count, expectedLevelCount, testCase.name)
            }

            if let expectedAllDays = testCase.expectedAllDays {
                let days = levels.flatMap { $0.nodes.map(\.day) }
                XCTAssertEqual(days, expectedAllDays, testCase.name)
            }

            if let expectedCurrentNodeCount = testCase.expectedCurrentNodeCount {
                let currents = levels.flatMap(\.nodes).filter { $0.state == .current }
                XCTAssertEqual(currents.count, expectedCurrentNodeCount, testCase.name)
            }

            if let expectedCurrentNodeDay = testCase.expectedCurrentNodeDay {
                let currents = levels.flatMap(\.nodes).filter { $0.state == .current }
                XCTAssertEqual(currents.first?.day, expectedCurrentNodeDay, testCase.name)
            }

            if testCase.expectedAllNodesCompleted == true {
                XCTAssertTrue(levels.flatMap(\.nodes).allSatisfy { $0.state == .completed }, testCase.name)
            }

            if testCase.expectedAllLevelsCompleted == true {
                XCTAssertTrue(levels.allSatisfy { $0.state == .completed }, testCase.name)
            }

            if let expectedLastLevelState = testCase.expectedLastLevelState {
                XCTAssertEqual(levels.last?.state.rawValue, expectedLastLevelState, testCase.name)
            }

            if let expectedLastNodeState = testCase.expectedLastNodeState {
                XCTAssertEqual(levels.last?.nodes.last?.state.rawValue, expectedLastNodeState, testCase.name)
            }

            if let expectedFirstNodeState = testCase.expectedFirstNodeState {
                XCTAssertEqual(levels[0].nodes[0].state.rawValue, expectedFirstNodeState, testCase.name)
            }

            for expectedLevel in testCase.expectedLevels ?? [] {
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
