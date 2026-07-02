import SwiftUI

// MARK: - Colors (matching globals.css custom properties)

public enum SPColor {
    // Background
    static let bg = Color(red: 26/255, green: 24/255, blue: 22/255)

    // Foreground tiers (warm off-white at different opacities)
    static let fg = Color(red: 232/255, green: 228/255, blue: 222/255).opacity(0.92)
    static let fg2 = Color(red: 232/255, green: 228/255, blue: 222/255).opacity(0.70)
    static let fg3 = Color(red: 232/255, green: 228/255, blue: 222/255).opacity(0.52)
    static let fg4 = Color(red: 232/255, green: 228/255, blue: 222/255).opacity(0.45)

    // Borders
    static let border1 = Color(red: 232/255, green: 228/255, blue: 222/255).opacity(0.08)
    static let border2 = Color(red: 232/255, green: 228/255, blue: 222/255).opacity(0.18)
    static let border3 = Color(red: 232/255, green: 228/255, blue: 222/255).opacity(0.35)

    // Surfaces
    static let surface1 = Color(red: 232/255, green: 228/255, blue: 222/255).opacity(0.04)
    static let surface2 = Color(red: 232/255, green: 228/255, blue: 222/255).opacity(0.06)
    static let surface3 = Color(red: 232/255, green: 228/255, blue: 222/255).opacity(0.10)

    // Green / Clear Mind
    static let green = Color(red: 74/255, green: 222/255, blue: 128/255)
    static let greenEnd = Color(red: 34/255, green: 197/255, blue: 94/255)
    static let greenText = green.opacity(0.6)
    static let greenBorder = green.opacity(0.2)
    static let greenBorderSubtle = green.opacity(0.15)
    static let greenBgSubtle = green.opacity(0.08)
    static let greenBgFaint = green.opacity(0.06)

    // Amber / Thinking
    static let amber = Color(red: 251/255, green: 191/255, blue: 36/255)
    static let amberEnd = Color(red: 245/255, green: 158/255, blue: 11/255)
    static let amberText = amber.opacity(0.6)
    static let amberDim = amber.opacity(0.5)
    static let amberBorder = amber.opacity(0.4)
    static let amberBorderSubtle = amber.opacity(0.2)
    static let amberBg = amber.opacity(0.15)
    static let amberBgFaint = amber.opacity(0.06)

    // Red / Danger (Tailwind red-500 #ef4444)
    static let danger = Color(red: 239/255, green: 68/255, blue: 68/255).opacity(0.7)
    static let dangerMuted = Color(red: 239/255, green: 68/255, blue: 68/255).opacity(0.5)
    static let dangerBorderSubtle = Color(red: 239/255, green: 68/255, blue: 68/255).opacity(0.15)

    // Overlay
    static let overlayText = Color.black.opacity(0.5)
}

// MARK: - Spacing (matching globals.css scale)

public enum SPSpacing {
    static let s1: CGFloat = 8
    static let s2: CGFloat = 12
    static let s3: CGFloat = 16
    static let s4: CGFloat = 24
    static let s5: CGFloat = 32
    static let s6: CGFloat = 48
}

// MARK: - Fonts
//
// System font stacks — no bundled fonts. Web parity uses CSS custom properties
// --font-serif and --font-mono in globals.css.

public enum SPFont {
    /// Serif font for body text, headings, brand
    static func serif(_ size: CGFloat, weight: Font.Weight = .regular) -> Font {
        .system(size: size, design: .serif).weight(weight)
    }

    /// Serif italic for brand lockup and emphasis
    static func serifItalic(_ size: CGFloat, weight: Font.Weight = .regular) -> Font {
        .system(size: size, design: .serif).weight(weight).italic()
    }

    /// Monospace for labels, stats, data
    static func mono(_ size: CGFloat, weight: Font.Weight = .regular) -> Font {
        .system(size: size, design: .monospaced).weight(weight)
    }

    // Common presets
    static let brandTitle = serifItalic(42, weight: .light)
    static let brandSubtitle = mono(13, weight: .light)
    static let dayNumber = mono(100, weight: .ultraLight)
    static let timerDisplay = mono(80, weight: .ultraLight)
    static let statValue = mono(28, weight: .light)
    static let statLabel = mono(11, weight: .regular)
}

// MARK: - View Extensions

extension View {
    /// Apply the Still Point dark background
    func stillPointBackground() -> some View {
        self.background(SPColor.bg.ignoresSafeArea().allowsHitTesting(false))
    }
}

// MARK: - Gradient Helpers

extension LinearGradient {
    static let greenFill = LinearGradient(
        colors: [SPColor.green, SPColor.greenEnd],
        startPoint: .bottom, endPoint: .top
    )

    static let amberFill = LinearGradient(
        colors: [SPColor.amber, SPColor.amberEnd],
        startPoint: .bottom, endPoint: .top
    )

    static let greenHorizontal = LinearGradient(
        colors: [SPColor.green, SPColor.greenEnd],
        startPoint: .leading, endPoint: .trailing
    )

    static let amberHorizontal = LinearGradient(
        colors: [SPColor.amber, SPColor.amberEnd],
        startPoint: .leading, endPoint: .trailing
    )
}
