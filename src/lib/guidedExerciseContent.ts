export type GuidedExerciseId = "progressive-sensory" | "breathing-awareness" | "body-scan";

export type GuidedExerciseStep = {
  id: string;
  title: string;
  prompt: string;
  /** How long this prompt stays before auto-advancing (ms). */
  durationMs: number;
};

export type GuidedExerciseDefinition = {
  id: GuidedExerciseId;
  label: string;
  shortLabel: string;
  description: string;
  steps: GuidedExerciseStep[];
};

/** Default pacing between auto-advances — gentle enough to settle into each prompt. */
export const GUIDED_STEP_DURATION_MS = 45_000;

const SENSORY_STEP_MS = 40_000;
const BREATH_STEP_MS = 50_000;
const BODY_SCAN_STEP_MS = 35_000;

export const GUIDED_EXERCISES: GuidedExerciseDefinition[] = [
  {
    id: "progressive-sensory",
    label: "Progressive sensory",
    shortLabel: "Five senses",
    description: "Notice each sense one at a time, without searching for anything special.",
    steps: [
      {
        id: "sight",
        title: "Sight",
        prompt:
          "Let your eyes rest softly. Notice colors, shapes, and light — whatever is present, without fixing on any one thing.",
        durationMs: SENSORY_STEP_MS,
      },
      {
        id: "sound",
        title: "Sound",
        prompt:
          "Bring attention to hearing. Notice near and far sounds, silence between them, and the texture of what you hear.",
        durationMs: SENSORY_STEP_MS,
      },
      {
        id: "smell",
        title: "Smell",
        prompt:
          "Notice scents in the air — subtle or strong. If nothing stands out, rest with the neutral quality of breathing.",
        durationMs: SENSORY_STEP_MS,
      },
      {
        id: "taste",
        title: "Taste",
        prompt:
          "Notice taste in the mouth — lingering flavors or plainness. Let the sensation be as it is.",
        durationMs: SENSORY_STEP_MS,
      },
      {
        id: "touch",
        title: "Touch",
        prompt:
          "Feel contact points: seat, floor, clothing, air on skin. Notice temperature and pressure without adjusting.",
        durationMs: SENSORY_STEP_MS,
      },
    ],
  },
  {
    id: "breathing-awareness",
    label: "Breathing awareness",
    shortLabel: "Breath",
    description: "Rest attention on the physical sensation of breathing.",
    steps: [
      {
        id: "settle",
        title: "Settle",
        prompt:
          "Allow the body to be still. You do not need to change the breath — simply notice that breathing is happening.",
        durationMs: 25_000,
      },
      {
        id: "sensation",
        title: "Sensation",
        prompt:
          "Find where breath is most vivid: nostrils, chest, or belly. Stay with the raw sensation of each inhale and exhale.",
        durationMs: BREATH_STEP_MS,
      },
      {
        id: "rhythm",
        title: "Rhythm",
        prompt:
          "Follow the natural rhythm. When the mind wanders, gently return to the feeling of air moving in and out.",
        durationMs: BREATH_STEP_MS,
      },
      {
        id: "full-cycle",
        title: "Full cycle",
        prompt:
          "Notice the beginning, middle, and end of each breath. Rest in the pause between exhale and the next inhale.",
        durationMs: BREATH_STEP_MS,
      },
      {
        id: "open",
        title: "Open awareness",
        prompt:
          "Let breath stay in the background while awareness widens. The body continues breathing on its own.",
        durationMs: 30_000,
      },
    ],
  },
  {
    id: "body-scan",
    label: "Body scan",
    shortLabel: "Body scan",
    description: "Move attention slowly through regions of the body.",
    steps: [
      {
        id: "feet",
        title: "Feet",
        prompt: "Bring attention to the feet — toes, soles, heels. Notice sensation or the absence of sensation.",
        durationMs: BODY_SCAN_STEP_MS,
      },
      {
        id: "legs",
        title: "Legs",
        prompt: "Include calves, knees, and thighs. Feel weight, warmth, tingling, or stillness.",
        durationMs: BODY_SCAN_STEP_MS,
      },
      {
        id: "hips",
        title: "Hips & pelvis",
        prompt: "Notice the pelvis and lower back where they meet the seat or floor.",
        durationMs: BODY_SCAN_STEP_MS,
      },
      {
        id: "abdomen",
        title: "Abdomen",
        prompt: "Feel the belly rise and fall with breath. Soften any holding in the core.",
        durationMs: BODY_SCAN_STEP_MS,
      },
      {
        id: "chest",
        title: "Chest",
        prompt: "Notice the chest and upper back — heartbeat, breath, contact with clothing.",
        durationMs: BODY_SCAN_STEP_MS,
      },
      {
        id: "hands-arms",
        title: "Hands & arms",
        prompt: "Scan through fingers, palms, forearms, and upper arms. Let them be heavy or light.",
        durationMs: BODY_SCAN_STEP_MS,
      },
      {
        id: "shoulders-neck",
        title: "Shoulders & neck",
        prompt: "Include shoulders, neck, and throat. Release unnecessary tension if you find it.",
        durationMs: BODY_SCAN_STEP_MS,
      },
      {
        id: "face-head",
        title: "Face & head",
        prompt: "Notice jaw, cheeks, eyes, forehead, and scalp. Let the face be neutral.",
        durationMs: BODY_SCAN_STEP_MS,
      },
      {
        id: "whole-body",
        title: "Whole body",
        prompt: "Feel the entire body at once — a single field of sensation from head to toe.",
        durationMs: BODY_SCAN_STEP_MS,
      },
    ],
  },
];

export function guidedExerciseById(id: GuidedExerciseId): GuidedExerciseDefinition {
  const exercise = GUIDED_EXERCISES.find(e => e.id === id);
  if (!exercise) {
    throw new Error(`Unknown guided exercise: ${id}`);
  }
  return exercise;
}
