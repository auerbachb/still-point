import Foundation
import XCTest
@testable import StillPointShared

/// Loads the cross-platform golden fixtures in `shared/test-fixtures/` (#421).
/// The same JSON files back the web `vitest` suites via
/// `src/lib/testing/sharedFixtures.ts`, so web + iOS assert against one source of
/// truth and any drift between the duplicated algorithms breaks CI.
///
/// `swift test` compiles from the checked-out source tree, so the fixtures are
/// resolved from this file's `#filePath` (valid locally and in CI).
enum SharedFixtures {
    /// `.../ios/StillPointShared/Tests/StillPointSharedTests/SharedFixtures.swift`
    /// → repo root is five path components up.
    static let directoryURL: URL = {
        var url = URL(fileURLWithPath: #filePath)
        for _ in 0..<5 { url.deleteLastPathComponent() }
        return url.appendingPathComponent("shared/test-fixtures", isDirectory: true)
    }()

    static func load<T: Decodable>(_ fileName: String, as type: T.Type) throws -> T {
        let fileURL = directoryURL.appendingPathComponent(fileName)
        let data = try Data(contentsOf: fileURL)
        return try JSONDecoder().decode(T.self, from: data)
    }
}

// MARK: - Fixture shapes (mirror shared/test-fixtures/*.json)

struct ClearPercentFixture: Decodable {
    struct LogEntry: Decodable {
        let time: Double
        let state: String
    }
    struct Case: Decodable {
        let name: String
        let log: [LogEntry]
        let endTime: Double
        let expected: Int
    }
    let cases: [Case]
}

struct HistoryJourneyFixture: Decodable {
    struct Session: Decodable {
        let id: String
        let sessionType: String
        let sessionDate: String
        let createdAt: String
    }
    /// Flat, discriminated row (`kind`) so heterogeneous rows decode with plain Codable.
    struct ExpectedRow: Decodable {
        let kind: String
        let date: String?
        let startDate: String?
        let endDate: String?
        let dayCount: Int?
        let id: String?
        let sessionIndexInDay: Int?
    }
    struct Case: Decodable {
        let name: String
        let todayIsoDate: String?
        let sessions: [Session]
        let expectedRows: [ExpectedRow]
    }
    let collapseGapThresholdDays: Int
    let cases: [Case]
}

struct SessionStatsFixture: Decodable {
    struct Session: Decodable {
        let id: String
        let sessionType: String
        let dayNumber: Int
        let duration: Int
        let bonusSeconds: Int
        let actualTime: Int
        let completed: Bool
        let clearPercent: Int
        let thoughtCount: Int
        let sessionDate: String
    }
    struct Expected: Decodable {
        let streak: Int
        let avgClearPercent: Int
        let avgThoughtsPerSession: Double
        let avgThoughtsPerMinute: Double
        let bonusSecondsTotal: Int
        let bonusMinutesTotal: Int
    }
    struct Case: Decodable {
        let name: String
        let sessions: [Session]
        let expected: Expected
    }
    let cases: [Case]
}

struct BreathCountingFixture: Decodable {
    struct CountCase: Decodable {
        let taps: Int
        let expected: Int
    }
    struct PhaseCase: Decodable {
        let taps: Int
        let expected: String
    }
    struct DisplayCase: Decodable {
        let seconds: Int
        let expected: String
    }
    let breathCount: [CountCase]
    let phase: [PhaseCase]
    let elapsedDisplay: [DisplayCase]
}

struct AphorismsFixture: Decodable {
    struct Case: Decodable {
        let day: Int
        let expectedIndex: Int
    }
    let expectedCount: Int
    let cases: [Case]
}

struct BuddyCalendarColorsFixture: Decodable {
    struct Case: Decodable {
        let userId: String
        let expectedIndex: Int
        let expectedHex: String
    }
    let paletteLength: Int
    let palette: [String]
    let cases: [Case]
}

struct PathwayFixture: Decodable {
    struct NodeStateCase: Decodable {
        let day: Int
        let currentDay: Int
        let expected: String
    }

    struct ExpectedLevel: Decodable {
        let level: Int
        let name: String
        let state: String
        let completedCount: Int
        let firstNodeState: String?
        let lastNodeState: String?
        let nodeStates: [String]?
    }

    struct BuildPathwayCase: Decodable {
        let name: String
        let currentDay: Int
        let expectedCurrentNodeDay: Int?
        let expectedCurrentNodeCount: Int?
        let expectedLevelCount: Int?
        let expectedAllDays: [Int]?
        let expectedLevels: [ExpectedLevel]?
        let expectedAllNodesCompleted: Bool?
        let expectedAllLevelsCompleted: Bool?
        let expectedLastLevelState: String?
        let expectedLastNodeState: String?
        let expectedFirstNodeState: String?
    }

    let daysPerLevel: Int
    let totalLevels: Int
    let pathwayMaxDay: Int
    let levelNames: [String]
    let nodeStateForDay: [NodeStateCase]
    let buildPathway: [BuildPathwayCase]
}

struct DurationForDayFixture: Decodable {
    struct Constants: Decodable {
        let baseDuration: Int
        let increment: Int
        let maxDuration: Int
        let forkDay: Int
        let recoveryMaxSteps: Int
        let missedDayGapThreshold: Int
    }
    struct DurationCase: Decodable {
        let day: Int
        let expected: Int
    }
    struct EligibilityCase: Decodable {
        let currentDay: Int
        let expected: Bool
    }
    let constants: Constants
    let durationForDay: [DurationCase]
    let isDualTrackEligible: [EligibilityCase]
}

// MARK: - Fixture -> SessionDTO helpers

extension HistoryJourneyFixture.Session {
    func toSessionDTO() -> SessionDTO {
        SessionDTO(
            id: id,
            dayNumber: 1,
            sessionType: SessionType(rawValue: sessionType)!,
            duration: 60,
            completed: true,
            actualTime: 60,
            clearPercent: 50,
            thoughtCount: 0,
            mindStateLog: nil,
            sessionDate: sessionDate,
            createdAt: createdAt,
            buddySessionId: nil
        )
    }
}

extension SessionStatsFixture.Session {
    func toSessionDTO() -> SessionDTO {
        SessionDTO(
            id: id,
            dayNumber: dayNumber,
            sessionType: SessionType(rawValue: sessionType)!,
            duration: duration,
            bonusSeconds: bonusSeconds,
            completed: completed,
            actualTime: actualTime,
            clearPercent: clearPercent,
            thoughtCount: thoughtCount,
            mindStateLog: nil,
            sessionDate: sessionDate,
            createdAt: nil,
            buddySessionId: nil
        )
    }
}
