// The look of the top bar, menus, HUD, tray and panels: the browser build's
// css/style.css, rewritten class-based in tools/ui-style.css and converted
// once with `starhermit css` into assets/ui-style.json (`npm run css`),
// registered at start with the theme the runtime's own widgets (dialogs,
// scroll bars, selects, check boxes) take. The old body.high-contrast palette
// is a token set applied while the runtime's high-contrast option is on (and,
// as before, it drops the title's key art for a plain black wash).
import { files } from "starhermit:engine";
import * as ui from "starhermit:ui";

type Tokens = Record<string, string | number>;
let base: Tokens = {};
/** style.css body.high-contrast. */
const HIGH_CONTRAST: Tokens = {
  bg: "#000000", panel: "#000000f2", "panel-solid": "#000000", text: "#ffffff", muted: "#d5d5d5", accent: "#ffe14d", focus: "#ffffff",
};

export function initStyles(): void {
  const css = files.readJson("assets/ui-style.json") as unknown as ui.CssStyles;
  base = { ...(css.tokens as Tokens) };
  ui.setFont({ family: "sans-serif" });
  ui.setTheme({
    fontSize: 16, smallSize: 13.3, headingSize: 32, padding: 8, spacing: 10, radius: 10,
    text: "#eef1f8", muted: "#9aa3b8", panel: "#181c2e", control: "#22273d", hovered: "#2c3250",
    pressed: "#181c2e", field: "#22273d", accent: "#ffc94d", focus: "#7fe7ff", outline: "#ffffff33",
  });
  ui.setTokens(css.tokens);
  ui.setAnimations(css.animations);
  ui.setStyles({
    ...css.styles,
    label: { text: { color: "$text" } },
    paragraph: { text: { color: "$text" } },
    heading: { text: { color: "$text" } },
    widget: { focusRing: { color: "$focus", width: 3, offset: 2 } },
    scrollArea: { parts: { bar: { background: "$muted", radius: 4 } } },
    tooltip: { background: "$panel-solid", text: { color: "$text" }, radius: 6, padding: 6 },
    // style.css .overlay > .panel: the panel over a dim of the run behind it.
    dialog: { ...(css.styles[".panel"] as ui.Style), parts: { backdrop: { background: "#06080eb3" } } },
  });
}

let hcKey: boolean | null = null;
/** The high-contrast tokens over the sheet's while the runtime's option is on. */
export function applyContrast(highContrast: boolean): void {
  if (hcKey === highContrast) return;
  hcKey = highContrast;
  ui.setTokens(highContrast ? { ...base, ...HIGH_CONTRAST } : base);
}
