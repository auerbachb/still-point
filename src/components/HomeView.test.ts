/** @vitest-environment jsdom */
/**
 * Issue #895 — Home's "Combine today's sits" action and its inline
 * confirmation. These drive the real component the way the page wires it:
 * `combineOffered` comes from `isCombineOffered` over the same done-today flags
 * the track cards' badges show, as `page.tsx` computes it.
 */
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi, type Mock } from "vitest";
import { isCombineOffered } from "@/lib/combinedSit";
import { activeRecovery, type RecoveryFields } from "@/lib/duration";
import { HomeView } from "./HomeView";

// React 19 requires this flag for `act` to drive effects outside a test renderer.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Props = ComponentProps<typeof HomeView>;

const NO_RECOVERY: RecoveryFields = {
  recoveryTargetDay: null,
  recoveryCurrentStep: null,
  recoveryTotalSteps: null,
};

const RECOVERING: RecoveryFields = {
  recoveryTargetDay: 30,
  recoveryCurrentStep: 2,
  recoveryTotalSteps: 5,
};

/** The account state Home is drawn from. */
type HomeState = {
  dualTrackEnabled: boolean;
  primaryDoneToday: boolean;
  secondDoneToday: boolean;
  recovery: RecoveryFields;
};

const BOTH_DUE: HomeState = {
  dualTrackEnabled: true,
  primaryDoneToday: false,
  secondDoneToday: false,
  recovery: NO_RECOVERY,
};

const ACTION = "Combine today's sits";
const TITLE = "Combine today's sits?";
const ADVICE =
  "Splitting your sits is better. Two separate sits suit your practice more than one long one, so combine only if you can't sit twice today.";

/** HomeView's props for `state`, wired as `page.tsx` wires them. */
function propsFor(state: HomeState, overrides: Partial<Props> = {}): Props {
  return {
    // Track One at the 10-minute cap (600 s) and Track Two on day 20 (250 s).
    currentDay: 200,
    secondTrackDay: 20,
    dualTrackEnabled: state.dualTrackEnabled,
    primaryDoneToday: state.primaryDoneToday,
    secondDoneToday: state.secondDoneToday,
    recovery: state.recovery,
    combineOffered: isCombineOffered({
      dualTrackEnabled: state.dualTrackEnabled,
      primaryDoneToday: state.primaryDoneToday,
      secondDoneToday: state.secondDoneToday,
      recoveryActive: activeRecovery(state.recovery) !== null,
    }),
    combinedDuration: 850,
    onCombineSessions: vi.fn(),
    onBegin: vi.fn(),
    onBeginSecond: vi.fn(),
    onQuickBegin: vi.fn(),
    ...overrides,
  };
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let scrollIntoView: Mock<Element["scrollIntoView"]>;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  // jsdom has no scrollIntoView; the panel calls it when it opens.
  scrollIntoView = vi.fn<Element["scrollIntoView"]>();
  Element.prototype.scrollIntoView = scrollIntoView;
});

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  container?.remove();
  root = null;
  container = null;
  document.body.replaceChildren();
  delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  vi.restoreAllMocks();
});

async function render(props: Props): Promise<void> {
  await act(async () => {
    root!.render(createElement(HomeView, props));
  });
}

function buttons(): HTMLButtonElement[] {
  return [...container!.querySelectorAll("button")];
}

function buttonNamed(name: string): HTMLButtonElement | undefined {
  return buttons().find(button => button.textContent === name);
}

function requireButton(name: string): HTMLButtonElement {
  const button = buttonNamed(name);
  if (!button) throw new Error(`missing button "${name}"`);
  return button;
}

function panel(): HTMLElement | null {
  return container!.querySelector<HTMLElement>("[role='dialog']");
}

function requirePanel(): HTMLElement {
  const el = panel();
  if (!el) throw new Error("missing confirmation panel");
  return el;
}

/** The card a track's day readout sits in, found by its label. */
function trackCard(label: string): HTMLElement {
  const labelEl = [...container!.querySelectorAll("span")].find(span => span.textContent === label);
  const card = labelEl?.parentElement?.parentElement;
  if (!card) throw new Error(`missing card "${label}"`);
  return card;
}

async function click(button: HTMLButtonElement): Promise<void> {
  await act(async () => {
    button.click();
  });
}

/** Presses a key on whatever has focus, the way a keyboard would. */
async function press(key: string): Promise<void> {
  await act(async () => {
    (document.activeElement ?? document.body).dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
    );
  });
}

async function openConfirmation(): Promise<HTMLElement> {
  await click(requireButton(ACTION));
  return requirePanel();
}

describe("HomeView combine action — when it shows (#895)", () => {
  test("never shows for a single-track account, even with the offer and a handler passed", async () => {
    await render(propsFor({ ...BOTH_DUE, dualTrackEnabled: false }));
    expect(buttonNamed(ACTION)).toBeUndefined();

    // Out of the single-track branch altogether, not merely gated on the flag.
    await render(propsFor({ ...BOTH_DUE, dualTrackEnabled: false }, { combineOffered: true }));
    expect(buttonNamed(ACTION)).toBeUndefined();
    expect(panel()).toBeNull();
  });

  test("is absent when either track is done today", async () => {
    await render(propsFor({ ...BOTH_DUE, primaryDoneToday: true }));
    expect(buttonNamed(ACTION)).toBeUndefined();

    await render(propsFor({ ...BOTH_DUE, secondDoneToday: true }));
    expect(buttonNamed(ACTION)).toBeUndefined();
  });

  test("is absent while a recovery ramp is running", async () => {
    await render(propsFor({ ...BOTH_DUE, recovery: RECOVERING }));
    expect(buttonNamed(ACTION)).toBeUndefined();
  });

  test("is absent, not disabled, without a handler", async () => {
    await render(propsFor(BOTH_DUE, { onCombineSessions: undefined }));
    expect(buttonNamed(ACTION)).toBeUndefined();
  });

  test("shows directly under Track Two's card when both tracks are due", async () => {
    await render(propsFor(BOTH_DUE));

    const action = requireButton(ACTION);
    expect(action.disabled).toBe(false);
    expect(action.previousElementSibling).toBe(trackCard("Track Two"));
  });

  test("is a quiet text button in smaller type than the cards' Begin", async () => {
    await render(propsFor(BOTH_DUE));

    const action = requireButton(ACTION);
    const begin = buttons().find(button => button.textContent === "Begin")!;
    expect(action.style.background).toBe("none");
    expect(action.style.borderStyle).toBe("none");
    expect(action.style.borderRadius).toBe("");
    expect(parseFloat(action.style.fontSize)).toBeLessThan(parseFloat(begin.style.fontSize));
  });
});

describe("HomeView combine confirmation (#895)", () => {
  test("the action opens an inline confirmation with the decided copy and starts nothing", async () => {
    const confirm = vi.spyOn(window, "confirm");
    const props = propsFor(BOTH_DUE);
    await render(props);

    const dialog = await openConfirmation();

    expect(props.onCombineSessions).not.toHaveBeenCalled();
    expect(props.onBegin).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
    expect(dialog.querySelector("h2")?.textContent).toBe(TITLE);
    const paragraphs = [...dialog.querySelectorAll("p")].map(p => p.textContent);
    expect(paragraphs).toEqual([ADVICE, "This will be one 14:10 sit, and it counts for both tracks."]);
    // Named by its title and described by both paragraphs, for a screen reader.
    expect(document.getElementById(dialog.getAttribute("aria-labelledby")!)?.textContent).toBe(TITLE);
    const described = dialog.getAttribute("aria-describedby")!.split(" ").map(id => document.getElementById(id)?.textContent);
    expect(described).toEqual(paragraphs);
    // The panel takes the action's place under Track Two's card.
    expect(buttonNamed(ACTION)).toBeUndefined();
    expect(dialog.previousElementSibling).toBe(trackCard("Track Two"));
  });

  test("offers Keep them separate first and prominently, Combine anyway after it, quietly", async () => {
    await render(propsFor(BOTH_DUE));
    const dialog = await openConfirmation();

    const [keep, combine] = [...dialog.querySelectorAll("button")];
    expect(keep?.textContent).toBe("Keep them separate");
    expect(combine?.textContent).toBe("Combine anyway");
    expect(keep!.style.border).toBe("1px solid var(--border-2)");
    expect(keep!.style.background).toBe("var(--surface-2)");
    expect(combine!.style.borderStyle).toBe("none");
    expect(combine!.style.background).toBe("none");
    expect(parseFloat(combine!.style.fontSize)).toBeLessThan(parseFloat(keep!.style.fontSize));
  });

  test("moves focus into the panel, onto Keep them separate", async () => {
    await render(propsFor(BOTH_DUE));
    await openConfirmation();

    expect(document.activeElement).toBe(requireButton("Keep them separate"));
  });

  test("brings the whole panel into view as it opens", async () => {
    await render(propsFor(BOTH_DUE));
    const dialog = await openConfirmation();

    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
    expect(scrollIntoView.mock.contexts[0]).toBe(dialog);
  });

  test("Keep them separate closes it, starts nothing and puts focus back on the action", async () => {
    const props = propsFor(BOTH_DUE);
    await render(props);
    await openConfirmation();

    await click(requireButton("Keep them separate"));

    expect(panel()).toBeNull();
    expect(props.onCombineSessions).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(requireButton(ACTION));
  });

  test("Escape closes it, starts nothing and puts focus back on the action", async () => {
    const props = propsFor(BOTH_DUE);
    await render(props);
    await openConfirmation();

    await press("Escape");

    expect(panel()).toBeNull();
    expect(props.onCombineSessions).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(requireButton(ACTION));
  });

  test("Escape still closes it once a tap on its text has moved focus to the panel", async () => {
    const props = propsFor(BOTH_DUE);
    await render(props);
    const dialog = await openConfirmation();

    // A tap on the panel's text focuses the panel itself (tabIndex -1).
    await act(async () => {
      dialog.focus();
    });
    expect(document.activeElement).toBe(dialog);
    await press("Escape");

    expect(panel()).toBeNull();
    expect(props.onCombineSessions).not.toHaveBeenCalled();
  });

  test("other keys leave it open", async () => {
    await render(propsFor(BOTH_DUE));
    await openConfirmation();

    await press("Enter");
    await press("a");

    expect(panel()).not.toBeNull();
  });

  test("Combine anyway starts the combined sit exactly once", async () => {
    const props = propsFor(BOTH_DUE);
    await render(props);
    await openConfirmation();

    await click(requireButton("Combine anyway"));

    expect(props.onCombineSessions).toHaveBeenCalledTimes(1);
    expect(props.onBegin).not.toHaveBeenCalled();
    expect(props.onBeginSecond).not.toHaveBeenCalled();
    // Closed, so the button cannot be pressed a second time.
    expect(buttonNamed("Combine anyway")).toBeUndefined();
  });

  test.each([
    [850, "14:10"],
    [660, "11:00"],
    [1200, "20:00"],
  ])("shows a %i s combined sit as %s", async (seconds, shown) => {
    await render(propsFor(BOTH_DUE, { combinedDuration: seconds }));
    const dialog = await openConfirmation();

    expect(dialog.textContent).toContain(`This will be one ${shown} sit, and it counts for both tracks.`);
  });

  test("closes by itself when the offer goes away while it is open, and comes back closed", async () => {
    const props = propsFor(BOTH_DUE);
    await render(props);
    await openConfirmation();

    // A refresh shows Track Two done today.
    await render(propsFor({ ...BOTH_DUE, secondDoneToday: true }, { onCombineSessions: props.onCombineSessions }));
    expect(panel()).toBeNull();
    expect(buttonNamed(ACTION)).toBeUndefined();

    // Offered again later, it starts closed.
    await render(propsFor(BOTH_DUE, { onCombineSessions: props.onCombineSessions }));
    expect(panel()).toBeNull();
    expect(buttonNamed(ACTION)).toBeDefined();
    expect(props.onCombineSessions).not.toHaveBeenCalled();
  });
});
