import CryptoKit
import Foundation

/// Nonce helpers for native Sign in with Apple (#533).
public enum AppleSignInNonce {
    /// Cryptographically random nonce string for binding an identity token to this request.
    public static func randomNonceString(byteCount: Int = 32) -> String {
        var bytes = [UInt8](repeating: 0, count: byteCount)
        let status = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        precondition(status == errSecSuccess, "SecRandomCopyBytes failed: \(status)")
        return Data(bytes).base64EncodedString()
    }

    /// SHA-256 hex digest — matches the server-side `createHash("sha256").digest("hex")` check.
    public static func sha256Hex(_ value: String) -> String {
        let digest = SHA256.hash(data: Data(value.utf8))
        return digest.map { String(format: "%02x", $0) }.joined()
    }
}
