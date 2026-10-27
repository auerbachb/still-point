import SwiftUI
import StillPointShared

/// The thoughts captured during the sit, each with its time into the session.
/// The parent shows this only when there is at least one.
struct CompletionThoughtsSection: View {
    let thoughts: [CapturedThought]

    var body: some View {
        VStack(alignment: .leading, spacing: SPSpacing.s2) {
            Text("THOUGHTS CAPTURED")
                .font(SPFont.mono(11, weight: .medium))
                .foregroundStyle(Color(SPColor.fg4))
                .tracking(2)

            ForEach(thoughts) { thought in
                HStack(alignment: .top, spacing: SPSpacing.s2) {
                    Text("@\(thought.timeInSession)s")
                        .font(SPFont.mono(11))
                        .foregroundStyle(SPColor.amberText)
                        .frame(width: 50, alignment: .trailing)

                    Text(thought.text)
                        .font(SPFont.serifItalic(15))
                        .foregroundStyle(Color(SPColor.fg2))
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
    }
}
