from pathlib import Path

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
SIDEPANEL = (ROOT / "sidepanel" / "sidepanel.html").as_uri()


def center_y(box):
    return box["y"] + box["height"] / 2


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 760, "height": 260})
    page.goto(SIDEPANEL)
    page.wait_for_load_state("networkidle")

    for font_size in (18, 24):
        page.evaluate(
            """fontSize => {
              document.body.innerHTML = `
                <div id="fixture" class="md" style="font-size:${fontSize}px; padding:32px">
                  <span class="math">
                    <span id="before">年租金回报率 =</span>
                    <span class="frac">
                      <span class="fn">年租金收入</span>
                      <span class="fd">总买入成本</span>
                    </span>
                    <span id="after">× 100% ≥ 10%</span>
                  </span>
                </div>`;
            }""",
            font_size,
        )

        centers = [
            center_y(page.locator(selector).bounding_box())
            for selector in ("#before", ".frac", "#after")
        ]
        assert max(centers) - min(centers) <= 3, (
            f"{font_size}px formula centers are not aligned: {centers}"
        )

    browser.close()
