import Foundation

/// Finds a spoken-countdown clip in either bundle layout (#793).
///
/// XcodeGen copies `VoiceCountdown` as a group, which flattens the mp3s to
/// the app bundle root. A folder reference would keep the `VoiceCountdown`
/// subdirectory. The lookup tries the subdirectory first, then the root.
enum VoiceCountdownResourceResolver {
    typealias Lookup = (_ name: String, _ ext: String, _ subdirectory: String?) -> URL?

    /// `seconds` outside 1...60 does not touch the bundle.
    static func url(for seconds: Int, lookup: Lookup) -> URL? {
        guard (1...60).contains(seconds) else { return nil }
        let name = "\(seconds)"
        if let nested = lookup(name, "mp3", "VoiceCountdown") {
            return nested
        }
        return lookup(name, "mp3", nil)
    }
}
