// The look of the menus, rails, tray and dialogs: the browser build's
// index.html <style>, rewritten class-based in tools/ui-style.css and
// converted once with `starhermit css` into assets/ui-style.json (`npm run
// css`), registered at start with the theme the runtime's own widgets
// (scroll bars, focus rings) take and the old Georgia-style serif face. The
// browser build's body.high-contrast palette is a token set here, applied
// while the runtime's high-contrast option is on.
import { files } from "starhermit:engine";
import * as ui from "starhermit:ui";

type Tokens = Record<string, string | number>;
let base: Tokens = {};
/** index.html body.high-contrast: white paper, black ink, a blue accent, an orange focus ring. */
const HIGH_CONTRAST: Tokens = {
  paper: "#ffffff", ink: "#000000", muted: "#000000", accent: "#0044cc", tile: "#ffffff", focus: "#ff8000",
  hover: "#f0f0f0", rail: "#ffffff", found: "#000000a6",
};

export function initStyles(): void {
  const css = files.readJson("assets/ui-style.json") as unknown as ui.CssStyles;
  base = { ...(css.tokens as Tokens) };
  ui.setFont({ family: "serif" });
  ui.setTheme({
    fontSize: 16, smallSize: 14, headingSize: 24, padding: 8, spacing: 10, radius: 8,
    text: "#2b2b2f", muted: "#5d5b59", panel: "#f3ead7", control: "#f3ead7", hovered: "#fbf3e2",
    pressed: "#e8dcc0", field: "#ffffff", accent: "#b3543f", focus: "#1a5fb4", outline: "#2b2b2f",
  });
  ui.setTokens(css.tokens);
  ui.setAnimations(css.animations);
  ui.setStyles({
    ...css.styles,
    label: { text: { color: "$ink" } },
    paragraph: { text: { color: "$ink" } },
    heading: { text: { color: "$ink" } },
    widget: { focusRing: { color: "$focus", width: 3, offset: 2 } },
    scrollArea: { parts: { bar: { background: "$muted", radius: 4 } } },
    tooltip: { background: "$paper", text: { color: "$ink" }, radius: 6, padding: 6 },
  });
}

let hcKey: boolean | null = null;
/** The high-contrast tokens over the sheet's while the runtime's option is on. */
export function applyContrast(highContrast: boolean): void {
  if (hcKey === highContrast) return;
  hcKey = highContrast;
  ui.setTokens(highContrast ? { ...base, ...HIGH_CONTRAST } : base);
}
