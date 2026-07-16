import SwiftUI
import StillPointShared

/// Duolingo-style L1–L5 lesson pathway (#525). Mirrors `src/components/Pathway.tsx`.
struct PathwayView: View {
    let currentDay: Int

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var pulse = false

    private var levels: [Pathway.PathwayLevel] {
        Pathway.build(currentDay: currentDay)
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
    }

    @ViewBuilder
    private func levelSection(_ level: Pathway.PathwayLevel) -> some View {
        VStack(spacing: SPSpacing.s2) {
            HStack(alignment: .firstTextBaseline) {
                Text("L\(level.level) · \(level.name)")
                    .font(SPFont.mono(11, weight: .regular))
                    .foregroundStyle(levelLabelColor(level.state))
                    .tracking(1.32)
                    .textCase(.uppercase)
                    .opacity(level.state == .locked ? 0.7 : 1)

                Spacer()

                Text("\(level.completedCount)/\(level.nodes.count)")
                    .font(SPFont.mono(11, weight: .regular))
                    .foregroundStyle(Color(SPColor.fg3))
            }

            HStack(spacing: 0) {
                ForEach(Array(level.nodes.enumerated()), id: \.element.day) { index, node in
                    if index > 0 {
                        connectorLine(
                            completed: level.nodes[index - 1].state == .completed
                        )
                    }
                    nodeView(node)
                }
            }
        }
    }

    @ViewBuilder
    private func nodeView(_ node: Pathway.PathwayNode) -> some View {
        switch node.state {
        case .completed:
            nodeCircle(
                label: "✓",
                fontSize: 13,
                borderWidth: 1,
                borderColor: SPColor.greenBorder,
                background: SPColor.greenBgSubtle,
                foreground: SPColor.green,
                pulse: false
            )
            .accessibilityLabel("Day \(node.day), completed")

        case .current:
            nodeCircle(
                label: "\(node.day)",
                fontSize: 11,
                borderWidth: 2,
                borderColor: SPColor.amber,
                background: SPColor.amberBg,
                foreground: SPColor.amber,
                pulse: !reduceMotion
            )
            .accessibilityLabel("Day \(node.day), current lesson")
            .accessibilityAddTraits(.isSelected)

        case .locked:
            nodeCircle(
                label: "\(node.day)",
                fontSize: 11,
                borderWidth: 1,
                borderColor: SPColor.border1,
                background: SPColor.surface1,
                foreground: SPColor.fg4,
                pulse: false
            )
            .accessibilityLabel("Day \(node.day), locked")
        }
    }

    private func nodeCircle(
        label: String,
        fontSize: CGFloat,
        borderWidth: CGFloat,
        borderColor: Color,
        background: Color,
        foreground: Color,
        pulse: Bool
    ) -> some View {
        Text(label)
            .font(SPFont.mono(fontSize, weight: pulse ? .semibold : .regular))
            .foregroundStyle(foreground)
            .frame(minWidth: 0, maxWidth: 30)
            .aspectRatio(1, contentMode: .fit)
            .background(background)
            .clipShape(Circle())
            .overlay(
                Circle()
                    .strokeBorder(borderColor, lineWidth: borderWidth)
            )
            .scaleEffect(pulse && self.pulse ? 1.06 : 1.0)
            .opacity(pulse && self.pulse ? 1.0 : (pulse ? 0.88 : 1.0))
            .onAppear {
                guard pulse else { return }
                withAnimation(.easeInOut(duration: 2.4).repeatForever(autoreverses: true)) {
                    self.pulse = true
                }
            }
            .layoutPriority(1)
    }

    private func connectorLine(completed: Bool) -> some View {
        Rectangle()
            .fill(completed ? SPColor.greenBorder : SPColor.border1)
            .frame(height: 1)
            .frame(minWidth: 4, maxWidth: .infinity)
    }

    private func levelLabelColor(_ state: Pathway.NodeState) -> Color {
        switch state {
        case .completed: Color(SPColor.greenText)
        case .current: Color(SPColor.amberText)
        case .locked: Color(SPColor.fg3)
        }
    }
}
