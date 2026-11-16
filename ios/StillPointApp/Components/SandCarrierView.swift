import Foundation
import StillPointShared
import SwiftUI

/// #1190: the sit as a small carrier moving sand from a source pile to a destination
/// pile. iOS port of `src/components/SandCarrier.tsx` (#662 web v1).
///
/// Every position comes from `SandProgress.progress(elapsed:total:)`, so there is no
/// animation loop, no `withAnimation`, and no `TimelineView`. The session's elapsed
/// value redraws the scene, a paused sit holds still, and a wall-clock jump moves the
/// scene to the right place.
///
/// With Reduce Motion on, the piles keep their correct sizes, the carrier stands
/// empty-handed at the route midpoint, and the walk bob is removed (matching web).
///
/// Decorative: the session timer keeps the accessible "Time remaining" label.
struct SandCarrierView: View {
    let elapsed: Double
    let totalSeconds: Double

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    // Web proportions, in the 320 x 110 SVG coordinate space of SandCarrier.tsx.
    private static let viewWidth: CGFloat = 320
    private static let viewHeight: CGFloat = 110
    private static let groundY: CGFloat = 96
    private static let pileMaxHeight: CGFloat = 56
    private static let pileWidth: CGFloat = 96
    private static let sourceCenterX: CGFloat = 60
    private static let destinationCenterX: CGFloat = 260
    private static let routeStartX: CGFloat = 92
    private static let routeEndX: CGFloat = 228
    private static let bobHeight: CGFloat = 2

    var body: some View {
        let state = SandProgress.progress(elapsed: elapsed, total: totalSeconds)
        let carrierPosition = reduceMotion ? 0.5 : state.carrierPosition
        let carrying = reduceMotion ? false : state.carrying
        let bob = carrying ? CGFloat(abs(sin(state.walkPhase * .pi))) * Self.bobHeight : 0
        let sourceHeight = CGFloat(state.sourceFraction) * Self.pileMaxHeight
        let destinationHeight = CGFloat(state.destinationFraction) * Self.pileMaxHeight
        let carrierX = Self.routeStartX + CGFloat(carrierPosition) * (Self.routeEndX - Self.routeStartX)
        let headY = Self.groundY - 30 - bob

        Canvas { context, size in
            let scale = size.width / Self.viewWidth

            func rect(_ x: CGFloat, _ y: CGFloat, _ width: CGFloat, _ height: CGFloat) -> CGRect {
                CGRect(x: x * scale, y: y * scale, width: width * scale, height: height * scale)
            }

            // Ground line
            var ground = Path()
            ground.move(to: CGPoint(x: 0, y: Self.groundY * scale))
            ground.addLine(to: CGPoint(x: size.width, y: Self.groundY * scale))
            context.stroke(ground, with: .color(SPColor.border2), lineWidth: max(1, scale))

            // Source pile (amber) shrinks as sand leaves
            let sourceRect = rect(
                Self.sourceCenterX - Self.pileWidth / 2,
                Self.groundY - sourceHeight,
                Self.pileWidth,
                sourceHeight
            )
            context.fill(
                Path(roundedRect: sourceRect, cornerRadius: 8 * scale),
                with: .color(SPColor.amber.opacity(0.6))
            )

            // Destination pile (green) grows as sand arrives
            let destinationRect = rect(
                Self.destinationCenterX - Self.pileWidth / 2,
                Self.groundY - destinationHeight,
                Self.pileWidth,
                destinationHeight
            )
            context.fill(
                Path(roundedRect: destinationRect, cornerRadius: 8 * scale),
                with: .color(SPColor.green.opacity(0.6))
            )

            // Carrier, drawn in its own translated space
            let centerX = carrierX * scale
            if carrying {
                let loadRect = rect(carrierX - 6, headY - 14, 12, 6)
                context.fill(
                    Path(roundedRect: loadRect, cornerRadius: 2 * scale),
                    with: .color(SPColor.amber.opacity(0.8))
                )
            }
            let headRadius = 5 * scale
            let headCenter = CGPoint(x: centerX, y: headY * scale)
            context.fill(
                Path(ellipseIn: CGRect(
                    x: headCenter.x - headRadius,
                    y: headCenter.y - headRadius,
                    width: headRadius * 2,
                    height: headRadius * 2
                )),
                with: .color(SPColor.fg2)
            )
            let bodyRect = rect(carrierX - 5, headY + 6, 10, 16)
            context.fill(
                Path(roundedRect: bodyRect, cornerRadius: 4 * scale),
                with: .color(SPColor.fg3)
            )
        }
        .frame(maxWidth: Self.viewWidth)
        .aspectRatio(Self.viewWidth / Self.viewHeight, contentMode: .fit)
        .frame(maxWidth: .infinity)
        .accessibilityHidden(true)
    }
}
