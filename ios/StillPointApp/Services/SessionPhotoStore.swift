import Foundation
import UIKit

/// Persists per-session environment photos to the device's Documents directory.
///
/// Photos are stored as JPEG under `<Documents>/session-photos/<sanitized-sessionId>.jpg`.
/// The session ID is encoded in the filename — no DTO or backend changes are required for
/// the MVP. Images are downscaled and compressed on save to keep disk footprint small.
///
/// Use `SessionPhotoStore.shared` from both view models and the completion screen.
final class SessionPhotoStore {
    static let shared = SessionPhotoStore()

    private static let subDirectory = "session-photos"
    private static let maxDimension: CGFloat = 1280
    private static let compressionQuality: CGFloat = 0.75

    private init() {}

    // MARK: - Public API

    /// Saves `image` for the given session ID, overwriting any prior photo.
    ///
    /// The image is downscaled to at most 1 280 px on the long edge and JPEG-compressed
    /// at 0.75 quality before writing. Uses atomic file replacement to avoid corrupt
    /// partial writes.
    ///
    /// - Returns: the file URL on success, or `nil` on any failure.
    @discardableResult
    func save(_ image: UIImage, forSessionId sessionId: String) -> URL? {
        guard !sessionId.isEmpty else { return nil }
        guard let data = compressed(image) else { return nil }
        let url = photoURL(forSessionId: sessionId)
        do {
            try ensureSubdirectoryExists()
            try data.write(to: url, options: .atomic)
            return url
        } catch {
            print("[SessionPhotoStore] Failed to write photo for '\(sessionId)': \(error)")
            return nil
        }
    }

    /// Loads and returns the stored image for `sessionId`, or `nil` if none exists.
    func loadImage(forSessionId sessionId: String) -> UIImage? {
        guard !sessionId.isEmpty else { return nil }
        let url = photoURL(forSessionId: sessionId)
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        return UIImage(contentsOfFile: url.path)
    }

    /// Returns `true` when a photo file exists for `sessionId`.
    func exists(forSessionId sessionId: String) -> Bool {
        guard !sessionId.isEmpty else { return false }
        return FileManager.default.fileExists(atPath: photoURL(forSessionId: sessionId).path)
    }

    /// Deletes the photo for `sessionId`. Silently no-ops if no file exists.
    func delete(forSessionId sessionId: String) {
        guard !sessionId.isEmpty else { return }
        try? FileManager.default.removeItem(at: photoURL(forSessionId: sessionId))
    }

    /// Returns the canonical file URL for `sessionId`'s photo, whether or not it exists.
    func photoURL(forSessionId sessionId: String) -> URL {
        subdirectoryURL.appendingPathComponent(sanitizedFilename(sessionId) + ".jpg")
    }

    // MARK: - Private

    private var subdirectoryURL: URL {
        FileManager.default
            .urls(for: .documentDirectory, in: .userDomainMask)[0]
            .appendingPathComponent(Self.subDirectory, isDirectory: true)
    }

    private func ensureSubdirectoryExists() throws {
        let url = subdirectoryURL
        var isDir: ObjCBool = false
        let exists = FileManager.default.fileExists(atPath: url.path, isDirectory: &isDir)
        guard !exists || !isDir.boolValue else { return }
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    }

    private func compressed(_ image: UIImage) -> Data? {
        downscaled(image).jpegData(compressionQuality: Self.compressionQuality)
    }

    private func downscaled(_ image: UIImage) -> UIImage {
        let size = image.size
        guard size.width > Self.maxDimension || size.height > Self.maxDimension else { return image }
        let ratio = max(size.width, size.height) / Self.maxDimension
        let newSize = CGSize(
            width: (size.width / ratio).rounded(),
            height: (size.height / ratio).rounded()
        )
        let renderer = UIGraphicsImageRenderer(size: newSize)
        return renderer.image { _ in image.draw(in: CGRect(origin: .zero, size: newSize)) }
    }

    /// Strips characters unsafe in filenames, keeping alphanumerics and hyphens.
    private func sanitizedFilename(_ sessionId: String) -> String {
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-_"))
        let sanitized = sessionId.unicodeScalars
            .filter { allowed.contains($0) }
            .map(String.init)
            .joined()
        return String(sanitized.prefix(128))
    }
}
