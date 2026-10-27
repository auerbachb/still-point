import Foundation
import Testing
import StillPointShared

struct PathwayTests {
    @Test func testProducesFiveNamedLevelsWithTenNodesEach() {
        let levels = Pathway.build()
        #expect(levels.count == Pathway.totalLevels)
        #expect(levels.map(\.name) == Pathway.levelNames)
        for level in levels {
            #expect(level.nodes.count == Pathway.daysPerLevel)
        }
    }

    @Test func testNodeDaysAreContiguousFromOneThroughFifty() {
        let days = Pathway.build().flatMap { $0.nodes.map(\.day) }
        #expect(days == Array(1...Pathway.pathwayMaxDay))
    }

    @Test func testNodeStateForDay() {
        #expect(Pathway.nodeState(forDay: 1, currentDay: 5) == .completed)
        #expect(Pathway.nodeState(forDay: 4, currentDay: 5) == .completed)
        #expect(Pathway.nodeState(forDay: 5, currentDay: 5) == .current)
        #expect(Pathway.nodeState(forDay: 6, currentDay: 5) == .locked)
        #expect(Pathway.nodeState(forDay: 50, currentDay: 5) == .locked)
    }

    @Test func testDoesNotDeriveCompletedOrCurrentNodesFromDayCount() {
        let levels = Pathway.build()
        let allNodes = levels.flatMap(\.nodes)
        #expect(allNodes.allSatisfy { $0.state == .comingSoon })
        #expect(levels.allSatisfy { $0.state == .comingSoon })
        #expect(levels.allSatisfy { $0.completedCount == 0 })
        #expect(!(allNodes.contains { $0.state == .completed }))
        #expect(!(allNodes.contains { $0.state == .current }))
    }

    @Test func testExposesComingSoonCopyForTapAffordance() {
        #expect(Pathway.comingSoonMessage == "Lessons coming soon")
    }

    // MARK: - Shared cross-platform fixtures (#421 / #525 / #587)

    @Test func testSharedPathwayFixtures() throws {
        let fixture = try SharedFixtures.load("pathway.json", as: PathwayFixture.self)

        #expect(Pathway.daysPerLevel == fixture.daysPerLevel)
        #expect(Pathway.totalLevels == fixture.totalLevels)
        #expect(Pathway.pathwayMaxDay == fixture.pathwayMaxDay)
        #expect(Pathway.levelNames == fixture.levelNames)
        #expect(Pathway.comingSoonMessage == fixture.comingSoonMessage)

        for testCase in fixture.nodeStateForDay {
            let actual = Pathway.nodeState(forDay: testCase.day, currentDay: testCase.currentDay)
            #expect(actual.rawValue == testCase.expected, "day \(testCase.day) vs currentDay \(testCase.currentDay)")
        }

        for testCase in fixture.buildPathway {
            let levels = Pathway.build()

            if let expectedLevelCount = testCase.expectedLevelCount {
                #expect(levels.count == expectedLevelCount, Comment(rawValue: testCase.name))
            }

            if let expectedAllDays = testCase.expectedAllDays {
                let days = levels.flatMap { $0.nodes.map(\.day) }
                #expect(days == expectedAllDays, Comment(rawValue: testCase.name))
            }

            if testCase.expectedAllNodesComingSoon == true {
                #expect(levels.flatMap(\.nodes).allSatisfy { $0.state == .comingSoon }, Comment(rawValue: testCase.name))
            }

            if testCase.expectedAllLevelsComingSoon == true {
                #expect(levels.allSatisfy { $0.state == .comingSoon }, Comment(rawValue: testCase.name))
            }

            if testCase.expectedAllCompletedCountsZero == true {
                #expect(levels.allSatisfy { $0.completedCount == 0 }, Comment(rawValue: testCase.name))
            }

            for expectedLevel in testCase.expectedLevels ?? [] {
                guard expectedLevel.level >= 1, expectedLevel.level <= levels.count else {
                    Issue.record("\(testCase.name): level \(expectedLevel.level) out of range")
                    continue
                }
                let level = levels[expectedLevel.level - 1]
                #expect(level.name == expectedLevel.name, Comment(rawValue: testCase.name))
                #expect(level.state.rawValue == expectedLevel.state, Comment(rawValue: testCase.name))
                #expect(level.completedCount == expectedLevel.completedCount, Comment(rawValue: testCase.name))
                if let firstNodeState = expectedLevel.firstNodeState {
                    #expect(level.nodes[0].state.rawValue == firstNodeState, Comment(rawValue: testCase.name))
                }
                if let lastNodeState = expectedLevel.lastNodeState {
                    #expect(level.nodes.last?.state.rawValue == lastNodeState, Comment(rawValue: testCase.name))
                }
                if let nodeStates = expectedLevel.nodeStates {
                    #expect(level.nodes.map(\.state.rawValue) == nodeStates, Comment(rawValue: testCase.name))
                }
            }
        }
    }
}
