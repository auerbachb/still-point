import SwiftUI

// MARK: - Colors (matching globals.css custom properties)
//
// #30: every token is adaptive. The dark value is the original Still Point palette
// and stays what the app looks like with no appearance override, so an install
// that never touches the theme setting sees no change. The light value is the
// counterpart on a light background. Views need no change: each token resolves
// against the trait collection SwiftUI passes, which `.preferredColorScheme`
// (driven by `ThemeModePreferenceStore`) sets.

extension Color {
    /// One token, two appearances. `UIColor(dynamicProvider:)` picks the light value
    /// only for an explicit light trait; `.unspecified` keeps the dark palette, the
    /// app's original appearance.
    static func adaptive(
        dark: (red: Double, green: Double, blue: Double),
        light: (red: Double, green: Double, blue: Double),
        darkOpacity: Double = 1,
        lightOpacity: Double = 1
    ) -> Color {
        Color(uiColor: UIColor { traits in
            let isLight = traits.userInterfaceStyle == .light
            let value = isLight ? light : dark
            return UIColor(
                red: value.red,
                green: value.green,
                blue: value.blue,
                alpha: isLight ? lightOpacity : darkOpacity
            )
        })
    }
}

/// Ink is the foreground colour. On dark it is warm off-white; on light it is warm
/// near-black, so the same opacity tiers read as foreground on either background.
private enum SPInk {
    static let dark = (red: 232.0 / 255, green: 228.0 / 255, blue: 222.0 / 255)
    static let light = (red: 38.0 / 255, green: 34.0 / 255, blue: 30.0 / 255)
    static let base = Color.adaptive(dark: dark, light: light)
}

public enum SPColor {
    // Background
    static let bg = Color.adaptive(
        dark: (red: 26 / 255, green: 24 / 255, blue: 22 / 255),
        light: (red: 247 / 255, green: 245 / 255, blue: 241 / 255)
    )

    // Foreground tiers (warm ink at different opacities)
    static let fg = SPInk.base.opacity(0.92)
    static let fg2 = SPInk.base.opacity(0.70)
    // Light tiers are raised so 13-point secondary text keeps 4.5:1 on the light
    // background; the dark tiers are the original values.
    static let fg3 = Color.adaptive(
        dark: SPInk.dark, light: SPInk.light, darkOpacity: 0.52, lightOpacity: 0.70
    )
    static let fg4 = Color.adaptive(
        dark: SPInk.dark, light: SPInk.light, darkOpacity: 0.45, lightOpacity: 0.68
    )

    // Borders
    static let border1 = SPInk.base.opacity(0.08)
    static let border2 = SPInk.base.opacity(0.18)
    static let border3 = SPInk.base.opacity(0.35)

    // Surfaces
    static let surface1 = SPInk.base.opacity(0.04)
    static let surface2 = SPInk.base.opacity(0.06)
    static let surface3 = SPInk.base.opacity(0.10)

    // Green / Clear Mind. The light values are darker so the text tints keep contrast
    // on a light background.
    static let green = Color.adaptive(
        dark: (red: 74 / 255, green: 222 / 255, blue: 128 / 255),
        light: (red: 16 / 255, green: 110 / 255, blue: 52 / 255)
    )
    static let greenEnd = Color.adaptive(
        dark: (red: 34 / 255, green: 197 / 255, blue: 94 / 255),
        light: (red: 15 / 255, green: 118 / 255, blue: 55 / 255)
    )
    // Text tints are opaque on light: 0.6 opacity fell below 3:1 on the light background.
    static let greenText = Color.adaptive(
        dark: (red: 74 / 255, green: 222 / 255, blue: 128 / 255),
        light: (red: 16 / 255, green: 110 / 255, blue: 52 / 255),
        darkOpacity: 0.6
    )
    static let greenBorder = green.opacity(0.2)
    static let greenBorderSubtle = green.opacity(0.15)
    static let greenBgSubtle = green.opacity(0.08)
    static let greenBgFaint = green.opacity(0.06)

    // Amber / Thinking
    static let amber = Color.adaptive(
        dark: (red: 251 / 255, green: 191 / 255, blue: 36 / 255),
        light: (red: 140 / 255, green: 86 / 255, blue: 0)
    )
    static let amberEnd = Color.adaptive(
        dark: (red: 245 / 255, green: 158 / 255, blue: 11 / 255),
        light: (red: 125 / 255, green: 76 / 255, blue: 0)
    )
    static let amberText = Color.adaptive(
        dark: (red: 251 / 255, green: 191 / 255, blue: 36 / 255),
        light: (red: 140 / 255, green: 86 / 255, blue: 0),
        darkOpacity: 0.6
    )
    static let amberDim = amber.opacity(0.5)
    static let amberBorder = amber.opacity(0.4)
    static let amberBorderSubtle = amber.opacity(0.2)
    static let amberBg = amber.opacity(0.15)
    static let amberBgFaint = amber.opacity(0.06)

    // Red / Danger (dark: Tailwind red-500 #ef4444; light: a deeper red)
    static let danger = Color.adaptive(
        dark: (red: 239 / 255, green: 68 / 255, blue: 68 / 255),
        light: (red: 185 / 255, green: 28 / 255, blue: 28 / 255),
        darkOpacity: 0.7
    )
    static let dangerMuted = Color.adaptive(
        dark: (red: 239 / 255, green: 68 / 255, blue: 68 / 255),
        light: (red: 153 / 255, green: 22 / 255, blue: 22 / 255),
        darkOpacity: 0.5,
        lightOpacity: 0.85
    )
    static let dangerBorderSubtle = Color.adaptive(
        dark: (red: 239 / 255, green: 68 / 255, blue: 68 / 255),
        light: (red: 185 / 255, green: 28 / 255, blue: 28 / 255)
    ).opacity(0.15)

    // Overlay
    // Label drawn over a filled block. Dark stays black at 0.5 (web `--overlay-text`).
    // Light is opaque black: 50% black over the light green fill was about 2.6:1.
    static let overlayText = Color.adaptive(
        dark: (red: 0, green: 0, blue: 0),
        light: (red: 0, green: 0, blue: 0),
        darkOpacity: 0.5
    )
}

extension SPColor {
    /// Label on a partly filled current block, which sits over the light amber fill.
    /// Dark matches `fg4` exactly. Light is raised so the label keeps 4.5:1 on both
    /// ends of the fill gradient. Block-grid only, so it has no web counterpart and
    /// lives outside the parity-checked `SPColor` enum.
    static let blockLabelOnFill = Color.adaptive(
        dark: SPInk.dark,
        light: SPInk.light,
        darkOpacity: 0.45,
        lightOpacity: 0.92
    )
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
    // Block fills keep their original light colours. Fills carry labels rather than
    // text, so they are not darkened with the text tints; the labels are checked
    // against these exact fills in the contrast table (#30).
    static let greenFill = LinearGradient(
        colors: [
            Color.adaptive(
                dark: (red: 74 / 255, green: 222 / 255, blue: 128 / 255),
                light: (red: 21 / 255, green: 128 / 255, blue: 61 / 255)
            ),
            Color.adaptive(
                dark: (red: 34 / 255, green: 197 / 255, blue: 94 / 255),
                light: (red: 15 / 255, green: 118 / 255, blue: 55 / 255)
            ),
        ],
        startPoint: .bottom, endPoint: .top
    )

    static let amberFill = LinearGradient(
        colors: [
            Color.adaptive(
                dark: (red: 251 / 255, green: 191 / 255, blue: 36 / 255),
                light: (red: 180 / 255, green: 110 / 255, blue: 0)
            ),
            Color.adaptive(
                dark: (red: 245 / 255, green: 158 / 255, blue: 11 / 255),
                light: (red: 161 / 255, green: 98 / 255, blue: 7 / 255)
            ),
        ],
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
