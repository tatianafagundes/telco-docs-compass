"""TMF667 API regression from several perspectives: integrator journeys, TMF conformance,
security/isolation, business rules, reliability (idempotency + signed events) and light timing.

Run against the dev server:  python3 e2e/tmf-api.py   (exit code 1 on any failure)
  - Signs in as the Sweden admin and creates two temporary system keys in Admin > Connected systems
    (one with every permission, one read-only), then disconnects both at the end.
  - Documents it creates are named "TMF test …" on order O-7731; "Reset test data" removes them.
  - Event delivery uses a temporary webhook.site receiver and the managed scheduler (runs each minute).
Set SKIP_SLOW=1 to skip the 60-second download-link expiry and event-delivery waits.
"""
import asyncio
import hashlib
import hmac
import json
import os
import sys
import time
import uuid

import requests
from playwright.async_api import async_playwright

BASE = os.environ.get("BASE_URL", "http://localhost:8080")
API = BASE + "/api/public/tmf-api/documentManagement/v4"
PASSWORD = "AuroraTest123!"
ORDER = "ord-se-7731"
NO_DOC = "00000000-0000-0000-0000-0000000000e1"
NORWAY_STRINGS = ["aurora-no", "ord-no-", "acc-no-", "Private 5G pilot", "Spectrum licence", "Site map", "0000000000e1", "0000000000e2", "0000000000e3"]
SKIP_SLOW = os.environ.get("SKIP_SLOW") == "1"
RUN = uuid.uuid4().hex[:6]

failures: list[str] = []
bodies: list[str] = []
timings: dict[str, float] = {}


def check(ok: bool, msg: str) -> None:
    print(("PASS " if ok else "FAIL ") + msg, flush=True)
    if not ok:
        failures.append(msg)


def call(method: str, path: str, key: str | None, body=None, idem: str | None = None, raw: str | None = None, headers=None):
    h = {"Content-Type": "application/json"}
    if key is not None:
        h["Authorization"] = f"Bearer {key}"
    if idem:
        h["Idempotency-Key"] = idem
    h.update(headers or {})
    data = raw if raw is not None else (json.dumps(body) if body is not None else None)
    t = time.perf_counter()
    r = requests.request(method, API + path, headers=h, data=data, timeout=30)
    ms = (time.perf_counter() - t) * 1000
    bodies.append(r.text)
    try:
        j = r.json() if r.text else None
    except ValueError:
        j = None
    return r, j, ms


def is_tmf_error(j, status: int) -> bool:
    return isinstance(j, dict) and all(k in j for k in ("code", "reason", "message", "status")) and str(j["status"]) == str(status)


# ---------------- key management through the admin screen ----------------

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


async def mint_key(page, name: str, all_scopes: bool) -> str:
    await page.get_by_role("button", name="Connect a system").click()
    dialog = page.get_by_role("dialog")
    await dialog.get_by_label("Name shown in activity").fill(name)
    boxes = dialog.get_by_role("checkbox")
    for i in range(await boxes.count()):
        b = boxes.nth(i)
        want = all_scopes or i == 0  # first scope is "read"
        if (await b.get_attribute("aria-checked") == "true") != want:
            await b.click()
    await dialog.get_by_role("button", name="Connect and show key").click()
    code = page.get_by_label("System key")
    await code.wait_for(timeout=15000)
    key = (await code.inner_text()).strip()
    await page.get_by_role("button", name="I've stored it").click()
    await page.wait_for_timeout(800)
    return key


async def disconnect(page, name: str) -> None:
    item = page.get_by_role("list", name="Connected systems").get_by_role("listitem").filter(has_text=name)
    await item.get_by_role("button", name="Disconnect").click()
    await page.get_by_role("dialog").get_by_role("button", name="Disconnect").click()
    await page.wait_for_timeout(2000)


# ---------------- perspectives ----------------

def integrator(full: str, ro: str) -> dict:
    print("\n== 1. Integrator journeys ==")
    # Order care: current approved/effective contract for an order in one call.
    r, j, ms = call("GET", f"/document?relatedEntity.id={ORDER}&lifecycleState=approved,effective", ro)
    timings["Order care: approved docs for order"] = ms
    check(r.status_code == 200 and isinstance(j, list) and len(j) > 0, f"Order care finds approved/effective documents for {ORDER} ({len(j or [])})")
    check(all(d.get("lifecycleState") in ("approved", "effective") for d in (j or [])), "Order care filter returns only approved/effective")
    # Download a file that has stored content.
    r, lst, _ = call("GET", "/document?limit=100", ro)
    dl = None
    for d in lst or []:
        for a in d.get("attachment", []):
            rr, jj, _ = call("GET", f"/document/{d['id']}/attachment/{a['id']}/content", ro)
            if rr.status_code == 200:
                dl = jj
                break
        if dl:
            break
    check(bool(dl and dl.get("expiresInSeconds") == 60), "Download link is issued with a 60-second lifetime")
    if dl:
        check(requests.get(dl["url"], timeout=30).status_code == 200, "Download link fetches the file")

    # CPQ: register a quote, send to review, approval is gated.
    body = {
        "name": f"TMF test quote {RUN}",
        "documentType": "quote",
        "relatedEntity": [{"id": ORDER, "role": "subject", "@referredType": "ProductOrder"}],
        "attachment": {"mimeType": "application/pdf", "size": 1024, "contentHash": hashlib.sha256(RUN.encode()).hexdigest()},
    }
    r, created, ms = call("POST", "/document", full, body, idem=f"cpq-{RUN}")
    timings["CPQ: register document"] = ms
    check(r.status_code == 201 and created and created.get("lifecycleState") == "draft", f"CPQ registers a draft quote (HTTP {r.status_code})")
    doc_id = (created or {}).get("id", "")
    check(bool((created or {}).get("uploadUrl")), "Registration returns a signed upload address")
    r, j, _ = call("POST", f"/document/{doc_id}/transition", full, {"lifecycleState": "in_review"}, idem=f"cpq-rev-{RUN}")
    check(r.status_code == 200 and (j or {}).get("lifecycleState") == "in_review", "CPQ sends quote to review")
    r, j, _ = call("POST", f"/document/{doc_id}/transition", full, {"lifecycleState": "approved"}, idem=f"cpq-apr-{RUN}")
    check(r.status_code in (200, 409), f"Approval answers with a clear result (HTTP {r.status_code}, {(j or {}).get('code')})")
    approve_result = (j or {}).get("code") or (j or {}).get("lifecycleState")

    # Ticket management: no TroubleTicket records exist in the seed; the filter must answer cleanly.
    r, j, _ = call("GET", "/document?relatedEntity.@referredType=TroubleTicket", ro)
    check(r.status_code == 200 and j == [] and r.headers.get("X-Total-Count") == "0", "Ticket filter answers an empty list when no tickets exist")
    r, j, _ = call("POST", "/document", full, {**body, "name": f"TMF test evidence {RUN}", "relatedEntity": [{"id": "tt-unknown-1", "role": "evidence"}]}, idem=f"tt-{RUN}")
    check(r.status_code == 404 and is_tmf_error(j, 404), "Attaching to an unknown ticket is refused with 404")

    # CRM: customer and account documents with sensitivity.
    for t in ("Customer", "Account"):
        r, j, _ = call("GET", f"/document?relatedEntity.@referredType={t}", ro)
        check(r.status_code == 200 and isinstance(j, list) and len(j) > 0, f"CRM lists {t} documents ({len(j or [])})")
        check(all(any(c.get("name") == "sensitivity" for c in d.get("characteristic", [])) or "sensitivity" in json.dumps(d) for d in (j or [])), f"{t} documents show sensitivity")
    return {"doc_id": doc_id, "create_body": body, "approve": approve_result}


def conformance(ro: str) -> None:
    print("\n== 2. TMF conformance ==")
    r, j, ms = call("GET", "/document?limit=5", ro)
    timings["List first page (5)"] = ms
    check(r.status_code == 200 and isinstance(j, list), "List returns a JSON array")
    keys = ("id", "href", "@type", "relatedEntity", "attachment", "lifecycleState")
    check(all(all(k in d for k in keys) for d in j or []), "Each document has id, href, @type, relatedEntity, attachment, lifecycleState")
    check(all(d["@type"] == "Document" for d in j or []), "@type is Document")
    check("X-Total-Count" in r.headers and r.headers.get("X-Result-Count") == str(len(j or [])), "X-Total-Count and X-Result-Count headers present and consistent")
    total = int(r.headers.get("X-Total-Count", "0"))
    r2, j2, _ = call("GET", "/document?limit=2&offset=2", ro)
    check([d["id"] for d in j2 or []] == [d["id"] for d in (j or [])[2:4]], "offset/limit pages line up")
    r3, j3, _ = call("GET", "/document?limit=500", ro)
    check(r3.status_code == 200 and len(j3 or []) <= 100 and len(j3 or []) == min(total, 100), "limit above 100 is capped at 100")
    r4, j4, _ = call("GET", "/document?limit=3&fields=name", ro)
    check(all(set(d.keys()) <= {"id", "href", "@type", "name"} and {"id", "href", "@type"} <= set(d.keys()) for d in j4 or []), "fields=name keeps only id, href, @type, name")
    if j:
        rr, jj, ms = call("GET", j[0]["href"].split("/v4", 1)[1], ro)
        timings["Get one document"] = ms
        check(rr.status_code == 200 and jj.get("id") == j[0]["id"], "href resolves to the same document")
    for q, label in (("limit=abc", "non-numeric limit"), ("lifecycleState=bogus", "unknown lifecycleState"), ("limit=0", "zero limit")):
        rr, jj, _ = call("GET", f"/document?{q}", ro)
        check(rr.status_code == 400 and is_tmf_error(jj, 400), f"{label} → 400 TMF error")
    rr, jj, _ = call("GET", "/documentSpecification", ro)
    check(rr.status_code == 200 and isinstance(jj, list) and len(jj) > 0 and all("@type" in s for s in jj), "documentSpecification list returns typed specs")
    if jj:
        rs, js, _ = call("GET", f"/documentSpecification/{jj[0]['id']}", ro)
        check(rs.status_code == 200, "documentSpecification by id resolves")
    check(bool(r.headers.get("X-Request-ID")), "Replies carry X-Request-ID")
    rr, jj, _ = call("PATCH", "/document/00000000-0000-0000-0000-0000000000d3/transition", ro, {})
    check(rr.status_code == 405 and is_tmf_error(jj, 405) and rr.headers.get("Allow") == "POST", "unsupported method → 405 TMF error with Allow header")
    rr, jj, _ = call("GET", "/nothingHere", ro)
    check(rr.status_code == 404 and is_tmf_error(jj, 404), "unknown API address → 404 TMF error")


def security(full: str, ro: str) -> None:
    print("\n== 3. Security and isolation ==")
    for k, label in ((None, "missing key"), ("not-a-key", "malformed key"), ("erad_" + "0" * 40, "fake key")):
        r, j, _ = call("GET", "/document", k)
        check(r.status_code == 401 and is_tmf_error(j, 401), f"{label} → 401")
    r, j, _ = call("POST", "/document", ro, {"name": "x"}, idem=f"ro-{RUN}")
    check(r.status_code == 403 and (j or {}).get("code") == "scopeMissing", "read-only key cannot add documents (403)")
    r, j, _ = call("POST", "/document/00000000-0000-0000-0000-0000000000d3/transition", ro, {"lifecycleState": "approved"}, idem=f"ro2-{RUN}")
    check(r.status_code == 403, "read-only key cannot change status (403)")
    r, j, _ = call("POST", "/document/00000000-0000-0000-0000-0000000000d3/legalHold", ro, {"active": True, "reason": "x"}, idem=f"ro3-{RUN}")
    check(r.status_code == 403, "read-only key cannot place holds (403)")
    r, j, _ = call("POST", "/hub", ro, {"callback": "https://example.com/cb"})
    check(r.status_code == 403, "read-only key cannot subscribe (403)")
    r, j, _ = call("GET", f"/document/{NO_DOC}", full)
    check(r.status_code == 404, "Sweden key gets 404 for a Norway document")
    r, j, _ = call("GET", f"/document/{NO_DOC}/attachment/{NO_DOC}/content", full)
    check(r.status_code == 404, "Sweden key cannot download a Norway file")
    r, j, _ = call("GET", "/document?relatedEntity.id=ord-no-5520", full)
    check(r.status_code == 200 and j == [], "Filtering by a Norway order returns nothing")
    r, j, _ = call("POST", f"/document/{NO_DOC}/transition", full, {"lifecycleState": "approved"}, idem=f"no-{RUN}")
    check(r.status_code == 404, "Sweden key cannot change a Norway document")
    r, j, _ = call("POST", "/document", full, {"name": "TMF test x", "documentType": "quote", "relatedEntity": [{"id": "ord-no-5520", "role": "subject"}], "attachment": {"mimeType": "application/pdf", "contentHash": "a" * 64}}, idem=f"no2-{RUN}")
    check(r.status_code == 404, "Sweden key cannot attach to a Norway order")
    r, j, _ = call("GET", "/document/not-a-uuid", full)
    check(r.status_code == 404, "non-UUID id → 404, no server error")
    r, j, _ = call("GET", "/document?relatedEntity.id=' OR 1=1 --", full)
    check(r.status_code == 200 and j == [], "injection-style filter returns nothing")
    r, j, _ = call("POST", "/document", full, raw="{not json", idem=f"bad-{RUN}")
    check(r.status_code == 400 and (j or {}).get("code") == "invalidJson", "invalid JSON → 400")
    r, j, _ = call("POST", "/document", full, raw=json.dumps({"name": "x" * 60000}), idem=f"big-{RUN}")
    check(r.status_code == 400 and (j or {}).get("code") == "bodyTooLarge", "body over 50,000 characters → 400")
    for cb in ("http://example.com/cb", "https://localhost/cb", "https://127.0.0.1/cb", "https://10.0.0.5/cb", "https://169.254.169.254/latest", "https://[::1]/cb"):
        r, j, _ = call("POST", "/hub", full, {"callback": cb})
        check(r.status_code == 400, f"unsafe callback refused: {cb}")


def rules(full: str, doc_id: str) -> None:
    print("\n== 4. Business rules ==")
    body = {"name": f"TMF test draft {RUN}", "documentType": "quote", "relatedEntity": [{"id": ORDER, "role": "subject"}], "attachment": {"mimeType": "application/pdf", "contentHash": hashlib.sha256(b"d" + RUN.encode()).hexdigest()}}
    r, d, _ = call("POST", "/document", full, body, idem=f"draft-{RUN}")
    draft = (d or {}).get("id", "")
    r, j, _ = call("POST", f"/document/{draft}/transition", full, {"lifecycleState": "effective"}, idem=f"skip-{RUN}")
    check(r.status_code == 409 and (j or {}).get("code") == "transitionNotAllowed", "draft → effective (skipping steps) is refused")
    r, j, _ = call("PATCH", "/document/00000000-0000-0000-0000-0000000000d5", full, {"name": "Renamed"}, idem=f"frozen-{RUN}")
    check(r.status_code == 409 and (j or {}).get("code") == "frozen", "expired document details can't be edited")
    r, j, _ = call("PATCH", f"/document/{draft}", full, {"name": f"TMF test draft {RUN} (renamed)"}, idem=f"ren-{RUN}")
    check(r.status_code == 200 and (j or {}).get("name", "").endswith("(renamed)"), "draft can be renamed")
    r, j, _ = call("PATCH", f"/document/{draft}", full, {"status": "approved"}, idem=f"extra-{RUN}")
    check(r.status_code == 400, "unknown fields in a change are refused")
    r, j, _ = call("POST", f"/document/{draft}/legalHold", full, {"active": True}, idem=f"h0-{RUN}")
    check(r.status_code == 400, "a hold without a reason is refused")
    r, j, _ = call("POST", f"/document/{draft}/legalHold", full, {"active": True, "reason": "TMF test dispute", "reference": "CASE-1"}, idem=f"h1-{RUN}")
    check(r.status_code == 200 and (j or {}).get("legalHold") is True, "a hold with a reason is placed")
    r, j, _ = call("POST", f"/document/{draft}/legalHold", full, {"active": False, "reason": "TMF test closed"}, idem=f"h2-{RUN}")
    check(r.status_code == 200 and (j or {}).get("legalHold") is False, "the hold is released")
    print(f"INFO draft id for activity check: {draft}")


def reliability(full: str, body: dict) -> str:
    print("\n== 5. Reliability ==")
    r, j, _ = call("POST", "/document", full, body, idem=f"cpq-{RUN}")
    check(r.headers.get("Idempotent-Replay") == "true", "repeating a registration with the same key replays the stored reply")
    r2, lst, _ = call("GET", f"/document?relatedEntity.id={ORDER}&limit=100", full)
    check(sum(1 for d in lst or [] if d.get("name") == body["name"]) == 1, "the repeat did not create a second document")
    r, j, _ = call("POST", "/document", full, {**body, "name": body["name"] + " changed"}, idem=f"cpq-{RUN}")
    check(r.status_code == 409 and (j or {}).get("code") == "idempotencyMismatch", "same key with a different body → 409")
    r, j, _ = call("POST", "/document", full, body)
    check(r.status_code == 400 and (j or {}).get("code") == "idempotencyKeyMissing", "a change without Idempotency-Key → 400")
    return ""


def events(full: str, doc_id: str) -> None:
    print("\n== 5b. Signed event delivery ==")
    if SKIP_SLOW:
        print("SKIP event delivery (SKIP_SLOW=1)")
        return
    tok = requests.post("https://webhook.site/token", timeout=20).json()["uuid"]
    r, sub, _ = call("POST", "/hub", full, {"callback": f"https://webhook.site/{tok}", "query": "eventType=DocumentStateChangeEvent"})
    check(r.status_code == 201 and len((sub or {}).get("signingSecret", "")) == 64, "subscription created with a one-time signing secret")
    secret = (sub or {}).get("signingSecret", "")
    _, nd, _ = call("POST", "/document", full, {"name": f"TMF test event {RUN}", "documentType": "quote", "relatedEntity": [{"id": ORDER, "role": "subject"}], "attachment": {"mimeType": "application/pdf", "contentHash": hashlib.sha256(b"e" + RUN.encode()).hexdigest()}}, idem=f"evc-{RUN}")
    doc_id = (nd or {}).get("id", doc_id)
    r, j, _ = call("POST", f"/document/{doc_id}/transition", full, {"lifecycleState": "in_review"}, idem=f"ev-{RUN}")
    print(f"INFO transition for event: HTTP {r.status_code} {(j or {}).get('lifecycleState') or (j or {}).get('code')}")
    got = None
    for _ in range(30):
        time.sleep(5)
        reqs = requests.get(f"https://webhook.site/token/{tok}/requests?sorting=newest", headers={"Accept": "application/json"}, timeout=20).json().get("data", [])
        for q in reqs:
            if doc_id in (q.get("content") or ""):
                got = q
                break
        if got:
            break
    check(got is not None, "event delivered to the subscriber within 150 seconds")
    if got:
        content = got["content"]
        sig = (got["headers"].get("x-signature") or [""])[0]
        expect = "sha256=" + hmac.new(secret.encode(), content.encode(), hashlib.sha256).hexdigest()
        check(hmac.compare_digest(sig, expect), "X-Signature matches HMAC-SHA256 of the body")
        ev = json.loads(content)
        check(ev.get("eventType") == "DocumentStateChangeEvent" and ev["event"]["document"]["id"] == doc_id, "event names the document and change type")
        check(set(ev["event"]["document"].keys()) <= {"id", "href", "@type", "lifecycleState"}, "event carries no document content or details")
    if sub:
        r, _, _ = call("DELETE", f"/hub/{sub['id']}", full)
        check(r.status_code == 204, "unsubscribe → 204")


async def main() -> None:
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await admin_page(browser)
        full_name, ro_name = f"TMF test full {RUN}", f"TMF test read {RUN}"
        full = await mint_key(page, full_name, True)
        ro = await mint_key(page, ro_name, False)
        check(full.startswith("erad_") and ro.startswith("erad_"), "admin screen issued two system keys")
        try:
            ctx = integrator(full, ro)
            conformance(ro)
            security(full, ro)
            rules(full, ctx["doc_id"])
            reliability(full, ctx["create_body"])
            events(full, ctx["doc_id"])
            if not SKIP_SLOW:
                print("\n== Download link expiry ==")
                r, lst, _ = call("GET", "/document?limit=100", ro)
                url = None
                for d in lst or []:
                    for a in d.get("attachment", []):
                        rr, jj, _ = call("GET", f"/document/{d['id']}/attachment/{a['id']}/content", ro)
                        if rr.status_code == 200:
                            url = jj["url"]
                            break
                    if url:
                        break
                if url:
                    time.sleep(65)
                    check(requests.get(url, timeout=30).status_code >= 400, "download link stops working after 60 seconds")
        finally:
            await disconnect(page, ro_name)
            r, j, _ = call("GET", "/document", ro)
            check(r.status_code == 401, "a disconnected key stops working straight away")
            await disconnect(page, full_name)
            await browser.close()

    print("\n== 6. Timing (ms) ==")
    for k, v in timings.items():
        print(f"TIME {k}: {v:.0f}")
    leaked = [s for s in NORWAY_STRINGS if any(s in b for b in bodies)]
    check(not leaked, f"no Norway details in any of {len(bodies)} replies to Sweden keys {leaked or ''}")
    print(f"\nRun {RUN}: {len(failures)} failure(s)")
    sys.exit(1 if failures else 0)


asyncio.run(main())
