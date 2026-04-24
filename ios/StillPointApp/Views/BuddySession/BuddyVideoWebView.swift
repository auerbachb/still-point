import SwiftUI
import UIKit
import WebKit

struct BuddyVideoWebView: UIViewRepresentable {
    let roomURL: String
    let meetingToken: String

    final class Coordinator: NSObject, WKUIDelegate {
        var lastRequestedURL: URL?

        @available(iOS 15.0, *)
        func webView(
            _ webView: WKWebView,
            requestMediaCapturePermissionFor origin: WKSecurityOrigin,
            initiatedByFrame frame: WKFrameInfo,
            type: WKMediaCaptureType,
            decisionHandler: @escaping (WKPermissionDecision) -> Void
        ) {
            Task { @MainActor in
                decisionHandler(.grant)
            }
        }
    }

    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.isScrollEnabled = false
        webView.uiDelegate = context.coordinator
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        guard var components = URLComponents(string: roomURL) else { return }
        var query = components.queryItems ?? []
        query.removeAll { $0.name == "t" }
        query.append(URLQueryItem(name: "t", value: meetingToken))
        components.queryItems = query
        guard let finalURL = components.url else { return }
        if context.coordinator.lastRequestedURL != finalURL {
            context.coordinator.lastRequestedURL = finalURL
            webView.load(URLRequest(url: finalURL))
        }
    }
}
