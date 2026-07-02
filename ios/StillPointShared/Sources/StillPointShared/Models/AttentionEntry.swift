import Foundation

/// A single ARKit gaze attention transition recorded during a session.
/// Matches the web app's `{ time: number; state: string }` JSONB entries (#113).
public struct AttentionEntry: Codable, Equatable, Sendable {
    /// Seconds elapsed when this attention state began
    public let time: Double

    /// "attentive" (gaze on screen) or "away" (gaze off screen).
    public let state: String

    public init(time: Double, state: String) {
        self.time = time
        self.state = state
    }

    public var isAttentive: Bool { state == "attentive" }
}
