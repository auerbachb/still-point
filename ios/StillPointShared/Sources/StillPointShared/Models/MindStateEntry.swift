import Foundation

/// A single mind-state transition recorded during a session.
/// Matches the web app's `{ time: number; state: string }` JSONB entries.
public struct MindStateEntry: Codable, Equatable, Sendable {
    /// Seconds elapsed when this state began
    public let time: Double

    /// Either "clear" or "thinking"
    public let state: String

    public init(time: Double, state: String) {
        self.time = time
        self.state = state
    }

    public var isClear: Bool { state == "clear" }
}
