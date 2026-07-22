import Foundation

/// Guided exercise scripts and step content (#519).
///
/// Mirrors `src/lib/guidedExerciseContent.ts` — keep both lists in sync.
public enum GuidedExerciseId: String, CaseIterable, Sendable, Codable {
    case progressiveSensory = "progressive-sensory"
    case breathingAwareness = "breathing-awareness"
    case bodyScan = "body-scan"
}

public struct GuidedExerciseStep: Equatable, Sendable {
    public let id: String
    public let title: String
    public let prompt: String
    /// How long this prompt stays before auto-advancing (ms).
    public let durationMs: Int

    public init(id: String, title: String, prompt: String, durationMs: Int) {
        self.id = id
        self.title = title
        self.prompt = prompt
        self.durationMs = durationMs
    }
}

public struct GuidedExerciseDefinition: Equatable, Sendable {
    public let id: GuidedExerciseId
    public let label: String
    public let shortLabel: String
    public let description: String
    public let steps: [GuidedExerciseStep]

    public init(
        id: GuidedExerciseId,
        label: String,
        shortLabel: String,
        description: String,
        steps: [GuidedExerciseStep]
    ) {
        self.id = id
        self.label = label
        self.shortLabel = shortLabel
        self.description = description
        self.steps = steps
    }
}

public enum GuidedExerciseContent {
    /// Default pacing between auto-advances — gentle enough to settle into each prompt.
    public static let guidedStepDurationMs = 45_000

    public static let all: [GuidedExerciseDefinition] = [
        GuidedExerciseDefinition(
            id: .progressiveSensory,
            label: "Progressive sensory",
            shortLabel: "Five senses",
            description: "Notice each sense one at a time, without searching for anything special.",
            steps: [
                GuidedExerciseStep(
                    id: "sight",
                    title: "Sight",
                    prompt: "Let your eyes rest softly. Notice colors, shapes, and light — whatever is present, without fixing on any one thing.",
                    durationMs: guidedStepDurationMs - 5_000
                ),
                GuidedExerciseStep(
                    id: "sound",
                    title: "Sound",
                    prompt: "Bring attention to hearing. Notice near and far sounds, silence between them, and the texture of what you hear.",
                    durationMs: guidedStepDurationMs - 5_000
                ),
                GuidedExerciseStep(
                    id: "smell",
                    title: "Smell",
                    prompt: "Notice scents in the air — subtle or strong. If nothing stands out, rest with the neutral quality of breathing.",
                    durationMs: guidedStepDurationMs - 5_000
                ),
                GuidedExerciseStep(
                    id: "taste",
                    title: "Taste",
                    prompt: "Notice taste in the mouth — lingering flavors or plainness. Let the sensation be as it is.",
                    durationMs: guidedStepDurationMs - 5_000
                ),
                GuidedExerciseStep(
                    id: "touch",
                    title: "Touch",
                    prompt: "Feel contact points: seat, floor, clothing, air on skin. Notice temperature and pressure without adjusting.",
                    durationMs: guidedStepDurationMs - 5_000
                ),
            ]
        ),
        GuidedExerciseDefinition(
            id: .breathingAwareness,
            label: "Breathing awareness",
            shortLabel: "Breath",
            description: "Rest attention on the physical sensation of breathing.",
            steps: [
                GuidedExerciseStep(
                    id: "settle",
                    title: "Settle",
                    prompt: "Allow the body to be still. You do not need to change the breath — simply notice that breathing is happening.",
                    durationMs: guidedStepDurationMs - 20_000
                ),
                GuidedExerciseStep(
                    id: "sensation",
                    title: "Sensation",
                    prompt: "Find where breath is most vivid: nostrils, chest, or belly. Stay with the raw sensation of each inhale and exhale.",
                    durationMs: guidedStepDurationMs + 5_000
                ),
                GuidedExerciseStep(
                    id: "rhythm",
                    title: "Rhythm",
                    prompt: "Follow the natural rhythm. When the mind wanders, gently return to the feeling of air moving in and out.",
                    durationMs: guidedStepDurationMs + 5_000
                ),
                GuidedExerciseStep(
                    id: "full-cycle",
                    title: "Full cycle",
                    prompt: "Notice the beginning, middle, and end of each breath. Rest in the pause between exhale and the next inhale.",
                    durationMs: guidedStepDurationMs + 5_000
                ),
                GuidedExerciseStep(
                    id: "open",
                    title: "Open awareness",
                    prompt: "Let breath stay in the background while awareness widens. The body continues breathing on its own.",
                    durationMs: guidedStepDurationMs - 15_000
                ),
            ]
        ),
        GuidedExerciseDefinition(
            id: .bodyScan,
            label: "Body scan",
            shortLabel: "Body scan",
            description: "Move attention slowly through regions of the body.",
            steps: [
                GuidedExerciseStep(
                    id: "feet",
                    title: "Feet",
                    prompt: "Bring attention to the feet — toes, soles, heels. Notice sensation or the absence of sensation.",
                    durationMs: guidedStepDurationMs - 10_000
                ),
                GuidedExerciseStep(
                    id: "legs",
                    title: "Legs",
                    prompt: "Include calves, knees, and thighs. Feel weight, warmth, tingling, or stillness.",
                    durationMs: guidedStepDurationMs - 10_000
                ),
                GuidedExerciseStep(
                    id: "hips",
                    title: "Hips & pelvis",
                    prompt: "Notice the pelvis and lower back where they meet the seat or floor.",
                    durationMs: guidedStepDurationMs - 10_000
                ),
                GuidedExerciseStep(
                    id: "abdomen",
                    title: "Abdomen",
                    prompt: "Feel the belly rise and fall with breath. Soften any holding in the core.",
                    durationMs: guidedStepDurationMs - 10_000
                ),
                GuidedExerciseStep(
                    id: "chest",
                    title: "Chest",
                    prompt: "Notice the chest and upper back — heartbeat, breath, contact with clothing.",
                    durationMs: guidedStepDurationMs - 10_000
                ),
                GuidedExerciseStep(
                    id: "hands-arms",
                    title: "Hands & arms",
                    prompt: "Scan through fingers, palms, forearms, and upper arms. Let them be heavy or light.",
                    durationMs: guidedStepDurationMs - 10_000
                ),
                GuidedExerciseStep(
                    id: "shoulders-neck",
                    title: "Shoulders & neck",
                    prompt: "Include shoulders, neck, and throat. Release unnecessary tension if you find it.",
                    durationMs: guidedStepDurationMs - 10_000
                ),
                GuidedExerciseStep(
                    id: "face-head",
                    title: "Face & head",
                    prompt: "Notice jaw, cheeks, eyes, forehead, and scalp. Let the face be neutral.",
                    durationMs: guidedStepDurationMs - 10_000
                ),
                GuidedExerciseStep(
                    id: "whole-body",
                    title: "Whole body",
                    prompt: "Feel the entire body at once — a single field of sensation from head to toe.",
                    durationMs: guidedStepDurationMs - 10_000
                ),
            ]
        ),
    ]

    public static func guidedExerciseById(_ id: GuidedExerciseId) -> GuidedExerciseDefinition {
        guard let exercise = all.first(where: { $0.id == id }) else {
            preconditionFailure("Unknown guided exercise: \(id.rawValue)")
        }
        return exercise
    }
}
