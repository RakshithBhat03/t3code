import type { DesktopUpdateActionResult, DesktopUpdateState } from "@t3tools/contracts";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { visitElements } from "../../test/reactElementTree";
import { reactHookHarness as hooks } from "../../test/reactHookHarness";

const testState = vi.hoisted(() => ({
  desktopUpdate: null as DesktopUpdateState | null,
  downloadUpdate: vi.fn<() => Promise<DesktopUpdateActionResult>>(),
  effects: [] as Array<() => void | (() => void)>,
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const { reactHookHarness } = await import("../../test/reactHookHarness");
  return {
    ...actual,
    useCallback: reactHookHarness.useCallback,
    useEffect: (effect: () => void | (() => void)) => testState.effects.push(effect),
    useRef: reactHookHarness.useRef,
    useState: reactHookHarness.useState,
  };
});

vi.mock("react/compiler-runtime", async () => {
  const { reactHookHarness } = await import("../../test/reactHookHarness");
  return { c: reactHookHarness.useMemoCache };
});

vi.mock("../../env", () => ({ isElectron: true }));
vi.mock("../../hooks/useMediaQuery", () => ({ useMediaQuery: () => false }));
vi.mock("../../state/desktopUpdate", () => ({
  useDesktopUpdateState: () => testState.desktopUpdate,
}));

import { SidebarUpdatePill } from "./SidebarUpdatePill";

const availableState: DesktopUpdateState = {
  enabled: true,
  status: "available",
  channel: "nightly",
  currentVersion: "1.0.0-nightly.1",
  hostArch: "x64",
  appArch: "x64",
  runningUnderArm64Translation: false,
  availableVersion: "1.0.0-nightly.2",
  downloadedVersion: null,
  releaseNotes: [{ version: "1.0.0-nightly.2", items: ["fix: keep notes interactive"] }],
  downloadPercent: null,
  checkedAt: "2026-08-22T00:00:00.000Z",
  message: null,
  errorContext: null,
  canRetry: false,
};

type TestElement = ReactElement<Record<string, unknown>>;

function invokeComponent(element: TestElement): TestElement {
  if (typeof element.type !== "function") {
    throw new Error("Expected a function component");
  }
  const component = element.type as unknown as (props: Record<string, unknown>) => TestElement;
  return component(element.props);
}

function renderControl() {
  hooks.beginRender();
  const output = invokeComponent(SidebarUpdatePill() as TestElement);
  const releaseNotesPopover = findReleaseNotesPopover(output);
  return releaseNotesPopover ? invokeComponent(releaseNotesPopover) : output;
}

function renderControlElement() {
  hooks.beginRender();
  return invokeComponent(SidebarUpdatePill() as TestElement);
}

function findReleaseNotesPopover(output: TestElement) {
  return visitElements(
    output,
    (element) =>
      typeof element.type === "function" &&
      typeof element.props.renderTrigger === "function" &&
      element.props.state === testState.desktopUpdate,
  );
}

function findTrigger(output: TestElement) {
  const trigger = visitElements(
    output,
    (element) => element.type === "button" && typeof element.props["aria-label"] === "string",
  );
  if (!trigger) throw new Error("Expected update trigger");
  return trigger;
}

function installDesktopBridge() {
  vi.stubGlobal("window", {
    desktopBridge: {
      downloadUpdate: testState.downloadUpdate,
    },
  });
}

function flushEffects() {
  for (const effect of testState.effects.splice(0)) effect();
}

describe("SidebarUpdatePill release notes popover", () => {
  beforeEach(() => {
    hooks.reset();
    testState.effects = [];
    testState.desktopUpdate = availableState;
    testState.downloadUpdate.mockReset();
    testState.downloadUpdate.mockResolvedValue({
      accepted: true,
      completed: false,
      state: availableState,
    });
    installDesktopBridge();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("downloads from the sidebar trigger without toggling the popover", () => {
    const output = renderControl();
    const root = visitElements(
      output,
      (element) =>
        typeof element.props.open === "boolean" && typeof element.props.onOpenChange === "function",
    );
    if (!root) throw new Error("Expected update popover");
    const onOpenChange = root.props.onOpenChange as (open: boolean) => void;
    onOpenChange(true);

    const openedOutput = renderControl();
    const trigger = findTrigger(openedOutput);
    const preventBaseUIHandler = vi.fn();
    const onClick = trigger.props.onClick as
      | ((event: { preventBaseUIHandler: () => void }) => void)
      | undefined;

    onClick?.({ preventBaseUIHandler });

    const closedOutput = renderControl();
    const closedRoot = visitElements(closedOutput, (element) => element.props.open === false);

    expect(preventBaseUIHandler).toHaveBeenCalledTimes(1);
    expect(testState.downloadUpdate).toHaveBeenCalledTimes(1);
    expect(closedRoot).not.toBeNull();
  });

  it("uses a hover popover containing only the changelog", () => {
    const output = renderControl();
    const popoverTrigger = visitElements(output, (element) => element.props.openOnHover === true);
    const popup = visitElements(output, (element) => element.props.initialFocus === false);
    const releaseNotes = visitElements(output, (element) => element.props.state === availableState);

    if (!releaseNotes) throw new Error("Expected release notes content");
    const releaseNotesOutput = invokeComponent(releaseNotes);
    const actionButton = visitElements(
      releaseNotesOutput,
      (element) =>
        element.type === "button" &&
        (element.props.children === "Download update" ||
          element.props.children === "Restart and install"),
    );

    expect(popoverTrigger?.props.delay).toBe(150);
    expect(popoverTrigger?.props.closeDelay).toBe(120);
    expect(popup?.props.className).toContain("max-w-[min(24rem");
    expect(popup?.props.tooltipStyle).toBeUndefined();
    expect(popup?.props.style).toBeUndefined();
    expect(popup?.props.viewportClassName).toContain("max-h-");
    expect(actionButton).toBeNull();
  });

  it("keeps release notes available while an update is downloading", () => {
    testState.desktopUpdate = {
      ...availableState,
      status: "downloading",
      downloadPercent: 42,
    };

    const output = renderControl();
    const popoverTrigger = visitElements(output, (element) => element.props.openOnHover === true);
    const trigger = findTrigger(output);

    expect(popoverTrigger?.props.disabled).toBeUndefined();
    expect(trigger.props.disabled).toBeUndefined();
    expect(trigger.props["aria-disabled"]).toBe(true);
    expect(trigger.props.onFocus).toBeTypeOf("function");
  });

  it("keeps one trigger host while release note eligibility changes", () => {
    const eligibleOutput = renderControlElement();
    const eligiblePopover = findReleaseNotesPopover(eligibleOutput);

    expect(eligiblePopover?.props.enabled).toBe(true);

    testState.desktopUpdate = { ...availableState, status: "checking", releaseNotes: [] };
    const ineligibleOutput = renderControlElement();
    const ineligiblePopover = findReleaseNotesPopover(ineligibleOutput);

    expect(ineligiblePopover?.type).toBe(eligiblePopover?.type);
    expect(ineligiblePopover?.props.enabled).toBe(false);
  });

  it.each([":hover", ":focus-visible"])(
    "opens release notes when eligibility changes while the trigger matches %s",
    (activeSelector) => {
      testState.desktopUpdate = { ...availableState, status: "checking", releaseNotes: [] };
      const ineligibleOutput = renderControl();
      const trigger = findTrigger(ineligibleOutput);
      const triggerRef = trigger.props.ref as {
        current: { matches: (selector: string) => boolean } | null;
      };
      triggerRef.current = { matches: (selector) => selector === activeSelector };
      flushEffects();

      testState.desktopUpdate = availableState;
      renderControl();
      flushEffects();

      const eligibleOutput = renderControl();
      const openRoot = visitElements(eligibleOutput, (element) => element.props.open === true);

      expect(openRoot).not.toBeNull();
    },
  );

  it("does not latch pointer focus for the hover popover", () => {
    const output = renderControl();
    const trigger = findTrigger(output);
    const onFocus = trigger.props.onFocus as
      | ((event: { currentTarget: { matches: (selector: string) => boolean } }) => void)
      | undefined;
    const matches = vi.fn(() => false);

    onFocus?.({ currentTarget: { matches } });

    const pointerFocusedOutput = renderControl();
    const closedRoot = visitElements(
      pointerFocusedOutput,
      (element) => element.props.open === false,
    );

    expect(matches).toHaveBeenCalledWith(":focus-visible");
    expect(closedRoot).not.toBeNull();
  });

  it("ignores hover close while the release notes trigger remains focused", () => {
    const output = renderControl();
    const trigger = findTrigger(output);
    const onFocus = trigger.props.onFocus as
      | ((event: { currentTarget: { matches: () => boolean } }) => void)
      | undefined;

    onFocus?.({ currentTarget: { matches: () => true } });

    const focusedOutput = renderControl();
    const focusedRoot = visitElements(focusedOutput, (element) => element.props.open === true);
    if (!focusedRoot) throw new Error("Expected focused update popover");
    const onOpenChange = focusedRoot.props.onOpenChange as (
      open: boolean,
      eventDetails: { reason: string; cancel: () => void },
    ) => void;
    const cancelHoverClose = vi.fn();

    onOpenChange(false, { reason: "trigger-hover", cancel: cancelHoverClose });

    const pointerLeftOutput = renderControl();
    const pointerLeftRoot = visitElements(
      pointerLeftOutput,
      (element) => element.props.open === true,
    );

    expect(cancelHoverClose).toHaveBeenCalledTimes(1);
    expect(pointerLeftRoot).not.toBeNull();

    const focusedTrigger = findTrigger(pointerLeftOutput);
    const onBlur = focusedTrigger.props.onBlur as
      | ((event: {
          currentTarget: { getAttribute: (name: string) => string | null };
          relatedTarget: EventTarget | null;
        }) => void)
      | undefined;
    vi.stubGlobal("document", {
      getElementById: vi.fn(() => ({ contains: () => false, matches: () => true })),
    });
    onBlur?.({
      currentTarget: {
        getAttribute: (name: string) => (name === "aria-controls" ? "release-notes-popover" : null),
      },
      relatedTarget: null,
    });

    const cancelAfterBlur = vi.fn();
    onOpenChange(false, { reason: "trigger-hover", cancel: cancelAfterBlur });

    const blurredOutput = renderControl();
    const blurredRoot = visitElements(blurredOutput, (element) => element.props.open === false);

    expect(cancelAfterBlur).not.toHaveBeenCalled();
    expect(blurredRoot).not.toBeNull();
  });

  it("releases the focus latch when Base UI closes the popover", () => {
    const output = renderControl();
    const trigger = findTrigger(output);
    const onFocus = trigger.props.onFocus as
      | ((event: { currentTarget: { matches: () => boolean } }) => void)
      | undefined;

    onFocus?.({ currentTarget: { matches: () => true } });

    const focusedOutput = renderControl();
    const focusedRoot = visitElements(focusedOutput, (element) => element.props.open === true);
    if (!focusedRoot) throw new Error("Expected focused update popover");
    const onOpenChange = focusedRoot.props.onOpenChange as (
      open: boolean,
      eventDetails: { reason: string; cancel: () => void },
    ) => void;

    onOpenChange(false, { reason: "escape-key", cancel: vi.fn() });
    onOpenChange(true, { reason: "trigger-hover", cancel: vi.fn() });

    const reopenedOutput = renderControl();
    const reopenedRoot = visitElements(reopenedOutput, (element) => element.props.open === true);
    if (!reopenedRoot) throw new Error("Expected reopened update popover");
    const onReopenedChange = reopenedRoot.props.onOpenChange as (
      open: boolean,
      eventDetails: { reason: string; cancel: () => void },
    ) => void;
    const cancelHoverClose = vi.fn();

    onReopenedChange(false, { reason: "trigger-hover", cancel: cancelHoverClose });

    const closedOutput = renderControl();
    const closedRoot = visitElements(closedOutput, (element) => element.props.open === false);

    expect(cancelHoverClose).not.toHaveBeenCalled();
    expect(closedRoot).not.toBeNull();
  });

  it("releases the focus latch when keyboard activation runs the update action", () => {
    const output = renderControl();
    const trigger = findTrigger(output);
    const onFocus = trigger.props.onFocus as
      | ((event: { currentTarget: { matches: () => boolean } }) => void)
      | undefined;

    onFocus?.({ currentTarget: { matches: () => true } });

    const focusedOutput = renderControl();
    const focusedRoot = visitElements(focusedOutput, (element) => element.props.open === true);
    const focusedTrigger = findTrigger(focusedOutput);
    if (!focusedRoot) throw new Error("Expected focused update popover");
    const onOpenChange = focusedRoot.props.onOpenChange as (
      open: boolean,
      eventDetails: { reason: string; cancel: () => void },
    ) => void;
    const onClick = focusedTrigger.props.onClick as
      | ((event: { preventBaseUIHandler: () => void }) => void)
      | undefined;

    onClick?.({ preventBaseUIHandler: vi.fn() });
    onOpenChange(true, { reason: "trigger-hover", cancel: vi.fn() });

    const reopenedOutput = renderControl();
    const reopenedRoot = visitElements(reopenedOutput, (element) => element.props.open === true);
    if (!reopenedRoot) throw new Error("Expected reopened update popover");
    const onReopenedChange = reopenedRoot.props.onOpenChange as (
      open: boolean,
      eventDetails: { reason: string; cancel: () => void },
    ) => void;
    const cancelHoverClose = vi.fn();

    onReopenedChange(false, { reason: "trigger-hover", cancel: cancelHoverClose });

    const closedOutput = renderControl();
    const closedRoot = visitElements(closedOutput, (element) => element.props.open === false);

    expect(cancelHoverClose).not.toHaveBeenCalled();
    expect(closedRoot).not.toBeNull();
  });

  it("closes focused release notes only after focus and pointer leave the popover", () => {
    const output = renderControl();
    const trigger = findTrigger(output);
    const onFocus = trigger.props.onFocus as
      | ((event: { currentTarget: { matches: () => boolean } }) => void)
      | undefined;

    onFocus?.({ currentTarget: { matches: () => true } });

    const focusedOutput = renderControl();
    const focusedRoot = visitElements(focusedOutput, (element) => element.props.open === true);
    const focusedTrigger = findTrigger(focusedOutput);
    const onBlur = focusedTrigger.props.onBlur as
      | ((event: {
          currentTarget: { getAttribute: (name: string) => string | null };
          relatedTarget: EventTarget | null;
        }) => void)
      | undefined;
    const matches = vi.fn(() => true);
    const contains = vi.fn(() => false);
    const popupId = "release-notes-popover";
    vi.stubGlobal("document", {
      getElementById: vi.fn(() => ({ contains, matches })),
    });
    const blurEvent = {
      currentTarget: {
        getAttribute: (name: string) => (name === "aria-controls" ? popupId : null),
      },
      relatedTarget: {} as EventTarget,
    };

    expect(focusedRoot).not.toBeNull();

    onBlur?.(blurEvent);

    const hoveredOutput = renderControl();
    const hoveredRoot = visitElements(hoveredOutput, (element) => element.props.open === true);

    expect(hoveredRoot).not.toBeNull();

    matches.mockReturnValue(false);
    contains.mockReturnValue(true);
    onBlur?.(blurEvent);

    const containedFocusOutput = renderControl();
    const containedFocusRoot = visitElements(
      containedFocusOutput,
      (element) => element.props.open === true,
    );

    expect(containedFocusRoot).not.toBeNull();

    contains.mockReturnValue(false);
    onBlur?.(blurEvent);

    const blurredOutput = renderControl();
    const blurredRoot = visitElements(blurredOutput, (element) => element.props.open === false);

    expect(blurredRoot).not.toBeNull();
  });

  it.each([
    { channel: "latest" as const, releaseNotes: availableState.releaseNotes },
    { channel: "nightly" as const, releaseNotes: [] },
  ])("keeps the existing tooltip when release notes are unavailable", (stateOverride) => {
    testState.desktopUpdate = { ...availableState, ...stateOverride };

    const output = renderControl();
    const popoverTrigger = visitElements(output, (element) => element.props.openOnHover === true);

    expect(popoverTrigger).toBeNull();
    expect(findTrigger(output)).toBeDefined();
  });

  it("removes popover semantics while only the tooltip is eligible", () => {
    testState.desktopUpdate = { ...availableState, channel: "latest" };

    const output = renderControl();
    const popoverTrigger = visitElements(output, (element) => element.props.openOnHover === false);

    expect(popoverTrigger).not.toBeNull();
    expect(Object.hasOwn(popoverTrigger?.props ?? {}, "aria-controls")).toBe(true);
    expect(popoverTrigger?.props["aria-controls"]).toBeUndefined();
    expect(popoverTrigger?.props["aria-expanded"]).toBeUndefined();
    expect(popoverTrigger?.props["aria-haspopup"]).toBeUndefined();
  });
});
