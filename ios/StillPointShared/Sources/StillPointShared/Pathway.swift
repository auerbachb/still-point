import Foundation

/// Duolingo-style pathway derivation (#336 / #525).
///
/// Levels and node states are derived purely from the user's `currentDay`; there
/// is no backend or migration. `currentDay` is the day the user is *on* (not yet
/// completed) — completing a standard sit advances it by one. Mirrors
/// `src/lib/pathway.ts` on web — keep both in sync.
public enum Pathway {
    /// Days that make up a single level. Five levels cover days 1–50.
    public static let daysPerLevel = 10

    /// Ordered L1–L5 level names.
    public static let levelNames: [String] = [
        "Stillness",
        "Awareness",
        "Focus",
        "Intention",
        "Kindness",
    ]

    public static let totalLevels = levelNames.count

    /// Highest day represented in the pathway (L5, day 10).
    public static let pathwayMaxDay = totalLevels * daysPerLevel

    public enum NodeState: String, Equatable, Sendable {
        case completed
        case current
        case locked
    }

    public struct PathwayNode: Equatable, Sendable {
        /// 1-based day number this node represents.
        public let day: Int
        /// Position within the level (1..daysPerLevel).
        public let dayInLevel: Int
        public let state: NodeState

        public init(day: Int, dayInLevel: Int, state: NodeState) {
            self.day = day
            self.dayInLevel = dayInLevel
            self.state = state
        }
    }

    public struct PathwayLevel: Equatable, Sendable {
        /// 1-based level index (1..totalLevels).
        public let level: Int
        public let name: String
        public let nodes: [PathwayNode]
        /// Count of completed nodes within this level.
        public let completedCount: Int
        /// Level rollup state.
        public let state: NodeState

        public init(
            level: Int,
            name: String,
            nodes: [PathwayNode],
            completedCount: Int,
            state: NodeState
        ) {
            self.level = level
            self.name = name
            self.nodes = nodes
            self.completedCount = completedCount
            self.state = state
        }
    }

    /// Resolve a single day's node state relative to `currentDay`.
    public static func nodeState(forDay day: Int, currentDay: Int) -> NodeState {
        if day < currentDay { return .completed }
        if day == currentDay { return .current }
        return .locked
    }

    /// Build the full L1–L5 pathway for a given `currentDay`. Sub-1 inputs are
    /// clamped to day 1 so the first node is always the current one.
    public static func build(currentDay: Int) -> [PathwayLevel] {
        let day = max(1, currentDay)

        var levels: [PathwayLevel] = []
        for level in 1...totalLevels {
            var nodes: [PathwayNode] = []
            var completedCount = 0

            for dayInLevel in 1...daysPerLevel {
                let nodeDay = (level - 1) * daysPerLevel + dayInLevel
                let state = nodeState(forDay: nodeDay, currentDay: day)
                if state == .completed { completedCount += 1 }
                nodes.append(PathwayNode(day: nodeDay, dayInLevel: dayInLevel, state: state))
            }

            let levelStartDay = (level - 1) * daysPerLevel + 1
            let levelEndDay = level * daysPerLevel
            let state: NodeState
            if day > levelEndDay {
                state = .completed
            } else if day >= levelStartDay {
                state = .current
            } else {
                state = .locked
            }

            levels.append(
                PathwayLevel(
                    level: level,
                    name: levelNames[level - 1],
                    nodes: nodes,
                    completedCount: completedCount,
                    state: state
                )
            )
        }

        return levels
    }
}
