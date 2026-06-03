import SwiftUI
import StillPointShared

struct BuddyFilterChips: View {
    let buddyIds: [String]
    let hiddenBuddyIds: Set<String>
    let usernameForBuddy: (String) -> String
    let onToggle: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: SPSpacing.s2) {
            Text("SHOW BUDDIES")
                .font(SPFont.mono(11, weight: .medium))
                .foregroundStyle(Color(SPColor.fg4))
                .tracking(2)

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: SPSpacing.s1) {
                    ForEach(buddyIds, id: \.self) { buddyId in
                        chip(for: buddyId)
                    }
                }
            }
        }
        .padding(SPSpacing.s3)
        .background(Color(SPColor.surface1))
        .clipShape(RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(SPColor.border2))
    }

    private func chip(for buddyId: String) -> some View {
        let hidden = hiddenBuddyIds.contains(buddyId)
        let accent = buddyColorFromUserId(buddyId)
        let name = usernameForBuddy(buddyId)

        return Button {
            onToggle(buddyId)
        } label: {
            HStack(spacing: 6) {
                Circle()
                    .fill(accent)
                    .frame(width: 8, height: 8)
                    .opacity(hidden ? 0.35 : 1)

                Text(name)
                    .font(SPFont.mono(11))
                    .strikethrough(hidden)
                    .foregroundStyle(hidden ? Color(SPColor.fg3) : Color(SPColor.fg))
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(hidden ? Color.clear : accent.opacity(0.08))
            .clipShape(Capsule())
            .overlay(
                Capsule()
                    .stroke(hidden ? SPColor.border2 : accent, lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(name), \(hidden ? "hidden" : "visible")")
    }
}
