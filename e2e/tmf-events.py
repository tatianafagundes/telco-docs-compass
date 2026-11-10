"""Change notifications end to end with controlled subscribers.

Run against the dev server:  python3 e2e/tmf-events.py   (exit code 1 on any failure)
  - Creates three temporary systems with e2e/events-helper.ts: two in Sweden (A healthy, B flaky) and
    one in Norway (N). Each subscribes a webhook.site receiver whose reply code the test controls.
  - Delivery passes are run directly (same code as the scheduled sender) so retries can be driven
    without waiting; "due-now" fast-forwards a backoff instead of sleeping for it.
  - Covers: authentication (subscribe, sender endpoint, signatures), retries with backoff, giving up,
    duplicate handling (healthy subscriber never re-sent, overlapping passes, stable event id),
    and tenant isolation (Sweden and Norway never see each other's events).
  - Documents created are named "TMF test event …"; "Reset test data" removes them.
"""
import hashlib
import hmac
import json
import os
import subprocess
import sys
import time
import uuid
from concurrent.futures import ThreadPoolExecutor

import requests

BASE = os.environ.get("BASE_URL", "http://localhost:8080")
STD = BASE + "/api/public/tmf-api/document/v4"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RUN = uuid.uuid4().hex[:6]
HOOK = "https://webhook.site"
failures: list[str] = []


def check(ok: bool, msg: str) -> None:
    print(("PASS " if ok else "FAIL ") + msg, flush=True)
    if not ok:
        failures.append(msg)


def helper(*args: str):
    out = subprocess.run(["bun", "e2e/events-helper.ts", *args], capture_output=True, text=True, cwd=ROOT, timeout=120)
    line = (out.stdout.strip().splitlines() or [""])[-1]
    try:
        return json.loads(line)
    except ValueError:
        raise RuntimeError(f"helper {args[0]} failed: {out.stderr[-300:]}")


def api(method: str, path: str, key: str | None, body=None, idem: str | None = None):
    h = {"Content-Type": "application/json"}
    if key:
        h["Authorization"] = f"Bearer {key}"
    if idem:
        h["Idempotency-Key"] = idem
    r = requests.request(method, STD + path, headers=h, data=json.dumps(body) if body is not None else None, timeout=60)
    try:
        return r, (r.json() if r.text else None)
    except ValueError:
        return r, None


def hook(method: str, url: str, **kw):
    """Calls the test receiver's control API, waiting out its own rate limit."""
    for _ in range(4):
        r = requests.request(method, url, timeout=20, **kw)
        if r.status_code != 429:
            return r
        print("INFO receiver control API is rate limiting; waiting 60 s", flush=True)
        time.sleep(60)
    return r


def receiver(status: int) -> str:
    return hook("POST", f"{HOOK}/token", json={"default_status": status}).json()["uuid"]


def set_status(tok: str, status: int) -> None:
    hook("PUT", f"{HOOK}/token/{tok}", json={"default_status": status})


def received(tok: str) -> list[dict]:
    time.sleep(2)  # receiver's request log is eventually consistent
    out, page = [], 1
    while True:
        j = hook("GET", f"{HOOK}/token/{tok}/requests?sorting=oldest&per_page=100&page={page}", headers={"Accept": "application/json"}).json()
        out += j.get("data", [])
        if j.get("is_last_page", True):
            return out
        page += 1


def hdr(q: dict, name: str) -> str:
    return (q.get("headers", {}).get(name) or [""])[0]


def for_doc(reqs: list[dict], doc_id: str) -> list[dict]:
    return [q for q in reqs if doc_id in (q.get("content") or "")]


def new_doc(key: str, entity: str, label: str) -> str:
    r, j = api("POST", "/document", key, {"name": f"TMF test event {label} {RUN}", "documentType": "quote", "relatedEntity": [{"id": entity, "role": "subject"}], "attachment": {"mimeType": "application/pdf", "contentHash": hashlib.sha256(f"{label}{RUN}".encode()).hexdigest()}}, idem=f"ev-{label}-{RUN}")
    if r.status_code != 201:
        raise RuntimeError(f"could not add document {label}: {r.status_code} {r.text[:200]}")
    return j["id"]


def verify(secret: str, q: dict) -> bool:
    ts, sig, body = hdr(q, "x-signature-timestamp"), hdr(q, "x-signature"), q.get("content") or ""
    expect = "sha256=" + hmac.new(secret.encode(), f"{ts}.{body}".encode(), hashlib.sha256).hexdigest()
    return ts.isdigit() and abs(time.time() - int(ts)) < 300 and hmac.compare_digest(sig, expect)


def main() -> None:
    scopes = "read,register,transition,subscribe"
    a = helper("mint", "aurora-se", f"TMF test events A {RUN}", scopes)
    b = helper("mint", "aurora-se", f"TMF test events B {RUN}", scopes)
    n = helper("mint", "aurora-no", f"TMF test events N {RUN}", scopes)
    ro = helper("mint", "aurora-se", f"TMF test events RO {RUN}", "read")
    clients = [a, b, n, ro]
    n2 = helper("mint", "aurora-no", f"TMF test events N2 {RUN}", scopes)
    clients.append(n2)
    try:
        run(a, b, n, ro)
        batch(b, n2)
    finally:
        for c in clients:
            helper("revoke", c["id"])
    print(f"\nRun {RUN}: {len(failures)} failure(s)")
    sys.exit(1 if failures else 0)


def batch(b: dict, n2: dict) -> None:
    print("\n== 9. DocumentBatchEvent ==")
    rbat, rplain, rnor = receiver(200), receiver(200), receiver(200)
    _, sbat = api("POST", "/hub", b["key"], {"callback": f"{HOOK}/{rbat}", "query": "eventType=DocumentBatchEvent"})
    _, splain = api("POST", "/hub", b["key"], {"callback": f"{HOOK}/{rplain}"})
    _, snor = api("POST", "/hub", n2["key"], {"callback": f"{HOOK}/{rnor}", "query": "eventType=DocumentBatchEvent"})
    d1, d2 = new_doc(b["key"], "ord-se-7731", "bat1"), new_doc(b["key"], "ord-se-7731", "bat2")
    helper("deliver")
    plain_before = len(received(rplain))
    helper("batch", "aurora-se", d1, d2)
    helper("deliver")
    got = received(rbat)
    bodies = [json.loads(q["content"]) for q in got]
    batches = [x for x in bodies if x["eventType"] == "DocumentBatchEvent"]
    check(len(batches) == 1 and sorted(x["id"] for x in batches[0]["event"]["document"]) == sorted([d1, d2]), "batch subscriber gets one DocumentBatchEvent listing both documents")
    check(len(got) == len(batches), "batch-only subscriber gets no per-document events")
    check(all(verify(sbat["signingSecret"], q) for q in got), "batch event is signed for that subscriber")
    check(not any(json.loads(q["content"])["eventType"] == "DocumentBatchEvent" for q in received(rplain)[plain_before:]), "subscribers that didn't ask for batch events don't get them")
    check(not received(rnor), "a Norway batch subscriber gets nothing about Sweden bulk changes")
    helper("deliver")
    check(len(received(rbat)) == len(got), "the batch event is not delivered twice")


def run(a: dict, b: dict, n: dict, ro: dict) -> None:
    ra, rb, rn = receiver(200), receiver(503), receiver(200)

    print("\n== 1. Authentication ==")
    r, j = api("POST", "/hub", None, {"callback": f"{HOOK}/{ra}"})
    check(r.status_code == 401, "subscribe without a key → 401")
    r, j = api("POST", "/hub", ro["key"], {"callback": f"{HOOK}/{ra}"})
    check(r.status_code == 403 and (j or {}).get("code") == "scopeMissing", "subscribe with a key lacking 'subscribe' → 403")
    for bad in ("http://example.com/hook", "https://127.0.0.1/hook", "https://localhost/hook", "https://10.0.0.5/hook"):
        r, j = api("POST", "/hub", a["key"], {"callback": bad})
        check(r.status_code == 400 and (j or {}).get("code") == "invalidCallback", f"unsafe callback refused: {bad}")
    d = requests.post(BASE + "/api/public/tmf-events/deliver", timeout=30)
    check(d.status_code == 401, "sender endpoint without the scheduler token → 401")
    d = requests.post(BASE + "/api/public/tmf-events/deliver", headers={"Authorization": "Bearer not-the-secret"}, timeout=30)
    check(d.status_code == 401, "sender endpoint with a wrong token → 401")

    r, sa = api("POST", "/hub", a["key"], {"callback": f"{HOOK}/{ra}"})
    r2, sb = api("POST", "/hub", b["key"], {"callback": f"{HOOK}/{rb}"})
    r3, sn = api("POST", "/hub", n["key"], {"callback": f"{HOOK}/{rn}"})
    check(all(x.status_code == 201 for x in (r, r2, r3)), "three subscriptions created (Sweden A, Sweden B, Norway N)")
    r, _ = api("DELETE", f"/hub/{sa['id']}", b["key"])
    check(r.status_code == 404, "a system cannot remove another system's subscription")
    r, _ = api("DELETE", f"/hub/{sa['id']}", n["key"])
    check(r.status_code == 404, "a Norway system cannot remove a Sweden subscription")

    print("\n== 2. First delivery ==")
    se_doc = new_doc(a["key"], "ord-se-7731", "se1")
    r, _ = api("POST", f"/document/{se_doc}/transition", a["key"], {"lifecycleState": "in_review"}, idem=f"tr-{RUN}")
    check(r.status_code == 200, "Sweden document moved to review (second event)")
    no_doc = new_doc(n["key"], "ord-no-5520", "no1")
    res = helper("deliver")
    print(f"INFO pass: {res}")
    qa, qb, qn = received(ra), received(rb), received(rn)
    a_se = for_doc(qa, se_doc)
    se_ids = sorted({hdr(q, "x-event-id") for q in a_se})
    types = sorted(json.loads(q["content"])["eventType"] for q in a_se)
    check(len(a_se) >= 2 and "DocumentCreateEvent" in types and any(json.loads(q["content"])["event"]["document"].get("status") == "reviewed" for q in a_se), f"A received the create and the move-to-review events ({types})")
    check(len(se_ids) == len(a_se), "each event arrived once, with its own X-Event-Id")
    check(all(verify(sa["signingSecret"], q) for q in a_se), "A's events carry a valid, recent signature for A's secret")
    check(not any(verify(sb["signingSecret"], q) for q in a_se), "A's events do not verify with B's secret")
    check(all(hdr(q, "x-delivery-attempt") == "1" for q in a_se), "first try is marked X-Delivery-Attempt: 1")
    check(all(json.loads(q["content"])["eventId"] == hdr(q, "x-event-id") for q in a_se), "body eventId matches X-Event-Id")
    check(sorted(hdr(q, "x-event-id") for q in for_doc(qb, se_doc)) == se_ids, "B was tried for the same events (and replied 503)")

    print("\n== 3. Tenant isolation ==")
    check(len(for_doc(qn, no_doc)) >= 1, "N received its Norway event")
    check(not for_doc(qn, se_doc), "N received nothing about the Sweden document")
    check(not for_doc(qa, no_doc) and not for_doc(qb, no_doc), "A and B received nothing about the Norway document")
    leaks = [s for s in ("aurora-no", "ord-no-", no_doc) for q in qa + qb if s in json.dumps(q)]
    check(not leaks, "no Norway identifiers anywhere in Sweden deliveries")
    check(all(verify(sn["signingSecret"], q) for q in qn), "N's events verify with N's own secret")

    print("\n== 4. Retries and backoff ==")
    st = helper("status", sb["id"])
    check(len(st) == len(se_ids) and all(x["attempts"] == 1 and x["delivered_at"] is None and x["last_status"] == 503 for x in st), f"B's {len(se_ids)} deliveries recorded as failed once (503)")
    waits = [(time.mktime(time.strptime(x["next_attempt_at"][:19], "%Y-%m-%dT%H:%M:%S")) - time.mktime(time.gmtime())) for x in st]
    check(all(15 <= w <= 45 for w in waits), f"next try scheduled about 30 s later ({[round(w) for w in waits]})")
    sta = helper("status", sa["id"])
    check(len(sta) == len(se_ids) and all(x["delivered_at"] and x["attempts"] == 1 for x in sta), "A's deliveries recorded as delivered after one try")
    helper("deliver")
    check(len(received(rb)) == len(qb), "B is not retried before its backoff ends")
    check(len(received(ra)) == len(qa), "A is not sent anything again (no duplicates for a healthy subscriber)")

    set_status(rb, 200)
    helper("due-now", sb["id"])
    helper("deliver")
    qb2 = for_doc(received(rb), se_doc)
    k = len(se_ids)
    retried = qb2[k:]
    check(len(retried) == k and all(hdr(q, "x-delivery-attempt") == "2" for q in retried), f"after B recovers, its {k} events are retried as attempt 2")
    first_ids = sorted(hdr(q, "x-event-id") for q in qb2[:k])
    check(sorted(hdr(q, "x-event-id") for q in retried) == first_ids, "retries keep the same X-Event-Id")
    check(sorted(json.loads(q["content"])["eventId"] for q in retried) == first_ids, "retries keep the same eventId in the body")
    check(all(verify(sb["signingSecret"], q) for q in retried), "retries are freshly signed with a valid timestamp")
    check(all(x["delivered_at"] for x in helper("status", sb["id"])), "B's deliveries now recorded as delivered")
    check(len(for_doc(received(ra), se_doc)) == k, "A still received each event exactly once while B was retried")

    print("\n== 5. Receiver-side duplicate handling ==")
    seen, processed = set(), 0
    for q in qb2:
        eid = hdr(q, "x-event-id")
        if eid not in seen and verify(sb["signingSecret"], q):
            seen.add(eid)
            processed += 1
    check(processed == k and len(qb2) == 2 * k, f"a receiver that keys on X-Event-Id processes {k} events from {2 * k} deliveries")

    print("\n== 6. Overlapping delivery passes ==")
    docs = [new_doc(a["key"], "ord-se-7731", f"par{i}") for i in range(3)]
    with ThreadPoolExecutor(max_workers=3) as ex:
        list(ex.map(lambda _: helper("deliver"), range(3)))
    qa3 = received(ra)
    per_doc = [[hdr(q, "x-event-id") for q in for_doc(qa3, d)] for d in docs]
    check(all(len(x) >= 1 and len(x) == len(set(x)) for x in per_doc), f"three passes at once still deliver each new event once to A ({[len(x) for x in per_doc]})")
    ids = [hdr(q, "x-event-id") for q in qa3]
    check(len(ids) == len(set(ids)), f"A never received the same event id twice ({len(ids)} deliveries)")

    print("\n== 7. Giving up ==")
    set_status(rb, 500)
    gdoc = new_doc(a["key"], "ord-se-7731", "giveup")
    helper("deliver")
    for _ in range(6):
        helper("due-now", sb["id"])
        helper("deliver")
    by_event: dict[str, list[str]] = {}
    for q in for_doc(received(rb), gdoc):
        by_event.setdefault(hdr(q, "x-event-id"), []).append(hdr(q, "x-delivery-attempt"))
    check(by_event and all(v == ["1", "2", "3", "4", "5", "6"] for v in by_event.values()), f"B is tried 6 times per event then stops ({by_event})")
    gst = [x for x in helper("status", sb["id"]) if x["delivered_at"] is None]
    check(len(gst) == len(by_event) and all(x["gave_up_at"] and x["attempts"] == 6 and x["last_status"] == 500 for x in gst), "those deliveries are recorded as given up after 6 attempts")
    a_g = [hdr(q, "x-event-id") for q in for_doc(received(ra), gdoc)]
    check(sorted(a_g) == sorted(by_event), "A received each of those events once, unaffected by B's failures")

    print("\n== 8. Unsubscribe and disconnect ==")
    r, _ = api("DELETE", f"/hub/{sa['id']}", a["key"])
    check(r.status_code == 204, "A unsubscribes → 204")
    no_after = new_doc(n["key"], "ord-no-5520", "noafter")
    helper("revoke", n["id"])
    before_a, before_n = len(received(ra)), len(received(rn))
    new_doc(a["key"], "ord-se-7731", "after")
    check(not for_doc(received(rn), no_after), "N's last event was not yet sent when its system was disconnected")
    helper("deliver")
    check(len(received(ra)) == before_a, "nothing is sent to A after it unsubscribed")
    check(len(received(rn)) == before_n, "nothing is sent to N after its system was disconnected")


if __name__ == "__main__":
    main()
