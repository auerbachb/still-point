import AuthenticationServices
import SwiftUI

struct AppleSignInButtonView: UIViewRepresentable {
    let coordinator: AppleSignInController.Coordinator

    func makeUIView(context: Context) -> ASAuthorizationAppleIDButton {
        let button = ASAuthorizationAppleIDButton(type: .signIn, style: .black)
        button.cornerRadius = 22
        button.addTarget(coordinator, action: #selector(AppleSignInController.Coordinator.handleTap), for: .touchUpInside)
        return button
    }

    func updateUIView(_ uiView: ASAuthorizationAppleIDButton, context: Context) {}
}
