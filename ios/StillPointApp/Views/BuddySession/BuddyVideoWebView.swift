import SwiftUI
import WebKit

struct BuddyVideoWebView: UIViewRepresentable {
    let roomURL: String
    let meetingToken: String

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.isScrollEnabled = false
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        guard var components = URLComponents(string: roomURL) else { return }
        var query = components.queryItems ?? []
        let hasToken = query.contains { $0.name == "t" }
        if !hasToken {
            query.append(URLQueryItem(name: "t", value: meetingToken))
        }
        components.queryItems = query
        guard let finalURL = components.url else { return }
        if webView.url != finalURL {
            webView.load(URLRequest(url: finalURL))
        }
    }
}
