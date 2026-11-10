"""Per-system request limits: one system cannot use up another system's allowance.

Run against the dev server:  python3 e2e/tmf-rate-isolation.py   (exit code 1 on any failure)
  - Signs in as the Sweden admin, connects two temporary systems ("TMF test rate A/B"),
    sets A's limits to 5 reads / 2 changes per minute through Admin > Connected systems,
    floods A, and checks B keeps its full allowance. Both systems are disconnected at the end.
  - Change requests use an invalid body, so no documents are created.
"""
import asyncio
import os
import sys
import time
import uuid
from concurrent.futures import ThreadPoolExecutor

import requests
from playwright.async_api import async_playwright

BASE = os.environ.get("BASE_URL", "http://localhost:8080")
STD = BASE + "/api/public/tmf-api/document/v4"
PASSWORD = "AuroraTest123!"
RUN = uuid.uuid4().hex[:6]
failures: list[str] = []


def check(ok: bool, msg: str) -> None:
    print(("PASS " if ok else "FAIL ") + msg, flush=True)
    if not ok:
        failures.append(msg)


async def admin_page(browser):
    ctx = await browser.new_context(viewport={"width": 1280, "height": 1800})
    page = await ctx.new_page()
    await page.goto(BASE + "/auth")
    await page.wait_for_timeout(3000)
    await page.get_by_label("Email").fill("se.admin@example.test")
    await page.get_by_label("Password").fill(PASSWORD)
    await page.get_by_role("button", name="Sign in").click()
    await page.wait_for_function("!location.pathname.startsWith('/auth')", timeout=20000)
    await page.goto(BASE + "/admin/systems")
    await page.wait_for_timeout(3500)
    return page


async def mint_key(page, name: str) -> str:
    await page.get_by_role("button", name="Connect a system").click()
    dialog = page.get_by_role("dialog")
    await dialog.get_by_label("Name shown in activity").fill(name)
    boxes = dialog.get_by_role("checkbox")
    for i in range(await boxes.count()):
        b = boxes.nth(i)
        want = i <= 1  # read + register
        if (await b.get_attribute("aria-checked") == "true") != want:
            await b.click()
    await dialog.get_by_role("button", name="Connect and show key").click()
    code = page.get_by_label("System key")
    await code.wait_for(timeout=15000)
    key = (await code.inner_text()).strip()
    await page.get_by_role("button", name="I've stored it").click()
    await page.wait_for_timeout(800)
    return key


def item(page, name: str):
    return page.get_by_role("list", name="Connected systems").get_by_role("listitem").filter(has_text=name)


async def set_limits(page, name: str, reads: str, changes: str) -> bool:
    await item(page, name).get_by_role("button", name="Request limits").click()
    dialog = page.get_by_role("dialog")
    await dialog.get_by_label("Reads per minute").fill("0")
    zero_refused = await dialog.get_by_text("Both limits need a valid number.").is_visible()
    await dialog.get_by_label("Reads per minute").fill(reads)
    await dialog.get_by_label("Changes per minute").fill(changes)
    await dialog.get_by_role("button", name="Save limits").click()
    await page.wait_for_timeout(2500)
    return zero_refused


async def disconnect(page, name: str) -> None:
    await item(page, name).get_by_role("button", name="Disconnect").click()
    await page.get_by_role("dialog").get_by_role("button", name="Disconnect").click()
    await page.wait_for_timeout(2000)


def get(key: str):
    return requests.get(STD + "/document?limit=1&fields=id", headers={"Authorization": f"Bearer {key}"}, timeout=60)


def post(key: str, n: int):
    return requests.post(STD + "/document", headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json", "Idempotency-Key": f"rate-{RUN}-{n}-{key[-6:]}"}, data="{}", timeout=60)


def flows(a: str, b: str) -> None:
    while time.gmtime().tm_sec > 15:  # keep every burst inside one minute window
        time.sleep(1)
    with ThreadPoolExecutor(max_workers=10) as ex:
        ra = list(ex.map(lambda _: get(a), range(12)))
    served_a = sum(1 for r in ra if r.status_code == 200)
    limited = [r for r in ra if r.status_code == 429]
    check(served_a == 5, f"A is served exactly its 5 reads ({served_a} of 12)")
    check(len(limited) == 7, f"A's other 7 reads get 429 ({len(limited)})")
    if limited:
        r = limited[0]
        j = r.json()
        h = r.headers
        check(j.get("code") == "tooManyRequests" and str(j.get("status")) == "429", "429 body is a TMF error with code tooManyRequests")
        check("Wait" in j.get("message", "") and "Other connected systems are not affected" in j.get("message", ""), "429 message gives retry guidance")
        ra_s = h.get("Retry-After", "")
        check(ra_s.isdigit() and 1 <= int(ra_s) <= 60, f"Retry-After is 1–60 seconds ({ra_s})")
        check(h.get("RateLimit-Limit") == "5" and h.get("RateLimit-Remaining") == "0" and h.get("RateLimit-Reset") == ra_s, "RateLimit-Limit/Remaining/Reset headers match A's allowance")
        check(h.get("RateLimit-Policy") == "5;w=60", "RateLimit-Policy says 5 per 60 seconds")

    # B in the same minute, after A is exhausted: full default allowance.
    with ThreadPoolExecutor(max_workers=10) as ex:
        rb = list(ex.map(lambda _: get(b), range(30)))
    check(all(r.status_code == 200 for r in rb), f"B's 30 reads all succeed while A is limited ({sum(1 for r in rb if r.status_code == 200)} of 30)")

    # Changes are counted separately from reads, and per system.
    pa = [post(a, i).status_code for i in range(4)]
    check(pa[:2] == [400, 400] and pa[2:] == [429, 429], f"A gets 2 changes, then 429 ({pa})")
    pb = [post(b, i).status_code for i in range(4)]
    check(all(s == 400 for s in pb), f"B's changes are not limited by A's ({pb})")
    check(get(a).status_code == 429, "A stays limited until its minute ends")

    wait = int(limited[0].headers.get("Retry-After", "60")) if limited else 60
    time.sleep(wait + 1)
    check(get(a).status_code == 200, "after waiting Retry-After seconds, A is served again")


async def main() -> None:
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await admin_page(browser)
        na, nb = f"TMF test rate A {RUN}", f"TMF test rate B {RUN}"
        a = await mint_key(page, na)
        b = await mint_key(page, nb)
        try:
            zero_refused = await set_limits(page, na, "5", "2")
            check(zero_refused, "the limits dialog refuses 0 reads per minute")
            check(await item(page, na).get_by_text("Allowance: 5 reads and 2 changes per minute").is_visible(), "A shows its new allowance")
            check(await item(page, nb).get_by_text("Allowance: 120 reads and 30 changes per minute").is_visible(), "B keeps the usual allowance")
            flows(a, b)
        finally:
            await disconnect(page, na)
            await disconnect(page, nb)
            await browser.close()
    print(f"\nRun {RUN}: {len(failures)} failure(s)")
    sys.exit(1 if failures else 0)


asyncio.run(main())
