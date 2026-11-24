"""File hooks end to end: the organisation's own antivirus answers through the API (spec R2, task 8.4).
Run against a deployed app:  BASE_URL=<address> python3 e2e/file-hooks.py   (exit code 1 on any failure)
  - Signs in as the Sweden admin, connects two temporary systems (an antivirus with `scan`, and one with
    read and register), and turns on "Your own antivirus" for the Sweden organisation.
  - While it runs, every file added in that organisation waits for this antivirus: run it on a test
    organisation or when nobody else is adding files there.
  - At the end, always: turns the built-in check back on and disconnects both systems.
  - Documents it creates are named "File hooks test …" on order O-7731; "Reset test data" removes them.
Needs migrations 0016-0020 on the database (the switch, the file events and the processing keys).
"""
import asyncio
import base64
import hashlib
import os
import sys
import uuid
import requests
from playwright.async_api import async_playwright

BASE = os.environ.get("BASE_URL", "http://localhost:8080")
API = BASE + "/api/public/tmf-api/document/v4"
PASSWORD = "AuroraTest123!"
ORDER = "ord-se-7731"
NO_DOC = "00000000-0000-0000-0000-0000000000e1"  # a Norway document: another organisation's
RUN = uuid.uuid4().hex[:6]
failures: list[str] = []


def check(ok: bool, msg: str) -> None:
    print(("PASS " if ok else "FAIL ") + msg, flush=True)
    if not ok:
        failures.append(msg)


def call(method: str, path: str, key: str, body=None, idem: str | None = None):
    h = {"Content-Type": "application/json", "Authorization": f"Bearer {key}"}
    if idem:
        h["Idempotency-Key"] = idem
    r = requests.request(method, API + path, headers=h, json=body, timeout=60)
    try:
        j = r.json() if r.text else None
    except ValueError:
        j = None
    return r, j


# ---------------- the admin screen ----------------
async def admin_page(browser):
    page = await (await browser.new_context(viewport={"width": 1280, "height": 1800})).new_page()
    await page.goto(BASE + "/auth")
    await page.wait_for_timeout(3000)
    await page.get_by_label("Email").fill("se.admin@example.test")
    await page.get_by_label("Password").fill(PASSWORD)
    await page.get_by_role("button", name="Log in").click()
    await page.wait_for_function("!location.pathname.startsWith('/auth')", timeout=20000)
    await page.goto(BASE + "/admin/systems")
    await page.wait_for_timeout(3500)
    return page


async def connect(page, name: str, labels: list[str]) -> str:
    await page.get_by_role("button", name="Connect a system").first.click()
    dialog = page.get_by_role("dialog")
    boxes = dialog.get_by_role("checkbox")
    for i in range(await boxes.count()):
        b = boxes.nth(i)
        if await b.get_attribute("aria-checked") == "true":
            await b.click()
    for label in labels:
        await dialog.get_by_role("checkbox", name=label).click()
    # After the permissions: choosing one may rename the system.
    await dialog.get_by_label("Name shown in activity").fill(name)
    await dialog.get_by_role("button", name="Connect and show key").click()
    code = page.get_by_label("System key")
    await code.wait_for(timeout=15000)
    key = (await code.inner_text()).strip()
    await page.get_by_role("button", name="I've stored it").click()
    await page.wait_for_timeout(800)
    return key


async def own_antivirus(page, on: bool) -> None:
    row = page.get_by_role("list", name="Processing steps").get_by_role("listitem").filter(
        has_text="Checking files for threats"
    )
    target = "Use your own antivirus" if on else "Use the built-in check"
    button = row.get_by_role("button", name=target)
    if not await button.count():
        return  # already as wanted
    await button.click()
    dialog = page.get_by_role("dialog")
    if on:
        await dialog.get_by_role("checkbox").click()
    await dialog.get_by_role("button", name=target).click()
    await page.wait_for_timeout(1500)


async def disconnect(page, name: str) -> None:
    item = page.get_by_role("list", name="Connected systems").get_by_role("listitem").filter(has_text=name)
    if not await item.count():
        return
    await item.get_by_role("button", name="Disconnect").click()
    await page.get_by_role("dialog").get_by_role("button", name="Disconnect").click()
    await page.wait_for_timeout(1500)


# ---------------- the journey ----------------
def sent_bytes(text: str) -> bytes:
    return f"%PDF-1.4 file hooks {RUN} {text}".encode()


def register(key: str, text: str) -> str | None:
    r, j = call(
        "POST",
        "/document",
        key,
        {
            "name": f"File hooks test {RUN} {text}",
            "documentType": "contract",
            "relatedEntity": [{"id": ORDER, "role": "contract", "@referredType": "ProductOrder"}],
            "attachment": [
                {
                    "mimeType": "application/pdf",
                    "name": "test.pdf",
                    "content": base64.b64encode(sent_bytes(text)).decode(),
                }
            ],
        },
        idem=f"fh-reg-{RUN}-{text}",
    )
    check(r.status_code == 201, f"register '{text}' answers 201 ({r.status_code})")
    return (j or {}).get("id") if r.status_code == 201 else None


def version_of(key: str, doc_id: str) -> str | None:
    _, j = call("GET", f"/document/{doc_id}", key)
    current = [a for a in (j or {}).get("attachment", []) if a.get("isCurrent")]
    return current[0]["id"] if current else None


def scan(av: str, doc_id: str, v: str, body: dict, idem: str):
    return call("POST", f"/document/{doc_id}/attachment/{v}/scanResult", av, {"engine": "e2e 1.0", **body}, idem)


def journeys(av: str, rw: str) -> None:
    print("\n== clean ==")
    doc = register(rw, "clean")
    v = doc and version_of(rw, doc)
    check(bool(v), "the document has a current version")
    if not (doc and v):
        return
    r, j = call("GET", f"/document/{doc}/attachment/{v}/content", rw)
    check(r.status_code == 409 and (j or {}).get("code") == "contentLocked", "a read key gets no link while the scan waits")
    # The right hash (of the bytes sent), but not downloaded in this attempt yet.
    sent = hashlib.sha256(sent_bytes("clean")).hexdigest()
    r, j = scan(av, doc, v, {"result": "clean", "contentHash": sent, "attempt": 1}, f"fh-early-{RUN}")
    check(r.status_code == 409 and (j or {}).get("code") == "notFetched", "clean before downloading is refused (notFetched)")
    r, j = call("GET", f"/document/{doc}/attachment/{v}/content", av)
    check(r.status_code == 200 and "url" in (j or {}), "the antivirus gets a link during its step")
    if r.status_code != 200:
        return
    data = requests.get(j["url"], timeout=60).content
    digest = hashlib.sha256(data).hexdigest()
    check(digest == sent, "the downloaded bytes are the bytes sent")
    r, j = scan(av, doc, v, {"result": "clean", "contentHash": digest, "attempt": 2}, f"fh-stale-{RUN}")
    check(r.status_code == 409 and (j or {}).get("code") == "staleAttempt", "another attempt is refused (staleAttempt)")
    r, j = scan(av, doc, v, {"result": "clean", "contentHash": "f" * 64, "attempt": 1}, f"fh-hash-{RUN}")
    check(r.status_code == 409 and (j or {}).get("code") == "hashMismatch", "another hash is refused (hashMismatch)")
    r, j = scan(av, doc, v, {"result": "clean", "contentHash": digest, "attempt": 1}, f"fh-clean-{RUN}")
    check(r.status_code == 200 and (j or {}).get("state") in ("reading", "ready"), f"clean moves the file on ({(j or {}).get('state')})")
    r, j = scan(av, doc, v, {"result": "clean", "contentHash": digest, "attempt": 1}, f"fh-replay-{RUN}")
    check(r.status_code == 200 and (j or {}).get("replayed") is True, "the same answer under a new key is a replay")
    r, j = call("GET", f"/document/{doc}/attachment/{v}/content", rw)
    check(r.status_code == 200, "once checked, a read key gets the link")

    print("\n== infected ==")
    bad = register(rw, "infected")
    bv = bad and version_of(rw, bad)
    if not (bad and bv):
        return
    r, j = call("GET", f"/document/{bad}/attachment/{bv}/content", av)
    data = requests.get(j["url"], timeout=60).content if r.status_code == 200 else b""
    r, j = scan(
        av, bad, bv,
        {"result": "infected", "threatName": "EICAR-Test", "contentHash": hashlib.sha256(data).hexdigest(), "attempt": 1},
        f"fh-inf-{RUN}",
    )
    check(r.status_code == 200 and (j or {}).get("state") == "quarantined", "infected quarantines the file")
    r, j = call("GET", f"/document/{bad}/attachment/{bv}/content", rw)
    check(r.status_code == 409 and (j or {}).get("code") == "quarantined", "nobody downloads a quarantined file")
    check("EICAR" not in r.text, "the threat name is not in the API answer")

    print("\n== isolation ==")
    r, j = scan(av, NO_DOC, NO_DOC, {"result": "error", "contentHash": "0" * 64, "attempt": 1}, f"fh-other-{RUN}")
    check(r.status_code == 404 and (j or {}).get("code") == "notFound", "another organisation's document answers 404")
    r, j = call("GET", "/document?limit=1", av)
    check(r.status_code == 403, "the antivirus key cannot read documents (scan only)")


async def main() -> None:
    av_name, rw_name = f"File hooks test AV {RUN}", f"File hooks test system {RUN}"
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await admin_page(browser)
        try:
            av = await connect(page, av_name, ["Check files for threats and report the result"])
            rw = await connect(
                page, rw_name, ["Read documents and download files", "Add documents and change their details"]
            )
            await own_antivirus(page, True)
            journeys(av, rw)
        finally:
            # Always put the organisation back, even after a failure.
            await page.goto(BASE + "/admin/systems")
            await page.wait_for_timeout(3000)
            await own_antivirus(page, False)
            await disconnect(page, av_name)
            await disconnect(page, rw_name)
            await browser.close()
    print(f"\n{len(failures)} failure(s)")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    asyncio.run(main())
