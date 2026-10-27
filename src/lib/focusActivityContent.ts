import { isFocusCategory, type FocusCategory } from "./constants";

/** #837: one focus activity as the picker shows it. */
export type FocusActivityDefinition = {
  id: FocusCategory;
  label: string;
  description: string;
};

/** The picker's cards, in `FOCUS_CATEGORIES` order. Card copy is a first draft. */
export const FOCUS_ACTIVITIES: FocusActivityDefinition[] = [
  {
    id: "reading",
    label: "Reading",
    description: "One book or article, read without switching away.",
  },
  {
    id: "writing",
    label: "Writing",
    description: "One piece of writing: a draft, a journal entry, a letter.",
  },
  {
    id: "listening",
    label: "Listening",
    description: "Music with your eyes closed. Nothing to do but listen.",
  },
];

export function focusActivityById(id: FocusCategory): FocusActivityDefinition {
  const activity = FOCUS_ACTIVITIES.find(a => a.id === id);
  if (!activity) {
    throw new Error(`Unknown focus activity: ${id}`);
  }
  return activity;
}

/**
 * History's label for a focus session: "Focus · Reading". A session with no
 * category (saved before #837) reads "Focus", and so does one whose category
 * this client does not know yet, rather than failing to render.
 */
export function focusSessionLabel(category: string | null | undefined): string {
  return isFocusCategory(category) ? `Focus · ${focusActivityById(category).label}` : "Focus";
}
