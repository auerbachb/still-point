import Foundation

/// Pure logic for ARKit gaze attention tracking (#113). Kept in StillPointShared so
/// the 0.5s sustained-gaze debounce is unit-testable without ARKit.
public enum AttentionTrackingLogic {
    public static let sustainedThreshold: TimeInterval = 0.5

    /// Classify a raw `ARFaceAnchor.lookAtPoint` sample as attentive or away.
    /// `lookAtPoint` is in face-anchor space: positive Z means toward the device
    /// (Apple-documented convention for ARFaceAnchor coordinate space).
    public static func classifyGaze(lookAtX: Float, lookAtY: Float, lookAtZ: Float) -> String {
        let towardDevice = lookAtZ > 0.12
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
            log: [AttentionEntry] = [],
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

    /// Percent attentive vs away derived from a session attention log (#562).
    public struct AttentionSummary: Equatable, Sendable {
        public let attentivePercent: Int
        public let awayPercent: Int

        public init(attentivePercent: Int, awayPercent: Int) {
            self.attentivePercent = attentivePercent
            self.awayPercent = awayPercent
        }
    }

    /// Compute gaze-on-screen vs gaze-away proportions for completion summaries.
    /// Assumes the session begins in `initialState` (default `"attentive"`).
    public static func calculateAttentionSummary(
        log: [AttentionEntry],
        totalElapsed: Double,
        initialState: String = "attentive"
    ) -> AttentionSummary {
        guard totalElapsed > 0 else {
            return AttentionSummary(attentivePercent: 100, awayPercent: 0)
        }

        guard !log.isEmpty else {
            let attentive = initialState == "attentive" ? 100 : 0
            return AttentionSummary(attentivePercent: attentive, awayPercent: 100 - attentive)
        }

        var effectiveLog = log
        if effectiveLog[0].time > 0 {
            effectiveLog.insert(AttentionEntry(time: 0, state: initialState), at: 0)
        }

        var attentiveTime: Double = 0
        for (index, entry) in effectiveLog.enumerated() {
            let endTime: Double
            if index + 1 < effectiveLog.count {
                endTime = effectiveLog[index + 1].time
            } else {
                endTime = totalElapsed
            }
            if entry.isAttentive {
                attentiveTime += endTime - entry.time
            }
        }

        let attentivePercent = Int(round((attentiveTime / totalElapsed) * 100))
        return AttentionSummary(
            attentivePercent: attentivePercent,
            awayPercent: max(0, 100 - attentivePercent)
        )
    }
}
