import SwiftUI

/// Inline thought capture card that appears when the user taps "I'm thinking"
struct ThoughtCaptureView: View {
    private static let minTapTarget: CGFloat = 44

    let onCapture: (String) -> Void
    let onDismiss: () -> Void

    @State private var text = ""
    @FocusState private var isFocused: Bool

    private var trimmedText: String { text.trimmingCharacters(in: .whitespacesAndNewlines) }

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
                        .frame(width: Self.minTapTarget, height: Self.minTapTarget)
                        .contentShape(Rectangle())
                }
            }

            TextField("what were you thinking about?", text: $text)
                .font(SPFont.serifItalic(15))
                .foregroundStyle(Color(SPColor.fg))
                .focused($isFocused)
                .onSubmit {
                    if !trimmedText.isEmpty {
                        onCapture(trimmedText)
                    }
                }

            HStack {
                Spacer()
                Button {
                    if !trimmedText.isEmpty {
                        onCapture(trimmedText)
                    } else {
                        onDismiss()
                    }
                } label: {
                    Text(trimmedText.isEmpty ? "skip" : "save")
                        .font(SPFont.mono(12, weight: .medium))
                        .foregroundStyle(trimmedText.isEmpty ? Color(SPColor.fg4) : SPColor.amber)
                        .frame(minWidth: Self.minTapTarget, minHeight: Self.minTapTarget)
                        .contentShape(Rectangle())
                }
            }
        }
        .padding(SPSpacing.s3)
        .background(SPColor.amberBg)
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(SPColor.amberBorder)
        )
        .onAppear { isFocused = true }
    }
}
