import type { DesktopUpdateActionResult, DesktopUpdateState } from "@t3tools/contracts";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { visitElements } from "../../test/reactElementTree";
import { reactHookHarness as hooks } from "../../test/reactHookHarness";

const testState = vi.hoisted(() => ({
  desktopUpdate: null as DesktopUpdateState | null,
  downloadUpdate: vi.fn<() => Promise<DesktopUpdateActionResult>>(),
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const { reactHookHarness } = await import("../../test/reactHookHarness");
  return {
    ...actual,
    useCallback: reactHookHarness.useCallback,
    useEffect: () => undefined,
    useId: () => "sidebar-update-trigger",
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
  const control = SidebarUpdatePill() as TestElement;
  return invokeComponent(control);
}

function findTrigger(output: TestElement) {
  const trigger = visitElements(
    output,
    (element) => element.type === "button" && typeof element.props["aria-label"] === "string",
  );
  if (!trigger) throw new Error("Expected update trigger");
  return trigger;
}

function renderPopover() {
  const popover = renderControl();
  const output = invokeComponent(popover);
  const trigger = findTrigger(output);
  const root = visitElements(
    output,
    (element) =>
      typeof element.props.open === "boolean" && typeof element.props.onOpenChange === "function",
  );

  if (!root) throw new Error("Expected update popover");
  return { output, root, trigger };
}

function activateTrigger(trigger: TestElement, pointerType: "mouse" | "pen" | "touch") {
  const preventBaseUIHandler = vi.fn();
  const onPointerDown = trigger.props.onPointerDown as
    | ((event: { pointerType: string }) => void)
    | undefined;
  const onClick = trigger.props.onClick as
    | ((event: { preventBaseUIHandler: () => void }) => void)
    | undefined;

  onPointerDown?.({ pointerType });
  onClick?.({ preventBaseUIHandler });
  return preventBaseUIHandler;
}

function installDesktopBridge() {
  vi.stubGlobal("window", {
    desktopBridge: {
      downloadUpdate: testState.downloadUpdate,
    },
  });
}

describe("SidebarUpdatePill release notes popover", () => {
  beforeEach(() => {
    hooks.reset();
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

  it("runs the update action on a mouse click", () => {
    const { trigger } = renderPopover();

    const preventBaseUIHandler = activateTrigger(trigger, "mouse");

    expect(testState.downloadUpdate).toHaveBeenCalledTimes(1);
    expect(preventBaseUIHandler).not.toHaveBeenCalled();
  });

  it.each(["touch", "pen"] as const)(
    "opens release notes before acting for a %s click",
    (pointerType) => {
      const { trigger } = renderPopover();

      const preventBaseUIHandler = activateTrigger(trigger, pointerType);
      const rerendered = renderPopover();

      expect(testState.downloadUpdate).not.toHaveBeenCalled();
      expect(preventBaseUIHandler).toHaveBeenCalledTimes(1);
      expect(rerendered.root.props.open).toBe(true);
    },
  );

  it("keeps the downloading trigger focusable but marks its action disabled", () => {
    testState.desktopUpdate = {
      ...availableState,
      status: "downloading",
      downloadPercent: 42,
    };

    const { trigger } = renderPopover();
    activateTrigger(trigger, "mouse");

    expect(trigger.props.disabled).toBeUndefined();
    expect(trigger.props["aria-disabled"]).toBe(true);
    expect(trigger.props.className).toContain("cursor-not-allowed");
    expect(trigger.props.className).not.toContain("cursor-pointer");
    expect(trigger.props.className).not.toContain("hover:bg-update/12");
    expect(testState.downloadUpdate).not.toHaveBeenCalled();
  });

  it("marks the trigger and popover action disabled while an action is pending", () => {
    testState.downloadUpdate.mockReturnValue(new Promise(() => undefined));
    const { trigger } = renderPopover();
    activateTrigger(trigger, "mouse");

    const rerendered = renderPopover();
    const releaseNotes = visitElements(
      rerendered.output,
      (element) => element.props.state === availableState && element.props.isActionPending === true,
    );
    if (!releaseNotes) throw new Error("Expected release notes content");
    const actionButton = visitElements(
      invokeComponent(releaseNotes),
      (element) => element.props.children === "Download update",
    );
    activateTrigger(rerendered.trigger, "mouse");

    expect(rerendered.trigger.props.disabled).toBeUndefined();
    expect(rerendered.trigger.props["aria-disabled"]).toBe(true);
    expect(rerendered.trigger.props.className).toContain("cursor-not-allowed");
    expect(actionButton?.props.disabled).toBe(true);
    expect(testState.downloadUpdate).toHaveBeenCalledTimes(1);
  });

  it("keeps the stable downloading tooltip trigger keyboard-focusable", () => {
    testState.desktopUpdate = {
      ...availableState,
      status: "downloading",
      channel: "latest",
      releaseNotes: [],
      downloadPercent: 42,
    };

    const trigger = findTrigger(renderControl());
    activateTrigger(trigger, "mouse");

    expect(trigger.props.disabled).toBeUndefined();
    expect(trigger.props["aria-disabled"]).toBe(true);
    expect(trigger.props.className).toContain("cursor-not-allowed");
    expect(trigger.props.className).not.toContain("cursor-pointer");
    expect(testState.downloadUpdate).not.toHaveBeenCalled();
  });
});
