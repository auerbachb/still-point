import Foundation

/// Aphorisms content module (#88).
///
/// Short quotes from established meditation teachers and digital-minimalism
/// researchers/authors, shown as optional pre-session inspiration on Home when
/// a user turns on `aphorismsEnabled`. Mirrors `src/lib/aphorisms.ts` on web —
/// keep both lists in sync.
public struct Aphorism: Equatable, Sendable {
    public let text: String
    public let author: String

    public init(text: String, author: String) {
        self.text = text
        self.author = author
    }
}

public enum Aphorisms {
    /// Ordered so `aphorismForDay(_:)` can pick a stable, slowly-rotating quote
    /// per user without any extra state. Order is otherwise not meaningful.
    public static let all: [Aphorism] = [
        Aphorism(text: "You can't stop the waves, but you can learn to surf.", author: "Jon Kabat-Zinn"),
        Aphorism(text: "Wherever you go, there you are.", author: "Jon Kabat-Zinn"),
        Aphorism(
            text: "Feelings come and go like clouds in a windy sky. Conscious breathing is my anchor.",
            author: "Thich Nhat Hanh"
        ),
        Aphorism(
            text: "The present moment is filled with joy and happiness. If you are attentive, you will see it.",
            author: "Thich Nhat Hanh"
        ),
        Aphorism(text: "You are the sky. Everything else is just the weather.", author: "Pema Chödrön"),
        Aphorism(text: "Mindfulness isn't difficult. We just need to remember to do it.", author: "Sharon Salzberg"),
        Aphorism(
            text: "Digital minimalism is a philosophy of technology use in which you focus your online time on a small number of carefully selected activities that strongly support things you value.",
            author: "Cal Newport"
        ),
        Aphorism(
            text: "Solitude is a subjective state in which you're free from input from other minds.",
            author: "Cal Newport"
        ),
        Aphorism(text: "We expect more from technology and less from each other.", author: "Sherry Turkle"),
        Aphorism(text: "The mind is everything. What you think you become.", author: "attributed to the Buddha"),
        Aphorism(text: "Be here now.", author: "Ram Dass"),
    ]

    /// Deterministically pick an aphorism for a given practice day so it stays
    /// stable across re-renders and slowly rotates as the user progresses,
    /// mirroring the pathway's day-driven derivation (#336).
    public static func forDay(_ day: Int) -> Aphorism {
        let safeDay = max(1, day)
        let index = (safeDay - 1) % all.count
        return all[index]
    }
}
