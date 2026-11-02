"""Per-host transfer budget for the assessment scripts.

SPA-93 review item 7: the first pass pulled on the order of 1.1 GB from
mesonet.agron.iastate.edu before that host began throttling. These are
third-party academic mirrors run as a courtesy, so the cap is now enforced in
code rather than left to intent.

A ledger under ``$MRMS_CACHE/../fetch_ledger.json`` accumulates bytes and
request counts per host across runs. ``charge()`` raises ``BudgetExceeded``
before a request is issued once a host is over its cap, so a script fails
loudly and partially rather than quietly continuing to pull. Bytes served from
the local cache are not charged -- only bytes that actually crossed the wire.

Default cap is 700 MB per host, under the 1 GB figure above which the reviewer
asked us to come back to the ticket first. Override with
``MRMS_HOST_BUDGET_MB``; there is deliberately no "unlimited" value.
"""
import json, os, threading
from urllib.parse import urlparse

BUDGET_MB = float(os.environ.get("MRMS_HOST_BUDGET_MB", "700"))
_LOCK = threading.Lock()


class BudgetExceeded(RuntimeError):
    pass


def _ledger_path():
    cache = os.environ.get("MRMS_CACHE", ".")
    return os.path.join(os.path.dirname(os.path.abspath(cache)), "fetch_ledger.json")


def _load():
    try:
        with open(_ledger_path()) as f:
            return json.load(f)
    except Exception:
        return {}


def _save(d):
    tmp = _ledger_path() + ".tmp"
    with open(tmp, "w") as f:
        json.dump(d, f, indent=1, sort_keys=True)
    os.replace(tmp, _ledger_path())


def check(url):
    """Raise if this host is already over budget. Call before issuing a request."""
    host = urlparse(url).netloc
    with _LOCK:
        d = _load()
        spent = d.get(host, {}).get("bytes", 0)
    if spent > BUDGET_MB * 1e6:
        raise BudgetExceeded(
            f"{host}: {spent/1e6:.1f} MB already fetched, cap is {BUDGET_MB:.0f} MB. "
            "Raise MRMS_HOST_BUDGET_MB only after asking on the ticket."
        )


def charge(url, nbytes):
    """Record bytes that crossed the wire for this host."""
    host = urlparse(url).netloc
    with _LOCK:
        d = _load()
        e = d.setdefault(host, {"bytes": 0, "requests": 0})
        e["bytes"] += int(nbytes)
        e["requests"] += 1
        _save(d)


def report():
    d = _load()
    return {h: {"MB": round(e["bytes"] / 1e6, 1), "requests": e["requests"]}
            for h, e in sorted(d.items())}
