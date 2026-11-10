"""Browser regression: share removal and Norway direct links expose no unauthorised details.

Run against the dev server:  python3 e2e/share-isolation.py  (exit code 1 on any failure)
Steps:
  1. Norway manager opens the Sweden quote's record, document and review links: pages and every
     server reply must contain no Sweden record or document details.
  2. Sweden manager shares the quote with the Sweden viewer (who cannot see its record).
  3. Viewer sees it in Shared with me and via its direct link, without the record name.
  4. Sweden manager removes the share.
  5. Viewer's list and direct link no longer show it, and no server reply contains it.
"""
import asyncio
import os
import sys
from playwright.async_api import async_playwright

BASE = os.environ.get("BASE_URL", "http://localhost:8080")
PASSWORD = "AuroraTest123!"
RECORD = "quo-se-0412"
DOC = "00000000-0000-0000-0000-0000000000d2"
DOC_DETAILS = ["Q-2026-0412", "480 lines", "5G backup"]
SWEDEN_DETAILS = DOC_DETAILS + ["aurora-se", "Aurora Mobile Sweden", "Fjärrvärme", "O-7731", "ord-se"]
failures: list[str] = []


def check(ok: bool, msg: str) -> None:
    print(("PASS " if ok else "FAIL ") + msg)
    if not ok:
        failures.append(msg)


async def sign_in(browser, email):
    ctx = await browser.new_context(viewport={"width": 1280, "height": 1800})
    page = await ctx.new_page()
    replies: list[str] = []

    async def capture(resp):
        if "_serverFn" in resp.url or "/rest/v1/" in resp.url:
            try:
                replies.append(await resp.text())
            except Exception:
                pass

    page.on("response", lambda r: asyncio.ensure_future(capture(r)))
    await page.goto(BASE + "/auth")
    await page.wait_for_timeout(3000)
    await page.get_by_label("Email").fill(email)
    await page.get_by_label("Password").fill(PASSWORD)
    await page.get_by_role("button", name="Sign in").click()
    await page.wait_for_function("!location.pathname.startsWith('/auth')", timeout=20000)
    return page, replies


async def visit(page, path):
    await page.goto(BASE + path)
    await page.wait_for_timeout(4500)
    return await page.inner_text("main")


def leaks(text, words):
    return [w for w in words if w.lower() in text.lower()]


async def main():
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)

        # 1. Norway direct links
        no, no_replies = await sign_in(browser, "no.manager@example.test")
        for path in [f"/records/{RECORD}", f"/records/{RECORD}?doc={DOC}", f"/records/{RECORD}/review/{DOC}", f"/shared/{DOC}?level=view", "/shared"]:
            no_replies.clear()
            text = await visit(no, path)
            check(not leaks(text, SWEDEN_DETAILS), f"Norway page {path} shows no Sweden details")
            check(not any(leaks(r, SWEDEN_DETAILS) for r in no_replies), f"Norway replies for {path} contain no Sweden details ({len(no_replies)} replies)")

        # 2. Share with the viewer
        mgr, _ = await sign_in(browser, "se.manager@example.test")
        await visit(mgr, f"/records/{RECORD}?doc={DOC}")
        await mgr.get_by_role("button", name="Manage access").click()
        dialog = mgr.get_by_role("dialog")
        while await dialog.get_by_role("button", name="Remove access").count():  # start clean
            await dialog.get_by_role("button", name="Remove access").first.click()
            await mgr.wait_for_timeout(2000)
        await dialog.get_by_role("textbox").first.fill("Viewer")
        await mgr.wait_for_timeout(2000)
        await dialog.get_by_text("SE Viewer").first.click()
        await dialog.get_by_role("button", name="Add").first.click()
        await mgr.wait_for_timeout(2500)
        check(await dialog.get_by_role("button", name="Remove access").count() == 1, "share added for SE Viewer")

        # 3. Viewer sees it, without the record name
        viewer, v_replies = await sign_in(browser, "se.viewer@example.test")
        check("Q-2026-0412" in await visit(viewer, "/shared"), "viewer's Shared with me lists the quote")
        v_replies.clear()
        text = await visit(viewer, f"/shared/{DOC}?level=view")
        check("Q-2026-0412" in text, "viewer can open the quote by direct link while shared")
        check("Part of a record you don't have access to" in text, "record line is hidden for the viewer")
        check(not any("480 lines" in r for r in v_replies), "no reply to the viewer contains the record name")

        # 4. Remove the share
        await dialog.get_by_role("button", name="Remove access").first.click()
        await mgr.wait_for_timeout(2500)
        check("No exceptions" in await dialog.inner_text(), "share removed")

        # 5. Viewer loses it everywhere
        v_replies.clear()
        text = await visit(viewer, "/shared")
        check(not leaks(text, DOC_DETAILS), "viewer's Shared with me no longer lists the quote")
        check(not any(leaks(r, DOC_DETAILS) for r in v_replies), "viewer list replies contain no quote details")
        v_replies.clear()
        text = await visit(viewer, f"/shared/{DOC}?level=view")
        check("isn't available to you" in text and not leaks(text, DOC_DETAILS), "viewer's direct link shows unavailable")
        check(not any(leaks(r, DOC_DETAILS) for r in v_replies), "viewer direct-link replies contain no quote details")

        await browser.close()
    print(f"\n{len(failures)} failure(s)")
    sys.exit(1 if failures else 0)


asyncio.run(main())
