import Foundation

/// Pure helpers for turning a failed native Google sign-in into operator-readable
/// diagnostics. Lives in the shared package (no `GoogleSignIn` dependency) so the
/// formatting is unit-testable; the app-target `GoogleSignInController` supplies the
/// real `NSError` / `GIDSignInError` and the `os.Logger`.
///
/// Added for #471: a TestFlight build-14 Google sign-in failure was *non-reproducible*
/// because the generic `catch` discarded the underlying error. Vercel logs showed
/// near-zero traffic to `/api/auth/google-native`, so the failure happened in-app
/// before any token was POSTed. Surfacing the real error domain + code makes the next
/// occurrence diagnosable from the UI alone (the device Console log — the only place
/// the full `GIDSignInError` string lands — is not capturable without a Mac).
public enum GoogleSignInDiagnostics {
    /// Short, screenshot-friendly message for the auth screen. Includes the error
    /// `domain` + `code` so an on-device failure is diagnosable from a screenshot.
    public static func userFacingMessage(domain: String, code: Int) -> String {
        "Google sign-in failed (\(domain) \(code)). Please try again."
    }

    /// Full one-line diagnostic for the device console / xcresult log. Keeps domain,
    /// code, the localized description, and any underlying error on a single line so it
    /// is easy to grep out of a sysdiagnose or `log collect` dump.
    public static func logLine(
        domain: String,
        code: Int,
        description: String,
        underlying: String? = nil
    ) -> String {
        // Collapse embedded newlines so a multi-line localizedDescription can't break the
        // single-line / grep-friendly contract this helper advertises.
        var line = "google-signin failure domain=\(domain) code=\(code) description=\(Self.singleLine(description))"
        if let underlying, !underlying.isEmpty {
            line += " underlying=\(Self.singleLine(underlying))"
        }
        return line
    }

    /// Flattens CR/LF into single spaces so a composed log line stays on one line.
    private static func singleLine(_ value: String) -> String {
        value
            .replacingOccurrences(of: "\r\n", with: " ")
            .replacingOccurrences(of: "\n", with: " ")
            .replacingOccurrences(of: "\r", with: " ")
    }
}
