import SwiftUI
import StillPointShared

struct BlockGridView: View {
    let blocks: [BlockDef]
    let elapsed: Double
    let totalSeconds: Int

    private let blockSize: CGFloat = 56
    private let blockSpacing: CGFloat = 11
    private let blockRadius: CGFloat = 10

    private var minuteBlocks: [BlockDef] {
        blocks.filter { $0.type == .minute }
    }

    private var secondBlocks: [BlockDef] {
        blocks.filter { $0.type == .second }
    }

    private var useMinuteBlocks: Bool {
        totalSeconds > 120
    }

    var body: some View {
        if useMinuteBlocks {
            VStack(spacing: SPSpacing.s3) {
                // Minute blocks
                LazyVGrid(
                    columns: [GridItem(.adaptive(minimum: blockSize, maximum: blockSize), spacing: blockSpacing)],
                    spacing: blockSpacing
                ) {
                    ForEach(minuteBlocks) { block in
                        blockView(block)
                    }
                }

                // Divider + "final minute" label
                VStack(spacing: SPSpacing.s1) {
                    Rectangle()
                        .fill(SPColor.border1)
                        .frame(height: 1)

                    Text("FINAL MINUTE")
                        .font(SPFont.mono(11))
                        .foregroundStyle(Color(SPColor.fg4))
                        .tracking(2)

                    // 10-second blocks
                    LazyVGrid(
                        columns: [GridItem(.adaptive(minimum: blockSize, maximum: blockSize), spacing: blockSpacing)],
                        spacing: blockSpacing
                    ) {
                        ForEach(secondBlocks) { block in
                            blockView(block)
                        }
                    }
                }
            }
        } else {
            LazyVGrid(
                columns: [GridItem(.adaptive(minimum: blockSize, maximum: blockSize), spacing: blockSpacing)],
                spacing: blockSpacing
            ) {
                ForEach(blocks) { block in
                    blockView(block)
                }
            }
        }
    }

    @ViewBuilder
    private func blockView(_ block: BlockDef) -> some View {
        let blockEnd = block.startTime + block.duration
        let isFilled = elapsed >= Double(blockEnd)
        let isCurrent = elapsed >= Double(block.startTime)
            && elapsed < Double(blockEnd)
            && elapsed < Double(totalSeconds)
        let progress = isCurrent
            ? (elapsed - Double(block.startTime)) / Double(block.duration)
            : isFilled ? 1.0 : 0.0

        ZStack {
            // Background
            RoundedRectangle(cornerRadius: blockRadius)
                .fill(SPColor.surface1)

            // Fill from bottom
            GeometryReader { geo in
                VStack {
                    Spacer()
                    Rectangle()
                        .fill(isFilled ? LinearGradient.greenFill : LinearGradient.amberFill)
                        .frame(height: geo.size.height * progress)
                        .opacity(isFilled ? 0.85 : 0.7)
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: blockRadius))

            // Label
            Text(block.label)
                .font(SPFont.mono(13, weight: .medium))
                .foregroundStyle(isFilled ? SPColor.overlayText : Color(SPColor.fg4))

            // Current block pulse border
            if isCurrent {
                RoundedRectangle(cornerRadius: blockRadius)
                    .stroke(SPColor.amberDim, lineWidth: 1)
                    .opacity(pulseOpacity())
            }
        }
        .frame(width: blockSize, height: blockSize)
        .overlay(
            RoundedRectangle(cornerRadius: blockRadius)
                .stroke(
                    isFilled ? SPColor.greenBorder :
                    isCurrent ? SPColor.amberBorder :
                    SPColor.border1,
                    lineWidth: 1
                )
        )
    }

    @State private var pulsePhase = false

    private func pulseOpacity() -> Double {
        // Simple alternating pulse
        let _ = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: false) { _ in }
        return 0.7
    }
}
