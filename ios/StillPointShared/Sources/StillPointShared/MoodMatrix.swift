import Foundation

/// #472 / #635: before/after mood matrix keys and helpers.
/// Mirrors `src/lib/moodMatrix.ts` for web-iOS parity.
public enum MoodKey: String, CaseIterable, Codable, Sendable {
    case calm
    case focus
    case energy
    case anxiety
    case overall

    public var label: String {
        switch self {
        case .calm: return "Calm"
        case .focus: return "Focus"
        case .energy: return "Energy"
        case .anxiety: return "Anxiety"
        case .overall: return "Overall"
        }
    }
}

public struct MoodMatrixEntry: Codable, Sendable, Equatable {
    public let before: Int?
    public let after: Int?

    public init(before: Int? = nil, after: Int? = nil) {
        self.before = before
        self.after = after
    }

    /// Server validation requires both `before` and `after` keys (null allowed).
    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(before, forKey: .before)
        try container.encode(after, forKey: .after)
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        before = try container.decodeIfPresent(Int.self, forKey: .before)
        after = try container.decodeIfPresent(Int.self, forKey: .after)
    }

    private enum CodingKeys: String, CodingKey {
        case before, after
    }
}

public enum MoodMatrixLogic {
    /// Returns true when the matrix contains at least one non-nil cell.
    public static func isTouched(_ value: [MoodKey: MoodMatrixEntry]) -> Bool {
        MoodKey.allCases.contains { key in
            guard let entry = value[key] else { return false }
            return entry.before != nil || entry.after != nil
        }
    }

    /// Strips rows where both before and after are nil — only touched rows are sent.
    public static func buildPayload(from value: [MoodKey: MoodMatrixEntry]) -> [String: MoodMatrixEntry] {
        var out: [String: MoodMatrixEntry] = [:]
        for key in MoodKey.allCases {
            guard let entry = value[key], entry.before != nil || entry.after != nil else { continue }
            let validated = validatedEntry(before: entry.before, after: entry.after)
            guard validated.before != nil || validated.after != nil else { continue }
            out[key.rawValue] = validated
        }
        return out
    }

    public static func isKnownKey(_ key: String) -> Bool {
        MoodKey(rawValue: key) != nil
    }

    /// Clamps integer mood cells to 1…5; out-of-range values become nil.
    public static func clampMoodValue(_ value: Int?) -> Int? {
        guard let value else { return nil }
        guard value >= 1, value <= 5 else { return nil }
        return value
    }

    public static func validatedEntry(before: Int?, after: Int?) -> MoodMatrixEntry {
        MoodMatrixEntry(
            before: clampMoodValue(before),
            after: clampMoodValue(after)
        )
    }

    /// Filters unknown keys and clamps cell values when decoding persisted data.
    public static func sanitizedStored(_ stored: [String: MoodMatrixEntry]) -> [MoodKey: MoodMatrixEntry] {
        var out: [MoodKey: MoodMatrixEntry] = [:]
        for (rawKey, entry) in stored {
            guard let key = MoodKey(rawValue: rawKey) else { continue }
            let validated = validatedEntry(before: entry.before, after: entry.after)
            if validated.before != nil || validated.after != nil {
                out[key] = validated
            }
        }
        return out
    }
}

/// #635: nil-omitting PATCH body `{ "moodMatrix": { … } }` for session recap saves.
public struct MoodMatrixPatch: Encodable, Sendable {
    public let entries: [String: MoodMatrixEntry]

    public init(entries: [String: MoodMatrixEntry]) {
        self.entries = entries
    }

    public init(from value: [MoodKey: MoodMatrixEntry]) {
        self.entries = MoodMatrixLogic.buildPayload(from: value)
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(entries, forKey: .moodMatrix)
    }

    private enum CodingKeys: String, CodingKey {
        case moodMatrix
    }
}
