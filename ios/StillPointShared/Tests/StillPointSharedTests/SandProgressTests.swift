import Foundation
import Testing
@testable import StillPointShared

/// #1190: `SandProgress` against `shared/test-fixtures/sandProgress.json`, the same
/// golden file `src/lib/sandProgress.test.ts` reads, so the Swift port cannot drift
/// from the web model.
struct SandProgressTests {
    /// Floating-point tolerance for fractional fields (documented in the fixture README).
    private static let tolerance = 1e-9

    private func fixture() throws -> SandProgressFixture {
        try SharedFixtures.load("sandProgress.json", as: SandProgressFixture.self)
    }

    @Test func testConstantsMatchFixture() throws {
        let c = try fixture().constants
        #expect(SandProgress.secondsPerTrip == c.secondsPerTrip)
        #expect(SandProgress.maxTrips == c.maxTrips)
        #expect(SandProgress.carryShare == c.carryShare)
        #expect(SandProgress.walkSeconds == c.walkSeconds)
    }

    @Test func testEveryFixtureCaseMatches() throws {
        let cases = try fixture().cases
        #expect(!cases.isEmpty)
        for c in cases {
            let state = SandProgress.progress(elapsed: c.elapsedSeconds, total: c.totalSeconds)
            let e = c.expected
            #expect(SandProgress.tripCount(total: c.totalSeconds) == e.tripCount, Comment(rawValue: c.name))
            #expect(state.complete == e.complete, Comment(rawValue: c.name))
            #expect(state.carrying == e.carrying, Comment(rawValue: c.name))
            #expect(abs(state.fraction - e.fraction) < Self.tolerance, Comment(rawValue: c.name))
            #expect(abs(state.sourceFraction - e.sourceFraction) < Self.tolerance, Comment(rawValue: c.name))
            #expect(abs(state.destinationFraction - e.destinationFraction) < Self.tolerance, Comment(rawValue: c.name))
            #expect(abs(state.carrierPosition - e.carrierPosition) < Self.tolerance, Comment(rawValue: c.name))
            #expect(abs(state.walkPhase - e.walkPhase) < Self.tolerance, Comment(rawValue: c.name))
        }
    }

    // MARK: - Non-finite inputs (Swift-only; JSON cannot encode NaN or Infinity)

    @Test func testNonFiniteElapsedIsTreatedAsZero() {
        #expect(SandProgress.progress(elapsed: .nan, total: 600).fraction == 0)
        #expect(SandProgress.progress(elapsed: .infinity, total: 600).fraction == 0)
        #expect(SandProgress.progress(elapsed: -.infinity, total: 600).fraction == 0)
    }

    @Test func testNonFiniteTotalIsCompleteSit() {
        for total in [Double.nan, .infinity, -.infinity, 0, -10] {
            let state = SandProgress.progress(elapsed: 30, total: total)
            #expect(state.fraction == 1)
            #expect(state.complete)
            #expect(state.sourceFraction == 0)
            #expect(state.destinationFraction == 1)
        }
    }

    @Test func testNonFiniteTotalCountsAsOneTrip() {
        #expect(SandProgress.tripCount(total: .nan) == 1)
        #expect(SandProgress.tripCount(total: .infinity) == 1)
        #expect(SandProgress.tripCount(total: 0) == 1)
    }

    @Test func testHugeTotalClampsToMaxTrips() {
        #expect(SandProgress.tripCount(total: 1e300) == SandProgress.maxTrips)
    }

    // MARK: - Pause behaviour

    @Test func testIdenticalElapsedGivesIdenticalState() {
        #expect(SandProgress.progress(elapsed: 123.456, total: 600) == SandProgress.progress(elapsed: 123.456, total: 600))
    }
}
