"""Send a test RFID scan to the TAPIN API every 10 seconds."""

import json
import os
import time
from datetime import datetime
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


API_BASE_URL = os.getenv(
    "TAPIN_API_URL",
    "http://lolenseu.pythonanywhere.com",
).rstrip("/")
RFID = "0987654"
DEVICE_ID = "esp32-rfid-001"
INTERVAL_SECONDS = 10
TIMEOUT_SECONDS = 15


def send_test_scan():
    payload = {
        "device_id": DEVICE_ID,
        "rfid": RFID,
        "scanned_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
    }
    body = json.dumps(payload).encode("utf-8")
    request = Request(
        f"{API_BASE_URL}/api/receive-rfid",
        data=body,
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
        method="POST",
    )

    try:
        with urlopen(request, timeout=TIMEOUT_SECONDS) as response:
            response_body = response.read().decode("utf-8", errors="replace")
            print(f"HTTP {response.status}: {response_body}")
    except HTTPError as error:
        response_body = error.read().decode("utf-8", errors="replace")
        print(f"HTTP {error.code}: {response_body}")
    except (URLError, TimeoutError, OSError) as error:
        print(f"Request failed: {error}")


def main():
    print(f"Sending RFID {RFID} to {API_BASE_URL} every {INTERVAL_SECONDS} seconds.")
    print("Press Ctrl+C to stop.")
    try:
        while True:
            print(f"[{datetime.now().isoformat(timespec='seconds')}] Sending scan...")
            send_test_scan()
            time.sleep(INTERVAL_SECONDS)
    except KeyboardInterrupt:
        print("\nRFID tester stopped.")


if __name__ == "__main__":
    main()
