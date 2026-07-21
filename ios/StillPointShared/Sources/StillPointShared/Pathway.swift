import Foundation

/// Duolingo-style pathway structure (#336 / #525).
///
/// L1–L5 levels and node layout are fixed. Until real lesson content ships,
/// every node is a coming-soon preview — node state is **not** derived from
/// `currentDay` (#587). When lessons exist, real completions can drive
/// `completed` / `current` / `locked`. Mirrors `src/lib/pathway.ts` — keep
/// both in sync.
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

    /// Copy shown when a pathway node is tapped before lessons ship.
    public static let comingSoonMessage = "Lessons coming soon"

    public enum NodeState: String, Equatable, Sendable {
        case completed
        case current
        case locked
        case comingSoon
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
    /// Reserved for future real-lesson progression — not used by `build()`.
    public static func nodeState(forDay day: Int, currentDay: Int) -> NodeState {
        if day < currentDay { return .completed }
        if day == currentDay { return .current }
        return .locked
    }

    /// Build the L1–L5 pathway preview. Every node is `comingSoon` until lesson
    /// completions drive state (#587).
    public static func build() -> [PathwayLevel] {
        var levels: [PathwayLevel] = []
        for level in 1...totalLevels {
            var nodes: [PathwayNode] = []

            for dayInLevel in 1...daysPerLevel {
                let nodeDay = (level - 1) * daysPerLevel + dayInLevel
                nodes.append(PathwayNode(day: nodeDay, dayInLevel: dayInLevel, state: .comingSoon))
            }

            levels.append(
                PathwayLevel(
                    level: level,
                    name: levelNames[level - 1],
                    nodes: nodes,
                    completedCount: 0,
                    state: .comingSoon
                )
            )
        }

        return levels
    }
}
