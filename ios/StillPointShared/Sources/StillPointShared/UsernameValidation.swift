import Foundation

/// Mirrors `src/lib/username.ts` (PR #280).
public enum UsernameValidation {
    public static let minLength = 3
    public static let maxLength = 30
    public static let errorMessage =
        "Username must be 3-30 characters (letters, numbers, underscores)"

    private static let allowed = CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_")

    public static func isValid(_ raw: String) -> Bool {
        let s = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard s.count >= minLength, s.count <= maxLength else { return false }
        return s.unicodeScalars.allSatisfy { allowed.contains($0) }
    }
}
