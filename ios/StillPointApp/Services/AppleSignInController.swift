import AuthenticationServices
import StillPointShared

/// Maps `ASAuthorizationAppleIDCredential` from Sign in with Apple into the JSON body for
/// `POST /api/auth/apple-native`. Use with `ASAuthorizationAppleIDButton`, SwiftUI's
/// `SignInWithAppleButton`, or a raw `ASAuthorizationController` — all deliver the same credential type.
enum AppleSignInController {
    /// Returns `nil` if the identity token cannot be decoded as UTF-8 (should not happen for valid credentials).
    static func nativeSignInRequest(
        from credential: ASAuthorizationAppleIDCredential,
        rawNonce: String
    ) -> AppleNativeSignInRequest? {
        guard
            !rawNonce.isEmpty,
            let tokenData = credential.identityToken,
            let identityToken = String(data: tokenData, encoding: .utf8),
            !identityToken.isEmpty
        else {
            return nil
        }

        let authorizationCode = credential.authorizationCode.flatMap { String(data: $0, encoding: .utf8) }

        let user: AppleNativeSignInRequest.AppleUserFirstSignInPayload?
        if credential.email != nil || credential.fullName != nil {
            let name = AppleNativeSignInRequest.AppleUserFirstSignInPayload.Name(
                firstName: credential.fullName?.givenName,
                lastName: credential.fullName?.familyName
            )
            user = AppleNativeSignInRequest.AppleUserFirstSignInPayload(name: name, email: credential.email)
        } else {
            user = nil
        }

        return AppleNativeSignInRequest(
            identityToken: identityToken,
            authorizationCode: authorizationCode,
            rawNonce: rawNonce,
            user: user
        )
    }
}
