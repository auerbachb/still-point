/** @vitest-environment jsdom */
import { describe, expect, test } from "vitest";
import {
  computeClearPercentFromLog,
  createInitialMindHoldKeyboardState,
  isCommaHoldKey,
  isMindStateTypingTarget,
  isSpaceHoldKey,
  recordHoldSegment,
  reduceMindHoldKeyDown,
  reduceMindHoldKeyUp,
} from "./mindStateSession";
import { loadSharedFixture, type ClearPercentFixture } from "./testing/sharedFixtures";

// Cross-platform parity: validates the web clear-percent against the shared golden
// set that iOS SessionLogic.calculateClearPercent also asserts (#421). Drift between
// the two duplicated implementations breaks CI on at least one platform.
describe("computeClearPercentFromLog — shared fixtures", () => {
  const fixture = loadSharedFixture<ClearPercentFixture>("clearPercent.json");

  test.each(fixture.cases)("$name", ({ log, endTime, expected }) => {
    expect(computeClearPercentFromLog(log, endTime)).toBe(expected);
  });
});

describe("isMindStateTypingTarget", () => {
  test("ignores non-element targets", () => {
    expect(isMindStateTypingTarget(null)).toBe(false);
    expect(isMindStateTypingTarget(document)).toBe(false);
  });

  test("blocks input, textarea, select, and contenteditable", () => {
    expect(isMindStateTypingTarget(document.createElement("input"))).toBe(true);
    expect(isMindStateTypingTarget(document.createElement("textarea"))).toBe(true);
    expect(isMindStateTypingTarget(document.createElement("select"))).toBe(true);
    const editable = document.createElement("div");
    editable.contentEditable = "true";
    Object.defineProperty(editable, "isContentEditable", { value: true });
    expect(isMindStateTypingTarget(editable)).toBe(true);
  });

  test("blocks descendants of data-no-space-distraction", () => {
    const wrapper = document.createElement("div");
    wrapper.setAttribute("data-no-space-distraction", "");
    const child = document.createElement("span");
    wrapper.appendChild(child);
    expect(isMindStateTypingTarget(child)).toBe(true);
  });

  test("allows ordinary session chrome", () => {
    expect(isMindStateTypingTarget(document.createElement("button"))).toBe(false);
  });
});

describe("hold key detection", () => {
  test("matches Space and Comma keyboard events", () => {
    expect(isSpaceHoldKey({ code: "Space", key: " " })).toBe(true);
    expect(isCommaHoldKey({ code: "Comma", key: "," })).toBe(true);
    expect(isCommaHoldKey({ code: "", key: "," })).toBe(true);
  });

  test("does not cross-match unrelated keys", () => {
    expect(isSpaceHoldKey({ code: "Comma", key: "," })).toBe(false);
    expect(isCommaHoldKey({ code: "Space", key: " " })).toBe(false);
  });
});

describe("reduceMindHoldKeyDown / reduceMindHoldKeyUp", () => {
  test("comma hold begins hyperfocus and suppresses default", () => {
    let state = createInitialMindHoldKeyboardState();
    const down = reduceMindHoldKeyDown(state, { code: "Comma", key: ",", repeat: false, target: document.body });
    expect(down.effects).toEqual([{ type: "preventDefault" }, { type: "beginHyperfocus" }]);
    expect(down.state.holdKind).toBe("commaHyperfocus");
    expect(down.state.commaDown).toBe(true);

    const up = reduceMindHoldKeyUp(down.state, { code: "Comma", key: "," });
    expect(up.effects).toEqual([{ type: "preventDefault" }, { type: "endHold" }]);
    expect(up.state.holdKind).toBe("none");
    expect(up.state.commaDown).toBe(false);
  });

  test("space hold mirrors distraction path", () => {
    let state = createInitialMindHoldKeyboardState();
    const down = reduceMindHoldKeyDown(state, { code: "Space", key: " ", repeat: false, target: document.body });
    expect(down.effects).toEqual([{ type: "preventDefault" }, { type: "beginDistraction" }]);
    expect(down.state.holdKind).toBe("spaceDistraction");

    const up = reduceMindHoldKeyUp(down.state, { code: "Space", key: " " });
    expect(up.effects).toEqual([{ type: "preventDefault" }, { type: "endHold" }]);
    expect(up.state.holdKind).toBe("none");
  });

  test("ignores key repeat and typing targets", () => {
    const initial = createInitialMindHoldKeyboardState();
    expect(
      reduceMindHoldKeyDown(initial, { code: "Comma", key: ",", repeat: true, target: document.body }).effects,
    ).toEqual([]);
    expect(
      reduceMindHoldKeyDown(initial, {
        code: "Comma",
        key: ",",
        repeat: false,
        target: document.createElement("textarea"),
      }).effects,
    ).toEqual([]);
  });

  test("does not start a keyboard hold while pointer hold is active", () => {
    const pointerHold = { ...createInitialMindHoldKeyboardState(), holdKind: "pointerHold" as const };
    const down = reduceMindHoldKeyDown(pointerHold, {
      code: "Comma",
      key: ",",
      repeat: false,
      target: document.body,
    });
    expect(down.effects).toEqual([{ type: "preventDefault" }]);
    expect(down.state.holdKind).toBe("pointerHold");
  });

  test("comma keyup without prior keydown is a no-op", () => {
    const up = reduceMindHoldKeyUp(createInitialMindHoldKeyboardState(), { code: "Comma", key: "," });
    expect(up.effects).toEqual([]);
  });
});

describe("recordHoldSegment interval math", () => {
  test("hyperfocus hold records the same log shape as distraction", () => {
    const hyperfocusLog = recordHoldSegment([], "hyperfocus", 30, 90);
    expect(hyperfocusLog).toEqual([
      { time: 30, state: "hyperfocus" },
      { time: 90, state: "clear" },
    ]);

    const distractionLog = recordHoldSegment([], "thinking", 30, 90);
    expect(distractionLog).toEqual([
      { time: 30, state: "thinking" },
      { time: 90, state: "clear" },
    ]);
  });

  test("hyperfocus interval counts toward awareness percent", () => {
    const log = recordHoldSegment([], "hyperfocus", 0, 120);
    expect(computeClearPercentFromLog(log, 120)).toBe(100);
  });

  test("mixed distraction and hyperfocus segments replay correctly", () => {
    let log: Array<{ time: number; state: string }> = [];
    log = recordHoldSegment(log, "hyperfocus", 0, 60);
    log = recordHoldSegment(log, "thinking", 120, 180);
    expect(computeClearPercentFromLog(log, 240)).toBe(75);
  });
});
