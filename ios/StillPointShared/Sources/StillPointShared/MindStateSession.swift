import Foundation

public struct MindStateCompositionSeconds: Sendable, Equatable {
    public var clearSeconds: Int
    public var lightDistractionSeconds: Int
    public var heavyDistractionSeconds: Int
    public var hyperfocusSeconds: Int
    public var totalSeconds: Int

    public init(
        clearSeconds: Int = 0,
        lightDistractionSeconds: Int = 0,
        heavyDistractionSeconds: Int = 0,
        hyperfocusSeconds: Int = 0,
        totalSeconds: Int = 0
    ) {
        self.clearSeconds = clearSeconds
        self.lightDistractionSeconds = lightDistractionSeconds
        self.heavyDistractionSeconds = heavyDistractionSeconds
        self.hyperfocusSeconds = hyperfocusSeconds
        self.totalSeconds = totalSeconds
    }
}

public enum MindStateSession {
    /// Replays `mindStateLog` into sit-time seconds for clear, light distraction,
    /// heavy distraction, and hyperfocus. Uses the same segment boundaries as
    /// `SessionLogic.calculateClearPercent`.
    public static func computeCompositionFromLog(
        _ log: [MindStateEntry],
        endTime: Int
    ) -> MindStateCompositionSeconds {
        let totalSeconds = max(endTime, 0)
        var out = MindStateCompositionSeconds(totalSeconds: totalSeconds)
        guard totalSeconds > 0 else { return out }

        let safeLog = log
            .enumerated()
            .filter { $0.element.time.isFinite }
            .sorted { lhs, rhs in
                if lhs.element.time != rhs.element.time {
                    return lhs.element.time < rhs.element.time
                }
                return lhs.offset < rhs.offset
            }
            .map { _, entry in
                MindStateEntry(
                    time: min(max(entry.time, 0), Double(totalSeconds)),
                    state: entry.state
                )
            }

        var lastTime = 0.0
        var lastState = "clear"
        let full: [MindStateEntry]
        if safeLog.isEmpty {
            full = [MindStateEntry(time: Double(totalSeconds), state: "clear")]
        } else {
            full = safeLog + [MindStateEntry(time: Double(totalSeconds), state: "clear")]
        }

        for entry in full {
            let clampedTime = min(max(entry.time, lastTime), Double(totalSeconds))
            if clampedTime > lastTime {
                bucketMindStateSeconds(
                    lastState,
                    seconds: Int(clampedTime - lastTime),
                    into: &out
                )
            }
            lastTime = clampedTime
            lastState = entry.state
        }

        return out
    }

    private static func bucketMindStateSeconds(
        _ state: String,
        seconds: Int,
        into out: inout MindStateCompositionSeconds
    ) {
        guard seconds > 0 else { return }
        switch state {
        case "thinking":
            out.lightDistractionSeconds += seconds
        case "heavy":
            out.heavyDistractionSeconds += seconds
        case "hyperfocus":
            out.hyperfocusSeconds += seconds
        default:
            out.clearSeconds += seconds
        }
    }
}
