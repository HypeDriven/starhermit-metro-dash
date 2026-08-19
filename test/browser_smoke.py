#!/usr/bin/env python3
"""Browser smoke test: loads Metro Dash, plays a daily run, exercises pause,
and captures console errors + screenshots."""
import sys, time
from playwright.sync_api import sync_playwright

BASE = "http://localhost:8137/"
errors = []
logs = []

with sync_playwright() as p:
    browser = p.chromium.launch(args=["--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader"])
    page = browser.new_page(viewport={"width": 1280, "height": 800})
    page.on("console", lambda m: (errors if m.type == "error" else logs).append(m.text))
    page.on("pageerror", lambda e: errors.append(str(e)))

    page.goto(BASE, wait_until="networkidle")
    page.wait_for_timeout(1500)

    def check(cond, name):
        print(("PASS " if cond else "FAIL ") + name)
        if not cond:
            errors.append("assertion: " + name)

    # title screen
    check(page.locator("#screen-title").is_visible(), "title visible")
    check("Metro Dash" in page.locator("h1").inner_text(), "title heading")
    webgl_ok = page.locator("#webgl-warning").is_hidden()
    print("INFO webgl:", "3D" if webgl_ok else "2D fallback")
    page.screenshot(path="/tmp/md-title.png")

    # help screen
    page.click("#btn-help")
    check(page.locator("#screen-help").is_visible(), "help visible")
    check(page.locator("#help-cards .card").count() >= 5, "help cards generated from bindings")
    page.click("#screen-help [data-back]")

    # journey grid
    page.click("#btn-journey")
    check(page.locator("#journey-grid .stage-card").count() == 40, "40 journey stages rendered")
    check(page.locator("#journey-grid .stage-card:not(.locked)").count() == 1, "only stage 1 unlocked")
    page.click("#screen-journey [data-back]")

    # settings
    page.click("#btn-settings")
    check(page.locator("#screen-settings").is_visible(), "settings visible")
    page.check("#set-reduced-motion")
    page.uncheck("#set-reduced-motion")
    page.click("#screen-settings [data-back]")

    # start daily run
    page.click("#btn-play")
    check(page.locator("#screen-setup").is_visible(), "setup/briefing visible")
    check("Ranked" in page.locator("#setup-facts").inner_text(), "setup shows ranked status")
    page.click("#btn-setup-start")
    check(page.locator("#overlay-countdown").is_visible(), "countdown shows")
    page.wait_for_timeout(2600)  # countdown 3-2-1-GO
    check(page.locator("#hud").is_visible(), "HUD visible during play")
    page.wait_for_timeout(2000)

    # play: some inputs
    for key in ["ArrowLeft", "ArrowUp"]:
        page.keyboard.press(key)
        page.wait_for_timeout(300)

    # pause immediately (before a crash can happen)
    page.keyboard.press("Escape")
    check(page.locator("#overlay-pause").is_visible(), "pause overlay")
    page.screenshot(path="/tmp/md-pause.png")
    page.click("#btn-resume")
    check(page.locator("#overlay-pause").is_hidden(), "resume hides pause")

    for key in ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"]:
        page.keyboard.press(key)
        page.wait_for_timeout(300)
    page.wait_for_timeout(1500)
    score1 = page.locator("#hud-score").inner_text()
    dist1 = page.locator("#hud-distance").inner_text()
    print(f"INFO score={score1} distance={dist1}")
    check(dist1.replace(",", "").replace(".", "").strip("0") != "", "distance accumulates")
    page.screenshot(path="/tmp/md-play.png")

    # run until crash (stop dodging)
    for _ in range(60):
        if page.locator("#screen-results").is_visible():
            break
        page.wait_for_timeout(500)
    check(page.locator("#screen-results").is_visible(), "results screen after crash")
    check(page.locator("#results-table tbody tr").count() >= 3, "score breakdown rows")
    print("INFO headline:", page.locator("#results-headline").inner_text())
    page.screenshot(path="/tmp/md-results.png")

    # retry from results
    page.click("#btn-retry")
    page.wait_for_timeout(2600)
    check(page.locator("#hud").is_visible(), "retry restarts run")
    page.keyboard.press("Escape")
    page.click("#btn-pause-quit")
    page.wait_for_timeout(500)
    check(page.locator("#screen-results").is_visible(), "quit ends run with results")
    page.click("#btn-results-menu")
    check(page.locator("#screen-title").is_visible(), "back to title")

    # persistence: reload and check progress survived
    page.reload(wait_until="networkidle")
    page.wait_for_timeout(1200)
    check("Total distance" in page.locator("#title-progress").inner_text(), "progress persists across reload")

    # mobile portrait layout
    page.set_viewport_size({"width": 390, "height": 844})
    page.wait_for_timeout(600)
    page.screenshot(path="/tmp/md-mobile.png")
    check(page.locator("#screen-title").is_visible(), "mobile portrait layout renders")

    browser.close()

print()
if errors:
    print("CONSOLE/PAGE ERRORS:")
    for e in errors:
        print("  -", e)
    sys.exit(1)
print("SMOKE TEST PASSED (no console errors)")
