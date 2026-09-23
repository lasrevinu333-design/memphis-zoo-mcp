import os
import re
import sys
import time
import json
import traceback
from datetime import datetime, timezone

import requests
from dotenv import load_dotenv
from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeoutError

load_dotenv()

ATTENDANCE_COLLECTOR_TOKEN = os.getenv("ATTENDANCE_COLLECTOR_TOKEN", "").strip()
PUSH_URL = os.getenv("ATTENDANCE_PUSH_URL", "https://memphis-zoo-mcp.onrender.com/collector-api/visitor-attendance").strip()
SOURCE_URL = os.getenv("SOURCE_URL", "https://nd.memzoo.org/").strip()
REFRESH_SECONDS = int(os.getenv("REFRESH_SECONDS", "30"))
HEADLESS_BROWSER = os.getenv("ATTENDANCE_PUSHER_HEADLESS", "false").strip().lower() not in {"0", "false", "no", "off"}

if len(ATTENDANCE_COLLECTOR_TOKEN) < 32:
    raise RuntimeError("Missing dedicated ATTENDANCE_COLLECTOR_TOKEN in .env")
if not PUSH_URL:
    raise RuntimeError("Missing PUSH_URL in .env")

LOG_FILE = "attendance_pusher.log"


def log(message: str) -> None:
    stamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    line = f"[{stamp}] {message}"
    print(line)
    with open(LOG_FILE, "a", encoding="utf-8") as f:
        f.write(line + "\n")


def parse_int_from_text(text: str):
    if not isinstance(text, str):
        return None
    value = text.strip()
    if not re.fullmatch(r"(?:[0-9]+|[0-9]{1,3}(?:,[0-9]{3})+)", value):
        return None
    number = int(value.replace(",", ""))
    return number if number <= 2147483647 else None


def extract_labeled_metric(text: str, label: str):
    """
    Pull labeled attendance metrics from the Attendance card body.

    Expected examples from nd.memzoo.org:
      Last Year: 2,706
      Planned: 2000
      Yesterday: 4,256
      Yesterday Plan: 2500
    """
    if not text:
        return None

    escaped = re.escape(label)
    match = re.search(rf"\b{escaped}\s*:\s*(.*?)(?=\s+(?:Last Year|Planned|Yesterday Plan|Yesterday)\s*:|$)", text, flags=re.IGNORECASE | re.DOTALL)
    if not match:
        return None
    value = parse_int_from_text(match.group(1))
    if value is None:
        raise RuntimeError(f"Invalid {label} visitor metric")
    return value


def extract_attendance_from_page(page):
    headers = page.locator("h5.card-header")
    count = headers.count()

    for i in range(count):
        header = headers.nth(i)
        header_text = (header.text_content() or "").strip().lower()
        if "attendance" not in header_text:
            continue

        card = header.locator("xpath=ancestor::div[contains(@class,'card')][1]")
        body = card.locator(".card-body")
        value_text = (body.locator("h1").first.text_content() or "").strip()
        body_text = (body.text_content() or "").replace("\xa0", " ").strip()

        attendance = parse_int_from_text(value_text)
        if attendance is None:
            raise RuntimeError(f"Attendance text found but could not parse integer: {value_text!r}")

        return {
            "attendance": attendance,
            "last_year": extract_labeled_metric(body_text, "Last Year"),
            "planned": extract_labeled_metric(body_text, "Planned"),
            "yesterday": extract_labeled_metric(body_text, "Yesterday"),
            "yesterday_plan": extract_labeled_metric(body_text, "Yesterday Plan"),
            "source": "home-browser-auto-push",
            "fetched_at": datetime.now(timezone.utc).isoformat()
        }

    raise RuntimeError("Attendance card/header not found on page")

def push_attendance(payload: dict):
    headers = {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + ATTENDANCE_COLLECTOR_TOKEN,
    }

    response = requests.post(PUSH_URL, headers=headers, json=payload, timeout=20)
    try:
        data = response.json()
    except Exception:
        data = {"raw": response.text}

    if response.status_code >= 400:
        raise RuntimeError(f"Push failed: HTTP {response.status_code} | {json.dumps(data)}")

    if not isinstance(data, dict) or not data.get("ok"):
        raise RuntimeError(f"Push failed: malformed response | {json.dumps(data)}")

    return data


def ensure_page_loaded(page):
    page.goto(SOURCE_URL, wait_until="domcontentloaded", timeout=45000)
    page.wait_for_timeout(3000)
    page.locator("h5.card-header").filter(has_text="Attendance").first.wait_for(timeout=30000)


def main():
    log("Attendance pusher starting.")

    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=HEADLESS_BROWSER,
            args=["--disable-blink-features=AutomationControlled"],
        )
        log(f"Chromium launched with headless={HEADLESS_BROWSER}.")

        context = browser.new_context()
        page = context.new_page()
        page.set_default_timeout(45000)

        while True:
            cycle_start = time.time()

            try:
                log("Starting cycle.")
                ensure_page_loaded(page)
                payload = extract_attendance_from_page(page)
                result = push_attendance(payload)
                log(f"Push OK. Attendance={payload['attendance']} Response={json.dumps(result)}")

            except PlaywrightTimeoutError as e:
                log(f"Browser timeout: {e}")
                log("Will retry next cycle.")

            except requests.RequestException as e:
                log(f"Network/push error: {e}")
                log("Likely internet/backend issue. Will retry next cycle.")

            except Exception as e:
                log(f"General failure: {e}")
                traceback.print_exc()
                with open(LOG_FILE, "a", encoding="utf-8") as f:
                    f.write(traceback.format_exc() + "\n")
                log("Will retry next cycle.")

            try:
                log("Refreshing source page for next cycle.")
                page.reload(wait_until="domcontentloaded", timeout=45000)
            except Exception as e:
                log(f"Reload failed: {e}")
                log("Will try full goto on next cycle.")

            elapsed = time.time() - cycle_start
            sleep_for = max(1, REFRESH_SECONDS - int(elapsed))
            log(f"Sleeping {sleep_for}s before next cycle.")
            time.sleep(sleep_for)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        log("Stopped by user.")
        sys.exit(0)
