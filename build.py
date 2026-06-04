#!/usr/bin/env python3
"""Build the stress-aware recovery dashboard.

Pulls the last 14 days of Oura readiness + sleep scores if OURA_TOKEN is set,
otherwise falls back to sample_data.json. Inlines the data into template.html
and writes a self-contained index.html.

Usage:
    python build.py            # real data if OURA_TOKEN is set, else sample
    OURA_TOKEN=xxx python build.py
"""

import json
import os
import sys
import urllib.error
import urllib.request
from datetime import date, datetime, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
TEMPLATE = os.path.join(HERE, "template.html")
SAMPLE = os.path.join(HERE, "sample_data.json")
DATA_CACHE = os.path.join(HERE, "data.json")
OUTPUT = os.path.join(HERE, "index.html")

OURA_BASE = "https://api.ouraring.com/v2/usercollection"
DAYS = 14


def load_env_token():
    """Read OURA_TOKEN from the environment or a local .env file."""
    token = os.environ.get("OURA_TOKEN", "").strip()
    if token:
        return token
    env_path = os.path.join(HERE, ".env")
    if os.path.exists(env_path):
        with open(env_path) as f:
            for line in f:
                line = line.strip()
                if line.startswith("OURA_TOKEN="):
                    return line.split("=", 1)[1].strip()
    return ""


def _get(endpoint, token, start, end):
    url = f"{OURA_BASE}/{endpoint}?start_date={start}&end_date={end}"
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.loads(resp.read().decode())["data"]


def fetch_oura(token):
    """Return merged [{day, readiness, sleep}] from the Oura API."""
    end = date.today()
    start = end - timedelta(days=DAYS - 1)
    readiness = _get("daily_readiness", token, start, end)
    sleep = _get("daily_sleep", token, start, end)

    by_day = {}
    for r in readiness:
        by_day.setdefault(r["day"], {})["readiness"] = r.get("score")
    for s in sleep:
        by_day.setdefault(s["day"], {})["sleep"] = s.get("score")

    merged = [
        {"day": day, "readiness": v.get("readiness"), "sleep": v.get("sleep")}
        for day, v in sorted(by_day.items())
    ]
    return merged


def get_data():
    """(data, source). Try Oura, fall back to sample data on any failure."""
    token = load_env_token()
    if token:
        try:
            data = fetch_oura(token)
            if data:
                with open(DATA_CACHE, "w") as f:
                    json.dump(data, f, indent=2)
                return data, "oura"
            print("Oura returned no data; using sample data.", file=sys.stderr)
        except urllib.error.HTTPError as e:
            print(f"Oura API error ({e.code}); using sample data.", file=sys.stderr)
        except Exception as e:
            print(f"Oura fetch failed ({e}); using sample data.", file=sys.stderr)
    else:
        print("No OURA_TOKEN set; using sample data.", file=sys.stderr)

    with open(SAMPLE) as f:
        return json.load(f), "sample"


def build():
    data, source = get_data()
    with open(TEMPLATE) as f:
        html = f.read()

    html = html.replace("__OURA_DATA__", json.dumps(data))
    html = html.replace("__DATA_SOURCE__", source)
    html = html.replace("__GENERATED_AT__", datetime.now().strftime("%Y-%m-%d %H:%M"))

    with open(OUTPUT, "w") as f:
        f.write(html)

    print(f"Built {OUTPUT} from {source} data ({len(data)} days).")


if __name__ == "__main__":
    build()
