/**
 * Aphorisms content module (#88).
 *
 * Short quotes from established meditation teachers and digital-minimalism
 * researchers/authors, shown as optional pre-session inspiration on Home when
 * a user turns on `aphorismsEnabled`. Kept intentionally small and dependency
 * free so it can be mirrored verbatim in the iOS app (`StillPointShared`).
 */

export type Aphorism = {
  text: string;
  author: string;
};

/**
 * Ordered so `aphorismForDay` can pick a stable, slowly-rotating quote per
 * user without any extra state. Order is otherwise not meaningful.
 */
export const APHORISMS: Aphorism[] = [
  { text: "You can't stop the waves, but you can learn to surf.", author: "Jon Kabat-Zinn" },
  { text: "Wherever you go, there you are.", author: "Jon Kabat-Zinn" },
  {
    text: "Feelings come and go like clouds in a windy sky. Conscious breathing is my anchor.",
    author: "Thich Nhat Hanh",
  },
  {
    text: "The present moment is filled with joy and happiness. If you are attentive, you will see it.",
    author: "Thich Nhat Hanh",
  },
  { text: "You are the sky. Everything else is just the weather.", author: "Pema Chödrön" },
  { text: "Mindfulness isn't difficult. We just need to remember to do it.", author: "Sharon Salzberg" },
  {
    text: "Digital minimalism is a philosophy of technology use in which you focus your online time on a small number of carefully selected activities that strongly support things you value.",
    author: "Cal Newport",
  },
  {
    text: "Solitude is a subjective state in which you're free from input from other minds.",
    author: "Cal Newport",
  },
  { text: "We expect more from technology and less from each other.", author: "Sherry Turkle" },
  { text: "The mind is everything. What you think you become.", author: "attributed to the Buddha" },
  { text: "Be here now.", author: "Ram Dass" },
];

/**
 * Deterministically pick an aphorism for a given practice day so it stays
 * stable across re-renders and slowly rotates as the user progresses,
 * mirroring the pathway's day-driven derivation (#336).
 */
export function aphorismForDay(day: number): Aphorism {
  const safeDay = Number.isFinite(day) ? Math.max(1, Math.floor(day)) : 1;
  const index = (safeDay - 1) % APHORISMS.length;
  return APHORISMS[index]!;
}
