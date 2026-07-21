import SwiftUI
import StillPointShared

/// Duolingo-style L1–L5 lesson pathway preview (#525 / #587). Mirrors `src/components/Pathway.tsx`.
struct PathwayView: View {
    @State private var showComingSoonAlert = false

    private var levels: [Pathway.PathwayLevel] {
        Pathway.build()
    }

    var body: some View {
        VStack(spacing: SPSpacing.s4) {
            Text("Pathway")
                .font(SPFont.mono(12, weight: .regular))
                .foregroundStyle(Color(SPColor.fg3))
                .tracking(2.4)
                .textCase(.uppercase)
                .frame(maxWidth: .infinity)

            ForEach(levels, id: \.level) { level in
                levelSection(level)
            }
        }
        .frame(maxWidth: 420)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Lesson pathway")
        .accessibilityIdentifier("home.pathway")
        .alert(Pathway.comingSoonMessage, isPresented: $showComingSoonAlert) {
            Button("OK", role: .cancel) {}
        }
    }

    @ViewBuilder
    private func levelSection(_ level: Pathway.PathwayLevel) -> some View {
        VStack(spacing: SPSpacing.s2) {
            HStack(alignment: .firstTextBaseline) {
                Text("L\(level.level) · \(level.name)")
                    .font(SPFont.mono(11, weight: .regular))
                    .foregroundStyle(Color(SPColor.fg3))
                    .tracking(1.32)
                    .textCase(.uppercase)

                Spacer()

                Text("Coming soon")
                    .font(SPFont.mono(11, weight: .regular))
                    .foregroundStyle(Color(SPColor.fg4))
            }

            HStack(spacing: 0) {
                ForEach(Array(level.nodes.enumerated()), id: \.element.day) { index, node in
                    if index > 0 {
                        connectorLine()
                    }
                    nodeView(node)
                }
            }
        }
    }

    private func nodeView(_ node: Pathway.PathwayNode) -> some View {
        Button {
            showComingSoonAlert = true
        } label: {
            nodeCircle(
                label: "\(node.day)",
                fontSize: 11,
                borderWidth: 1,
                borderColor: SPColor.border1,
                background: SPColor.surface1,
                foreground: SPColor.fg4
            )
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Day \(node.day), lessons coming soon")
    }

    private func nodeCircle(
        label: String,
        fontSize: CGFloat,
        borderWidth: CGFloat,
        borderColor: Color,
        background: Color,
        foreground: Color
    ) -> some View {
        Text(label)
            .font(SPFont.mono(fontSize, weight: .regular))
            .foregroundStyle(foreground)
            .frame(minWidth: 0, maxWidth: 30)
            .aspectRatio(1, contentMode: .fit)
            .background(background)
            .clipShape(Circle())
            .overlay(
                Circle()
                    .strokeBorder(borderColor, lineWidth: borderWidth)
            )
            .layoutPriority(1)
    }

    private func connectorLine() -> some View {
        Rectangle()
            .fill(SPColor.border1)
            .frame(height: 1)
            .frame(minWidth: 4, maxWidth: .infinity)
    }
}
