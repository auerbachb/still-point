/** @vitest-environment jsdom */
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FocusCategoryPicker } from "./FocusCategoryPicker";

/**
 * #837 — the focus category picker: three cards, Cancel and Escape back to
 * Home, and a focus trap that gives focus back to the button that opened it,
 * as the guided-exercise dialog does.
 */

// React 19 requires this flag for `act` to drive effects outside a test renderer.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Props = ComponentProps<typeof FocusCategoryPicker>;

/** Animation frames, run only when a test says so. */
const frames: FrameRequestCallback[] = [];

function runFrames() {
  for (const frame of frames.splice(0)) frame(0);
}

const liveViews: Array<{ unmount: () => Promise<void> }> = [];

async function mount(overrides: Partial<Props> = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root: Root | null = null;
  const props: Props = {
    goalSeconds: 720,
    onChoose: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  };
  await act(async () => {
    root = createRoot(container);
    root.render(createElement(FocusCategoryPicker, props));
  });
  const view = {
    container,
    props,
    unmount: async () => {
      const index = liveViews.indexOf(view);
      if (index >= 0) liveViews.splice(index, 1);
      await act(async () => {
        root?.unmount();
      });
      root = null;
      container.remove();
    },
  };
  liveViews.push(view);
  return view;
}

function dialog(container: HTMLElement): HTMLElement {
  const el = container.querySelector("[role='dialog']");
  if (!(el instanceof HTMLElement)) throw new Error("missing dialog");
  return el;
}

function cancelButton(container: HTMLElement): HTMLButtonElement {
  const el = container.querySelector("button[aria-label='Cancel focus activity']");
  if (!(el instanceof HTMLButtonElement)) throw new Error("missing Cancel");
  return el;
}

function option(container: HTMLElement, id: string): HTMLButtonElement {
  const el = container.querySelector(`[data-testid='focus-activity-option-${id}']`);
  if (!(el instanceof HTMLButtonElement)) throw new Error(`missing option ${id}`);
  return el;
}

/** Stands in for Home's "Focus activity" button, outside the picker. */
function homeButton(): HTMLButtonElement {
  const button = document.createElement("button");
  button.textContent = "Focus activity";
  document.body.appendChild(button);
  return button;
}

/** Presses a key on whatever has focus, the way a keyboard would. */
function press(key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  (document.activeElement ?? document.body).dispatchEvent(event);
  return event;
}

async function click(button: HTMLButtonElement) {
  await act(async () => {
    button.click();
  });
}

beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", (frame: FrameRequestCallback) => {
    frames.push(frame);
    return frames.length;
  });
});

afterEach(async () => {
  for (const view of liveViews.splice(0)) {
    await view.unmount();
  }
  frames.length = 0;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe("FocusCategoryPicker — cards (#837)", () => {
  it("is a modal dialog with the three cards, in order, and the one shared goal", async () => {
    const view = await mount({ goalSeconds: 720 });

    expect(dialog(view.container).getAttribute("aria-modal")).toBe("true");
    const ids = Array.from(
      view.container.querySelectorAll("[data-testid^='focus-activity-option-']"),
      el => el.getAttribute("data-testid"),
    );
    expect(ids).toEqual([
      "focus-activity-option-reading",
      "focus-activity-option-writing",
      "focus-activity-option-listening",
    ]);
    expect(option(view.container, "reading").textContent).toContain("Reading");
    expect(option(view.container, "listening").textContent).toContain("eyes closed");
    expect(view.container.querySelector("[data-testid='focus-category-goal']")?.textContent)
      .toBe("One goal for all three: 12 min. The timer starts when you choose.");
  });

  it("choosing a card reports that category and nothing else", async () => {
    const view = await mount();

    await click(option(view.container, "writing"));

    expect(view.props.onChoose).toHaveBeenCalledTimes(1);
    expect(view.props.onChoose).toHaveBeenCalledWith("writing");
    expect(view.props.onCancel).not.toHaveBeenCalled();
  });
});

describe("FocusCategoryPicker — returning Home (#837)", () => {
  it("Cancel returns Home without a choice", async () => {
    const view = await mount();

    await click(cancelButton(view.container));

    expect(view.props.onCancel).toHaveBeenCalledTimes(1);
    expect(view.props.onChoose).not.toHaveBeenCalled();
  });

  it("Escape returns Home without a choice", async () => {
    const view = await mount();

    let event!: KeyboardEvent;
    await act(async () => {
      event = press("Escape");
    });

    expect(event.defaultPrevented).toBe(true);
    expect(view.props.onCancel).toHaveBeenCalledTimes(1);
    expect(view.props.onChoose).not.toHaveBeenCalled();
  });

  it("Escape still answers after a tap on the backdrop", async () => {
    const view = await mount();
    dialog(view.container).focus();

    await act(async () => {
      press("Escape");
    });

    expect(view.props.onCancel).toHaveBeenCalledTimes(1);
  });
});

describe("FocusCategoryPicker — focus (#837)", () => {
  it("moves focus to Cancel when it opens", async () => {
    const view = await mount();
    expect(document.activeElement).toBe(cancelButton(view.container));
  });

  it("Tab from the last card wraps to Cancel, and Shift+Tab from Cancel to the last card", async () => {
    const view = await mount();
    const cancel = cancelButton(view.container);
    const last = option(view.container, "listening");

    last.focus();
    expect(press("Tab").defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(cancel);

    expect(press("Tab", { shiftKey: true }).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(last);
  });

  it("leaves Tab alone between the controls inside it", async () => {
    const view = await mount();

    option(view.container, "reading").focus();
    expect(press("Tab").defaultPrevented).toBe(false);
    expect(press("Tab", { shiftKey: true }).defaultPrevented).toBe(false);
  });

  it("keeps Tab inside after a tap on the backdrop", async () => {
    const view = await mount();
    const panel = dialog(view.container);

    panel.focus();
    press("Tab");
    expect(document.activeElement).toBe(cancelButton(view.container));

    panel.focus();
    press("Tab", { shiftKey: true });
    expect(document.activeElement).toBe(option(view.container, "listening"));
  });

  it("Cancel gives focus back to the button that opened it, once Home is back", async () => {
    const opener = homeButton();
    opener.focus();

    const view = await mount({ returnFocusRef: { current: opener } });
    expect(document.activeElement).toBe(cancelButton(view.container));

    await click(cancelButton(view.container));
    // The page closes the picker; the opener gets focus on the next frame.
    await view.unmount();
    expect(document.activeElement).not.toBe(opener);
    runFrames();

    expect(document.activeElement).toBe(opener);
  });

  it("gives it back even when the tap that opened it never focused it, as in Safari", async () => {
    const opener = homeButton();
    expect(document.activeElement).toBe(document.body);

    const view = await mount({ returnFocusRef: { current: opener } });
    await click(cancelButton(view.container));
    await view.unmount();
    runFrames();

    expect(document.activeElement).toBe(opener);
  });

  it("Escape gives focus back the same way", async () => {
    const opener = homeButton();

    const view = await mount({ returnFocusRef: { current: opener } });
    await act(async () => {
      press("Escape");
    });
    await view.unmount();
    runFrames();

    expect(document.activeElement).toBe(opener);
  });

  it("choosing a card leaves focus alone: the timer replaces Home", async () => {
    const opener = homeButton();

    const view = await mount({ returnFocusRef: { current: opener } });
    await click(option(view.container, "reading"));
    await view.unmount();

    expect(frames).toHaveLength(0);
    expect(document.activeElement).not.toBe(opener);
  });

  it("a button that has left the page by then is left alone", async () => {
    const opener = homeButton();
    const focusSpy = vi.spyOn(opener, "focus");

    const view = await mount({ returnFocusRef: { current: opener } });
    await click(cancelButton(view.container));
    await view.unmount();
    opener.remove();
    runFrames();

    expect(focusSpy).not.toHaveBeenCalled();
  });

  it("with nowhere to return focus, Cancel only cancels", async () => {
    const view = await mount();

    await click(cancelButton(view.container));
    await view.unmount();
    runFrames();

    expect(view.props.onCancel).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(document.body);
  });
});
