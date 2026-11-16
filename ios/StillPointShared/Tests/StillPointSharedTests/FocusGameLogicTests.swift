import Foundation
import Testing
@testable import StillPointShared

/// #1192: the iOS port of the grid-tap focus game (web #680 v1). The golden
/// fixture `shared/test-fixtures/focusGame.json` is replayed here and by web's
/// vitest suite (`src/lib/focusGameLogic.fixture.test.ts`), so the two stay in step.
/// Each case feeds the recorded random rolls in order and checks every step's
/// outcome, full state and saved result.
struct FocusGameLogicTests {
    // MARK: - Fixture shapes (mirror shared/test-fixtures/focusGame.json)

    struct Fixture: Decodable {
        struct Timing: Decodable {
            let responseMs: Int
            let minGapMs: Int
            let extraGapMaxMs: Int
        }
        struct RowsForViewport: Decodable {
            let viewportPx: Int
            let expected: Int
        }
        struct RowsForHeight: Decodable {
            let availablePx: Int
            let expected: Int
        }
        struct GridHeight: Decodable {
            let rows: Int
            let expected: Int
        }
        struct NextGap: Decodable {
            let roll: Double
            let expected: Int
        }
        struct PickCell: Decodable {
            let cells: Int
            let exclude: Int?
            let rolls: [Double]
            let expected: [Int]
        }
        struct LitJSON: Decodable {
            let cell: Int
            let litAtMs: Int
        }
        struct StateJSON: Decodable {
            let goalMs: Int
            let startedAtMs: Int
            let countdownStartMs: Int
            let lit: LitJSON?
            let nextLightAtMs: Int
            let lastCell: Int?
            let hits: Int
            let wrongTaps: Int
            let resets: Int
            let streak: Int
            let bestStreak: Int
            let remainingMs: Int
            let finished: Bool
        }
        struct ResultJSON: Decodable {
            let duration: Int
            let actualTime: Int
            let completed: Bool
        }
        struct Step: Decodable {
            let op: String
            let atMs: Int
            let outcome: String?
            let cell: Int?
            let reason: String?
            let state: StateJSON?
            let result: ResultJSON?
        }
        struct Case: Decodable {
            let name: String
            let goalSeconds: Int
            let startMs: Int
            let cells: Int
            let rolls: [Double]
            let steps: [Step]
        }

        let timing: Timing
        let columns: Int
        let maxRows: Int
        let minRows: Int
        let durationsSeconds: [Int]
        let defaultDurationSeconds: Int
        let gridGapPx: Int
        let reservedPx: Int
        let rowsForViewport: [RowsForViewport]
        let rowsForHeight: [RowsForHeight]
        let gridHeightPx: [GridHeight]
        let nextGapMs: [NextGap]
        let pickCell: [PickCell]
        let cases: [Case]
    }

    /// Hands out the recorded rolls in the order the game asks for them.
    final class RollSource {
        private let rolls: [Double]
        private(set) var index = 0

        init(_ rolls: [Double]) {
            self.rolls = rolls
        }

        func next() -> Double {
            defer { index += 1 }
            guard index < rolls.count else {
                Issue.record("recorded rolls exhausted at \(index)")
                return 0
            }
            return rolls[index]
        }
    }

    private func loadFixture() throws -> Fixture {
        try SharedFixtures.load("focusGame.json", as: Fixture.self)
    }

    private func expectMatches(_ state: FocusGameLogic.State, _ expected: Fixture.StateJSON, nowMs: Int, label: String) {
        #expect(state.goalMs == expected.goalMs, "\(label) goalMs")
        #expect(state.startedAtMs == expected.startedAtMs, "\(label) startedAtMs")
        #expect(state.countdownStartMs == expected.countdownStartMs, "\(label) countdownStartMs")
        #expect(state.lit?.cell == expected.lit?.cell, "\(label) lit.cell")
        #expect(state.lit?.litAtMs == expected.lit?.litAtMs, "\(label) lit.litAtMs")
        #expect(state.nextLightAtMs == expected.nextLightAtMs, "\(label) nextLightAtMs")
        #expect(state.lastCell == expected.lastCell, "\(label) lastCell")
        #expect(state.hits == expected.hits, "\(label) hits")
        #expect(state.wrongTaps == expected.wrongTaps, "\(label) wrongTaps")
        #expect(state.resets == expected.resets, "\(label) resets")
        #expect(state.streak == expected.streak, "\(label) streak")
        #expect(state.bestStreak == expected.bestStreak, "\(label) bestStreak")
        #expect(FocusGameLogic.remainingMs(state, nowMs: nowMs) == expected.remainingMs, "\(label) remainingMs")
        #expect(FocusGameLogic.isFinished(state, nowMs: nowMs) == expected.finished, "\(label) finished")
    }

    private func expectResult(_ result: FocusSessionResult?, _ expected: Fixture.ResultJSON?, label: String) {
        #expect(result?.duration == expected?.duration, "\(label) duration")
        #expect(result?.actualTime == expected?.actualTime, "\(label) actualTime")
        #expect(result?.completed == expected?.completed, "\(label) completed")
        #expect((result == nil) == (expected == nil), "\(label) nil-ness")
    }

    // MARK: - Constants and pure helpers

    @Test func timingAndLayoutConstantsMatchWeb() throws {
        let fixture = try loadFixture()
        #expect(FocusGameLogic.Timing.standard.responseMs == fixture.timing.responseMs)
        #expect(FocusGameLogic.Timing.standard.minGapMs == fixture.timing.minGapMs)
        #expect(FocusGameLogic.Timing.standard.extraGapMaxMs == fixture.timing.extraGapMaxMs)
        #expect(FocusGameLogic.columns == fixture.columns)
        #expect(FocusGameLogic.maxRows == fixture.maxRows)
        #expect(FocusGameLogic.minRows == fixture.minRows)
        #expect(FocusGameLogic.durationsSeconds == fixture.durationsSeconds)
        #expect(FocusGameLogic.defaultDurationSeconds == fixture.defaultDurationSeconds)
        #expect(FocusGameLogic.gridGapPx == fixture.gridGapPx)
        #expect(FocusGameLogic.reservedPx == fixture.reservedPx)
    }

    @Test func rowsAndGridHeightsMatchFixture() throws {
        let fixture = try loadFixture()
        for row in fixture.rowsForViewport {
            #expect(FocusGameLogic.rowsForViewport(row.viewportPx) == row.expected, "viewport \(row.viewportPx)")
        }
        for row in fixture.rowsForHeight {
            #expect(FocusGameLogic.rowsForHeight(row.availablePx) == row.expected, "height \(row.availablePx)")
        }
        for row in fixture.gridHeightPx {
            #expect(FocusGameLogic.gridHeightPx(row.rows) == row.expected, "grid rows \(row.rows)")
        }
    }

    @Test func nextGapMatchesFixture() throws {
        let fixture = try loadFixture()
        for row in fixture.nextGapMs {
            #expect(FocusGameLogic.nextGapMs(roll: row.roll) == row.expected, "roll \(row.roll)")
        }
    }

    @Test func pickCellMatchesFixture() throws {
        let fixture = try loadFixture()
        for row in fixture.pickCell {
            let source = RollSource(row.rolls)
            let picked = row.rolls.map { _ in
                FocusGameLogic.pickCell(roll: source.next(), cells: row.cells, exclude: row.exclude)
            }
            #expect(picked == row.expected, "cells \(row.cells) exclude \(String(describing: row.exclude))")
        }
    }

    // MARK: - Golden replay

    @Test func everyGoldenCaseReplaysStepForStep() throws {
        let fixture = try loadFixture()
        for testCase in fixture.cases {
            let source = RollSource(testCase.rolls)
            var state: FocusGameLogic.State?
            var nowMs = testCase.startMs

            for (index, step) in testCase.steps.enumerated() {
                let label = "\(testCase.name) step \(index) (\(step.op))"
                nowMs = step.atMs
                switch step.op {
                case "create":
                    let created = FocusGameLogic.create(goalSeconds: testCase.goalSeconds, nowMs: nowMs, roll: source.next)
                    state = created
                    expectMatches(created, try #require(step.state), nowMs: nowMs, label: label)
                case "advance":
                    let current = try #require(state)
                    let result = FocusGameLogic.advance(current, nowMs: nowMs, roll: source.next, cells: testCase.cells)
                    #expect(result.outcome.rawValue == step.outcome, "\(label) outcome")
                    state = result.state
                    expectMatches(result.state, try #require(step.state), nowMs: nowMs, label: label)
                case "tap":
                    let current = try #require(state)
                    let result = FocusGameLogic.tap(
                        current,
                        cell: try #require(step.cell),
                        nowMs: nowMs,
                        roll: source.next,
                        cells: testCase.cells
                    )
                    #expect(result.outcome.rawValue == step.outcome, "\(label) outcome")
                    state = result.state
                    expectMatches(result.state, try #require(step.state), nowMs: nowMs, label: label)
                case "end":
                    let current = try #require(state)
                    let reason: FocusEndReason = step.reason == "expired" ? .expired : .ended
                    let saved = FocusGameLogic.result(current, nowMs: nowMs, reason: reason)
                    expectResult(saved, step.result, label: label)
                default:
                    Issue.record("unknown op \(step.op) in \(testCase.name)")
                }
            }
            #expect(source.index == testCase.rolls.count, "\(testCase.name) consumed every recorded roll")
        }
    }

    // MARK: - Rules the fixture cases lean on, stated directly

    @Test func lateTapAfterResponseWindowResetsInsteadOfScoring() {
        let rolls = RollSource([0.0, 0.0, 0.0])
        var state = FocusGameLogic.create(goalSeconds: 60, nowMs: 0, roll: rolls.next)
        let lit = FocusGameLogic.advance(state, nowMs: 2000, roll: rolls.next, cells: 9)
        state = lit.state
        let cell = state.lit?.cell ?? -1
        let late = FocusGameLogic.tap(state, cell: cell, nowMs: 2000 + 1500, roll: rolls.next, cells: 9)
        #expect(late.outcome == .reset)
        #expect(late.state.hits == 0)
        #expect(late.state.resets == 1)
    }

    @Test func wrongTapCountsButChangesNothingElse() {
        let rolls = RollSource([0.0, 0.0])
        var state = FocusGameLogic.create(goalSeconds: 60, nowMs: 0, roll: rolls.next)
        state = FocusGameLogic.advance(state, nowMs: 2000, roll: rolls.next, cells: 9).state
        let lit = state.lit?.cell ?? 0
        let other = (lit + 1) % 9
        let wrong = FocusGameLogic.tap(state, cell: other, nowMs: 2100, roll: rolls.next, cells: 9)
        #expect(wrong.outcome == .wrong)
        #expect(wrong.state.wrongTaps == 1)
        #expect(wrong.state.lit == state.lit)
        #expect(wrong.state.streak == 0)
    }

    @Test func emptyEndBeforeOneWholeSecondSavesNothing() {
        let rolls = RollSource([0.9])
        let state = FocusGameLogic.create(goalSeconds: 180, nowMs: 1000, roll: rolls.next)
        #expect(FocusGameLogic.result(state, nowMs: 1600, reason: .ended) == nil)
    }

    @Test func quickEndAfterAMissStillSavesTimePlayedFromTheGameStart() {
        // The first light comes one quiet gap (2000 ms at roll 0) after the start. It is
        // missed, so the countdown restarts at 3500, but the save counts from the start.
        let rolls = RollSource([0, 0, 0])
        var state = FocusGameLogic.create(goalSeconds: 180, nowMs: 0, roll: rolls.next)
        state = FocusGameLogic.advance(state, nowMs: 2000, roll: rolls.next, cells: 9).state
        let missed = FocusGameLogic.advance(state, nowMs: 3500, roll: rolls.next, cells: 9)
        #expect(missed.outcome == .reset)
        #expect(missed.state.countdownStartMs == 3500)
        let saved = FocusGameLogic.result(missed.state, nowMs: 3600, reason: .ended)
        #expect(saved?.actualTime == 3)
        #expect(saved?.completed == false)
    }

    @Test func goalElapsedBeforeALateMissIsAppliedCompletesInsteadOfResetting() {
        // A backgrounded app resumes after both the goal and the lit square's window have
        // passed. Completion is decided first, so the late miss does not restart the countdown.
        let state = FocusGameLogic.State(
            goalMs: 60_000,
            startedAtMs: 0,
            countdownStartMs: 0,
            lit: FocusGameLogic.Lit(cell: 0, litAtMs: 58_000),
            nextLightAtMs: 0,
            lastCell: 0,
            hits: 0,
            wrongTaps: 0,
            resets: 0,
            streak: 0,
            bestStreak: 0
        )
        let late = FocusGameLogic.advance(state, nowMs: 61_500, roll: { 0 }, cells: 9)
        #expect(late.outcome == .none)
        #expect(late.state.resets == 0)
        let saved = FocusGameLogic.result(late.state, nowMs: 61_500, reason: .expired)
        #expect(saved?.completed == true)
        #expect(saved?.actualTime == 60)
    }

    @Test func endPressedAfterTheGoalElapsedBeforeTheNextTickCountsAsCompleted() {
        let state = FocusGameLogic.create(goalSeconds: 60, nowMs: 0, roll: { 0 })
        let saved = FocusGameLogic.result(state, nowMs: 60_400, reason: .ended)
        #expect(saved?.completed == true)
        #expect(saved?.actualTime == 60)
    }
}
