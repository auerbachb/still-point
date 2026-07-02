import SwiftUI

// MARK: - Capsule button style

enum SPCapsuleButtonColor {
    case neutral
    case amber
    case danger
    case green
    case greenSolid
    case greenGradient
}

enum SPCapsuleButtonSize {
    case compact
    case regular
    case fullWidth
}

struct SPCapsuleButtonStyle: ViewModifier {
    let color: SPCapsuleButtonColor
    let size: SPCapsuleButtonSize
    var prominent: Bool = false
    var tall: Bool = false
    var minHeight: CGFloat?
    var horizontalPadding: CGFloat?
    var stroke: Color?

    func body(content: Content) -> some View {
        content
            .foregroundStyle(foregroundColor)
            .padding(.horizontal, resolvedHorizontalPadding)
            .padding(.vertical, verticalPadding)
            .frame(minHeight: minHeight)
            .frame(maxWidth: size == .fullWidth ? .infinity : nil)
            .background(background)
            .clipShape(Capsule())
            .overlay(strokeOverlay)
    }

    private var foregroundColor: Color {
        switch color {
        case .neutral:
            return prominent ? Color(SPColor.fg) : Color(SPColor.fg3)
        case .amber:
            return SPColor.amberText
        case .danger:
            return SPColor.dangerMuted
        case .green:
            return SPColor.greenText
        case .greenSolid, .greenGradient:
            return Color(SPColor.bg)
        }
    }

    private var resolvedHorizontalPadding: CGFloat {
        if let horizontalPadding { return horizontalPadding }
        switch size {
        case .compact:
            return SPSpacing.s3
        case .regular:
            return SPSpacing.s4
        case .fullWidth:
            return 0
        }
    }

    private var verticalPadding: CGFloat {
        if tall { return SPSpacing.s3 }
        switch size {
        case .compact:
            return SPSpacing.s1
        case .regular, .fullWidth:
            return SPSpacing.s2
        }
    }

    @ViewBuilder
    private var background: some View {
        switch color {
        case .neutral:
            prominent ? SPColor.surface2 : SPColor.surface1
        case .amber:
            SPColor.amberBgFaint
        case .danger:
            SPColor.surface1
        case .green:
            SPColor.greenBgFaint
        case .greenSolid:
            SPColor.green
        case .greenGradient:
            LinearGradient.greenHorizontal
        }
    }

    @ViewBuilder
    private var strokeOverlay: some View {
        if let strokeColor = strokeColor {
            Capsule().stroke(strokeColor)
        }
    }

    private var strokeColor: Color? {
        if let stroke { return stroke }
        switch color {
        case .neutral:
            return prominent ? SPColor.border2 : SPColor.border1
        case .amber:
            return SPColor.amberBorderSubtle
        case .danger:
            return SPColor.dangerBorderSubtle
        case .green:
            return SPColor.greenBorderSubtle
        case .greenSolid, .greenGradient:
            return nil
        }
    }
}

extension View {
    func spCapsuleButtonStyle(
        _ color: SPCapsuleButtonColor,
        size: SPCapsuleButtonSize = .regular,
        prominent: Bool = false,
        tall: Bool = false,
        minHeight: CGFloat? = nil,
        horizontalPadding: CGFloat? = nil,
        stroke: Color? = nil
    ) -> some View {
        modifier(
            SPCapsuleButtonStyle(
                color: color,
                size: size,
                prominent: prominent,
                tall: tall,
                minHeight: minHeight,
                horizontalPadding: horizontalPadding,
                stroke: stroke
            )
        )
    }
}
