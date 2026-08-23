import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";
import { ProviderDriverKind } from "@t3tools/contracts";

import { ProviderInstanceIcon, providerInstanceInitials } from "./ProviderInstanceIcon";

const codexDriver = ProviderDriverKind.make("codex");

describe("providerInstanceInitials", () => {
  it.each([
    ["Codex", "CO"],
    ["Codex Personal", "CP"],
    ["codex_personal", "CP"],
    ["  codex-personal  ", "CP"],
    ["---", ""],
  ])("derives initials from %j", (label, expected) => {
    expect(providerInstanceInitials(label)).toBe(expected);
  });
});

describe("ProviderInstanceIcon", () => {
  it("layers neutral theme surfaces over an opaque canvas", () => {
    const markup = renderToStaticMarkup(
      <ProviderInstanceIcon driverKind={codexDriver} displayName="Codex" showBadge />,
    );

    expect(markup).toContain("bg-card text-muted-foreground");
    expect(markup).toContain("linear-gradient(var(--muted), var(--muted))");
    expect(markup).toContain("linear-gradient(var(--card), var(--card))");
    expect(markup).toContain("linear-gradient(var(--background), var(--background))");
    expect(markup).toContain("linear-gradient(Canvas, Canvas)");
    expect(markup).toContain(">CO</span>");
  });

  it("keeps an accent badge solid and skips the neutral tint layer", () => {
    const markup = renderToStaticMarkup(
      <ProviderInstanceIcon
        driverKind={codexDriver}
        displayName="Codex Work"
        accentColor="#2563eb"
        showBadge
      />,
    );

    expect(markup).toContain("--provider-accent:#2563eb");
    expect(markup).toContain("bg-[var(--provider-accent)] text-white");
    expect(markup).not.toContain("background-image");
    expect(markup).toContain(">CW</span>");
  });

  it("does not render badge styling when the badge is hidden", () => {
    const markup = renderToStaticMarkup(
      <ProviderInstanceIcon driverKind={codexDriver} displayName="Codex" />,
    );

    expect(markup).not.toContain("shadow-sm");
    expect(markup).not.toContain("background-image");
  });

  it("preserves the caller-provided indicator background on the badge border", () => {
    const markup = renderToStaticMarkup(
      <ProviderInstanceIcon
        driverKind={codexDriver}
        displayName="Codex"
        showBadge
        indicatorBackground="var(--contrast-input)"
      />,
    );

    expect(markup).toContain("border-color:var(--contrast-input)");
  });

  it("falls back to initials when a provider has no registered glyph", () => {
    const markup = renderToStaticMarkup(
      <ProviderInstanceIcon
        driverKind={ProviderDriverKind.make("custom-provider")}
        displayName="Custom Provider"
      />,
    );

    expect(markup).toContain(">CP</span>");
  });
});
