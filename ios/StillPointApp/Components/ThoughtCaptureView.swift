import SwiftUI

/// Inline thought capture card that appears when the user taps "I'm thinking"
struct ThoughtCaptureView: View {
    let onCapture: (String) -> Void
    let onDismiss: () -> Void

    @State private var text = ""
    @FocusState private var isFocused: Bool

    var body: some View {
        VStack(spacing: SPSpacing.s2) {
            HStack {
                Text("capture this thought")
                    .font(SPFont.mono(11))
                    .foregroundStyle(SPColor.amberText)
                    .tracking(1)
                Spacer()
                Button {
                    onDismiss()
                } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(Color(SPColor.fg4))
                }
            }

            TextField("what were you thinking about?", text: $text)
                .font(SPFont.serifItalic(15))
                .foregroundStyle(Color(SPColor.fg))
                .focused($isFocused)
                .onSubmit {
                    if !text.isEmpty {
                        onCapture(text)
                    }
                }

            HStack {
                Spacer()
                Button {
                    if !text.isEmpty {
                        onCapture(text)
                    } else {
                        onDismiss()
                    }
                } label: {
                    Text(text.isEmpty ? "skip" : "save")
                        .font(SPFont.mono(12, weight: .medium))
                        .foregroundStyle(text.isEmpty ? Color(SPColor.fg4) : SPColor.amber)
                }
            }
        }
        .padding(SPSpacing.s3)
        .background(SPColor.amberBgFaint)
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(SPColor.amberBorderSubtle)
        )
        .onAppear { isFocused = true }
    }
}
