import Foundation

/// Pure logic for ARKit gaze attention tracking (#113). Kept in StillPointShared so
/// the 0.5s sustained-gaze debounce is unit-testable without ARKit.
public enum AttentionTrackingLogic {
    public static let sustainedThreshold: TimeInterval = 0.5

    /// Classify a raw `ARFaceAnchor.lookAtPoint` sample as attentive or away.
    /// `lookAtPoint` is in face-anchor space: negative Z generally means toward the device.
    public static func classifyGaze(lookAtX: Float, lookAtY: Float, lookAtZ: Float) -> String {
        let towardDevice = lookAtZ < -0.12
        let centered = abs(lookAtX) < 0.18 && abs(lookAtY) < 0.18
        return (towardDevice && centered) ? "attentive" : "away"
    }

    public struct SustainedState: Equatable, Sendable {
        public var loggedState: String
        public var log: [AttentionEntry]
        public var pendingState: String?
        public var pendingSince: TimeInterval?

        public init(
            loggedState: String = "attentive",
            log: [AttentionEntry] = [AttentionEntry(time: 0, state: "attentive")],
            pendingState: String? = nil,
            pendingSince: TimeInterval? = nil
        ) {
            self.loggedState = loggedState
            self.log = log
            self.pendingState = pendingState
            self.pendingSince = pendingSince
        }
    }

    /// Apply a raw gaze sample with sustained-gaze debouncing. Returns updated state;
    /// appends to `log` only when the debounced state changes.
    public static func applyRawSample(
        _ rawState: String,
        elapsed: Double,
        now: TimeInterval,
        state: SustainedState,
        threshold: TimeInterval = sustainedThreshold
    ) -> SustainedState {
        var next = state

        if rawState == next.loggedState {
            next.pendingState = nil
            next.pendingSince = nil
            return next
        }

        if next.pendingState != rawState {
            next.pendingState = rawState
            next.pendingSince = now
            return next
        }

        guard let pendingSince = next.pendingSince, now - pendingSince >= threshold else {
            return next
        }

        next.loggedState = rawState
        next.pendingState = nil
        next.pendingSince = nil
        next.log.append(AttentionEntry(time: elapsed, state: rawState))
        return next
    }
}
