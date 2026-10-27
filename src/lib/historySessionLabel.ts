import type { Session } from "./api";
import { focusSessionLabel } from "./focusActivityContent";

export type HistorySessionLabelInput = {
  sessionType?: Session["sessionType"];
  focusCategory?: Session["focusCategory"];
  /** #769: today's two sits done as one. */
  combined?: boolean;
  /** The sit's place among that day's sits of its type (`buildHistoryJourneyRows`). */
  sessionIndexInDay?: number;
};

/**
 * The label in a History journey row's session column. Quick, breath and focus
 * rows name their type in place of "Session n", and so does a combined sit
 * (#895), which reads "Combined". The combined sit still counts as that day's
 * first standard sit, so a later sit the same day keeps its own "Session 2".
 */
export function historySessionLabel({
  sessionType,
  focusCategory,
  combined,
  sessionIndexInDay,
}: HistorySessionLabelInput): string {
  if (sessionType === "quick") return "Quick";
  if (sessionType === "breath") return "Breath";
  // #837: "Focus · Reading"; a row with no category reads "Focus".
  if (sessionType === "focus") return focusSessionLabel(focusCategory);
  if (combined === true) return "Combined";
  return `Session ${sessionIndexInDay ?? 1}`;
}
