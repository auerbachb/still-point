import SwiftUI

/// Pre-session intro that gates the countdown until dismissed (#560).
struct SessionIntroOverlayView: View {
    let onBegin: () -> Void
    let onDontShowAgain: () -> Void

    var body: some View {
        ZStack {
            SPColor.bg.opacity(0.96)
                .ignoresSafeArea()

            VStack(spacing: SPSpacing.s4) {
                Spacer()

                Text("Before you begin")
                    .font(SPFont.serifItalic(24, weight: .light))
                    .foregroundStyle(Color(SPColor.fg))

                VStack(alignment: .leading, spacing: SPSpacing.s3) {
                    introRow(
                        icon: "timer",
                        text: "Watch the timer count down. When you notice a thought, capture it — then return to watching."
                    )
                    introRow(
                        icon: "hand.tap",
                        text: "Hold the bottom buttons to log light distraction or hyperfocus segments."
                    )
                    introRow(
                        icon: "speaker.wave.2",
                        text: "Toggle tick, chime, and end sounds below the transport controls."
                    )
                }
                .padding(.horizontal, SPSpacing.s4)

                Button {
                    onBegin()
                } label: {
                    Text("Begin")
                        .font(SPFont.mono(14, weight: .medium))
                        .spCapsuleButtonStyle(.greenGradient, size: .fullWidth, tall: true, minHeight: 44)
                }
                .accessibilityIdentifier("session.introBeginButton")

                Button {
                    onDontShowAgain()
                } label: {
                    Text("Don't show again")
                        .font(SPFont.mono(12, weight: .medium))
                        .foregroundStyle(Color(SPColor.fg4))
                        .frame(minHeight: 44)
                        .frame(maxWidth: .infinity)
                }
                .accessibilityIdentifier("session.introDontShowAgainButton")

                Spacer().frame(height: SPSpacing.s4)
            }
            .padding(.horizontal, SPSpacing.s4)
        }
        .accessibilityIdentifier("session.introOverlay")
    }

    private func introRow(icon: String, text: String) -> some View {
        HStack(alignment: .top, spacing: SPSpacing.s2) {
            Image(systemName: icon)
                .font(.system(size: 16, weight: .medium))
                .foregroundStyle(SPColor.greenText)
                .frame(width: 24, alignment: .center)
            Text(text)
                .font(SPFont.serif(15, weight: .light))
                .foregroundStyle(Color(SPColor.fg3))
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}
