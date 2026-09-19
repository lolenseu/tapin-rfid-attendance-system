## Imports
import os
import json
import hashlib
import calendar
import jwt
import secrets
import io
import re
import socket
from datetime import datetime, timedelta

from flask import Flask, jsonify, request, session, send_from_directory, send_file, make_response
from flask_cors import CORS
from werkzeug.utils import secure_filename

# Try to import PIL for image processing
try:
    from PIL import Image
    PIL_AVAILABLE = True
except ImportError:
    PIL_AVAILABLE = False
    print("Warning: Pillow not installed. Image compression will be disabled.")

# Try to import reportlab, fallback if not installed
try:
    from reportlab.lib.pagesizes import letter, landscape
    from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer, Image
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib import colors
    from reportlab.lib.units import inch, cm
    from reportlab.pdfgen import canvas
    from reportlab.lib.enums import TA_CENTER, TA_RIGHT, TA_LEFT
    REPORTLAB_AVAILABLE = True
except ImportError:
    REPORTLAB_AVAILABLE = False
    print("Warning: reportlab not installed. PDF generation will be disabled.")

# Try to import requests for version checking
try:
    import requests
    REQUESTS_AVAILABLE = True
except ImportError:
    REQUESTS_AVAILABLE = False
    print("Warning: requests not installed. Version checking will be disabled.")

## Variables ------------------------------------
# Create the Flask application.
app = Flask(__name__)
app.secret_key = os.environ.get("FLASK_SECRET_KEY", "tapin-development-secret-key")
app.permanent_session_lifetime = timedelta(minutes=30)

# ============================================================================
# ENVIRONMENT DETECTION
# ============================================================================

def is_production():
    """Detect if running in production environment."""
    return os.environ.get("ENVIRONMENT", "").lower() in ["production", "prod"] or \
           os.environ.get("RAILWAY_ENVIRONMENT", "").lower() == "production" or \
           os.environ.get("RENDER", "").lower() == "true"

def get_base_url():
    """Get the base URL for the application."""
    if is_production():
        return os.environ.get("BASE_URL", "https://lolenseu.pythonanywhere.com")
    else:
        return "http://localhost:5000"

# ============================================================================
# PORT UTILITY - Find a free port if the default is in use
# ============================================================================

def find_free_port(start_port=5000, max_attempts=20):
    """
    Find a free port starting from start_port.
    Tries up to max_attempts consecutive ports.
    Returns the first free port found, or None if none are available.
    """
    for port in range(start_port, start_port + max_attempts):
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                s.bind(("0.0.0.0", port))
                return port
        except OSError:
            continue
    return None

def is_port_in_use(port):
    """Check if a specific port is currently in use."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        try:
            s.bind(("0.0.0.0", port))
            return False
        except OSError:
            return True

# ============================================================================
# CORS Configuration - Works for Both Local and Production
# ============================================================================

# Allowed origins for both local and production
ALLOWED_ORIGINS = [
    # Production
    "https://tapin-2s5w.onrender.com",
    "https://tapin-api.up.railway.app",
    # Local development
    "http://localhost:5000",
    "http://127.0.0.1:5000",
    "http://localhost:5500",
    "http://127.0.0.1:5500",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    # Allow any localhost port for development
    "http://localhost:*",
    "http://127.0.0.1:*",
]

# For development, allow all origins
if not is_production():
    ALLOWED_ORIGINS.append("*")

CORS(app,
     origins=ALLOWED_ORIGINS,
     supports_credentials=True,
     allow_headers=["Content-Type", "Authorization", "Cookie", "Set-Cookie", "X-Requested-With"],
     expose_headers=["Content-Type", "Authorization"],
     methods=["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"])

# ============================================================================
# Session Configuration - Adapts to Environment
# ============================================================================

app.config.update(
    SESSION_COOKIE_SAMESITE='Lax' if not is_production() else 'None',
    SESSION_COOKIE_SECURE=is_production(),  # True in production (HTTPS), False in dev (HTTP)
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_PATH='/',
    SESSION_COOKIE_DOMAIN=None,
    SESSION_COOKIE_NAME='tapin_session',
    SESSION_TYPE='filesystem'
)

# ============================================================================
# WEB FACIAL RECOGNITION INTEGRATION - FACE SCANNER
# ============================================================================
# Use the face scanner as the unified facial recognition feature.
# The module serves the recognition page at /facialrecognition/

try:
    from facescanner import register as register_facescanner
    register_facescanner(app)
    print("✅ Face recognition module at /facialrecognition")
    print("   📷 Detects faces using .tfs files")
    print("   🔒 Records attendance via RFID verification")
    print("   🎯 Minimum confidence: 70%")
    print("   📁 Samples directory: storage/samples/")
except ImportError as e:
    print(f"⚠️ Face recognition module not available: {e}")
    print("   To enable face recognition, create the 'facescanner' folder")
except Exception as e:
    print(f"⚠️ Error registering face recognition module: {e}")

# JWT Configuration
JWT_SECRET = os.environ.get("JWT_SECRET", secrets.token_urlsafe(32))
JWT_EXPIRATION = timedelta(hours=3)

# FIXED: Get the base directory more reliably
# Try multiple ways to find the storage folder
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# If app.py is in the root folder (not in app/ subfolder), adjust
if not os.path.exists(os.path.join(BASE_DIR, "storage")):
    # Try using the current working directory
    BASE_DIR = os.getcwd()

# If still not found, try the directory where app.py is located
if not os.path.exists(os.path.join(BASE_DIR, "storage")):
    BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# Store user records in the storage/database folder (outside app folder)
USER_DATA_FILE = os.path.join(BASE_DIR, "storage", "database", "users.json")

# Store every received RFID scan and timestamp.
ATTENDANCE_DATA_FILE = os.path.join(BASE_DIR, "storage", "database", "attendance.json")

# Persistent leave database (mirror of the feed, kept forever).
# Structure: {"requests": [...], "approved": [...], "rejected": [...]}
# This is the NEW leaves.json — it lives alongside users.json and is NEVER wiped.
LEAVE_DATA_FILE = os.path.join(BASE_DIR, "storage", "database", "leaves.json")

# Profile images storage
PROFILE_STORAGE = os.path.join(BASE_DIR, "storage", "profiles")

# Scan feed storage - keeps detailed logs of all scans
SCAN_FEED_FILE = os.path.join(BASE_DIR, "storage", "feed", "scan_feed.json")

# Scan events storage - keeps raw scan events (moved to feed)
SCAN_EVENTS_FILE = os.path.join(BASE_DIR, "storage", "feed", "scan_events.json")

# Leave feed storage — this is the OLD leaves.json, renamed.
# Structure matches the persistent file: {"requests": [...], "approved": [...], "rejected": [...]}
# It lives in storage/feed/ and IS wiped nightly at 12:00 AM.
LEAVE_FEED_FILE = os.path.join(BASE_DIR, "storage", "feed", "leaves_feed.json")

# Activity feed storage - keeps all system activities for timeline
ACTIVITY_FEED_FILE = os.path.join(BASE_DIR, "storage", "feed", "activity_feed.json")

# Settings storage
SETTINGS_FILE = os.path.join(BASE_DIR, "storage", "config", "settings.json")

# ============================================================================
# NOTIFICATION STORAGE - PER-RFID FILES
# ============================================================================
# Every user (admin, hr, employee) gets their own notification file keyed by
# their RFID. Path: storage/notification/<RFID>.json
#
# Example: RFID FB822A54 -> storage/notification/FB822A54.json
#
# Right before we overwrite any notification file, the current content is
# copied to <RFID>.json.backup in the same folder — same convention as
# users.json.backup and attendance.json.backup.
NOTIFICATION_STORAGE = os.path.join(BASE_DIR, "storage", "notification")

# Ensure directories exist
os.makedirs(os.path.dirname(USER_DATA_FILE), exist_ok=True)
os.makedirs(os.path.dirname(ATTENDANCE_DATA_FILE), exist_ok=True)
os.makedirs(os.path.dirname(LEAVE_DATA_FILE), exist_ok=True)
os.makedirs(os.path.dirname(PROFILE_STORAGE), exist_ok=True)
os.makedirs(os.path.dirname(SCAN_FEED_FILE), exist_ok=True)
os.makedirs(os.path.dirname(SCAN_EVENTS_FILE), exist_ok=True)
os.makedirs(os.path.dirname(LEAVE_FEED_FILE), exist_ok=True)
os.makedirs(os.path.dirname(ACTIVITY_FEED_FILE), exist_ok=True)
os.makedirs(os.path.dirname(SETTINGS_FILE), exist_ok=True)
os.makedirs(NOTIFICATION_STORAGE, exist_ok=True)

# Debug: Print paths to verify
print(f"BASE_DIR: {BASE_DIR}")
print(f"USER_DATA_FILE: {USER_DATA_FILE}")
print(f"ATTENDANCE_DATA_FILE: {ATTENDANCE_DATA_FILE}")
print(f"LEAVE_DATA_FILE: {LEAVE_DATA_FILE}")
print(f"PROFILE_STORAGE: {PROFILE_STORAGE}")
print(f"SCAN_FEED_FILE: {SCAN_FEED_FILE}")
print(f"SCAN_EVENTS_FILE: {SCAN_EVENTS_FILE}")
print(f"LEAVE_FEED_FILE: {LEAVE_FEED_FILE}")
print(f"ACTIVITY_FEED_FILE: {ACTIVITY_FEED_FILE}")
print(f"SETTINGS_FILE: {SETTINGS_FILE}")
print(f"NOTIFICATION_STORAGE: {NOTIFICATION_STORAGE}")
print(f"REPORTLAB_AVAILABLE: {REPORTLAB_AVAILABLE}")
print(f"REQUESTS_AVAILABLE: {REQUESTS_AVAILABLE}")
print(f"PIL_AVAILABLE: {PIL_AVAILABLE}")
print(f"Environment: {'Production' if is_production() else 'Development'}")
print(f"Base URL: {get_base_url()}")

# Default settings
DEFAULT_SETTINGS = {
    "attendance": {
        "work_start": "08:00",
        "work_end": "17:00",
        "lunch_start": "12:00",
        "lunch_end": "13:00",
        "grace_period": 10
    },
    "institution": {
        "name": "ISPSC Tagudin Campus",
        "system_name": "TAPIN",
        "academic_year": "2025-2026",
        "hr_email": "hr@ispsc.edu.ph"
    },
    "system": {
        "version": "1.0.0",
        "version_url": "https://raw.githubusercontent.com/lolenseu/tapin-rfid-attendance-system/refs/heads/main/version.txt"
    }
}

# Open the shared dashboard after a successful login.
WEB_DASHBOARD = "/pages/dashboard.html"
EMPLOYEE_DASHBOARD = "/pages/employee-dashboard.html"

# Choose the frontend destination from the role stored in users.json.
ROLE_DASHBOARDS = {
    "admin": WEB_DASHBOARD,
    "hr": WEB_DASHBOARD,
    "employee": EMPLOYEE_DASHBOARD,
}

# Assign separate UID ranges to each user role.
ROLE_UID_RANGES = {"admin": (1, 9), "hr": (10, 19), "employee": (20, float("inf"))}

# Remove devices that have not sent a heartbeat within this period.
DEVICE_TIMEOUT_SECONDS = 90

# Track the latest status reported by each RFID device.
device_status = {}

# Store the latest employee record used by the application.
latest_employee = {
    "uid": None,
    "rfid": None,
    "employeeid": None,
    "lastname": None,
    "firstname": None,
    "address": None,
    "bdate": None,
    "cpnumber": None,
    "email": None,
    "username": None,
    "role": None,
    "department": None,
    "position": None,
    "image": None,
    "timestamp_creation": None,
    "timestamp_modified": None
}

# Store the latest RFID scan received from a device.
latest_scan = {
    "rfid": None,
    "scanned_at": None
}

# Track last scan time for each RFID to enforce cooldown
# Structure: {rfid: {"last_scan_time": datetime, "last_scan_type": "in"|"out"}}
last_scan_tracking = {}
# Cooldown between scans for the same RFID (in seconds). Default 10 minutes.
SCAN_COOLDOWN_SECONDS = 10 * 60

# ============================================================================
# NIGHTLY FEED WIPE (runs once per calendar day, at first request after 12:00 AM)
# ============================================================================
# Track the last date we performed the nightly wipe so all four feed files
# are cleared exactly once per calendar day — at the first request received
# after midnight. Wiping is a no-op if already done today.
#
# Files wiped nightly (in storage/feed/):
#     - scan_feed.json       (scans)
#     - scan_events.json     (scan_events)
#     - activity_feed.json   (activities)
#     - leaves_feed.json     (requests + approved + rejected)  <-- OLD leaves.json
#
# Files NOT wiped (persistent, in storage/database/):
#     - users.json           (employee records)
#     - attendance.json      (DTR records)
#     - leaves.json          (NEW mirror of the feed — kept forever)
#     - settings.json        (config)
#
# IMPORTANT: leaves_feed.json and leaves.json hold the SAME data at any given
# moment. Every write goes to both files. Only the feed copy is emptied at
# midnight — the database copy is the permanent record.
_last_feed_wipe_date = None

def perform_nightly_feed_wipe():
    """Wipe all four feed files once per calendar day at 12:00 AM.

    Files cleared (all under storage/feed/):
        - storage/feed/scan_feed.json      (scans list)
        - storage/feed/scan_events.json    (scan_events list)
        - storage/feed/activity_feed.json  (activities list)
        - storage/feed/leaves_feed.json    (requests + approved + rejected)
                                            ^ this is the OLD leaves.json

    The persistent mirror at storage/database/leaves.json is NEVER touched.

    Also clears in-memory daily state (latest scan + per-RFID cooldown).

    Safe to call on every request — it short-circuits if already run today.
    """
    global _last_feed_wipe_date, latest_scan, last_scan_tracking, scan_events

    today = datetime.now().date()
    if _last_feed_wipe_date == today:
        return
    _last_feed_wipe_date = today

    now_iso = datetime.now().isoformat()

    # --- 1) scan_feed.json ---------------------------------------------------
    try:
        scan_feed_data = load_scan_feed()
        scan_feed_data["scans"] = []
        scan_feed_data["total_scans"] = 0
        scan_feed_data["last_cleanup"] = now_iso
        save_scan_feed(scan_feed_data)
    except Exception as e:
        print(f"[Nightly] Failed to wipe scan_feed.json: {e}")

    # --- 2) scan_events.json -------------------------------------------------
    try:
        scan_events = []
        save_scan_events({"scan_events": []})
    except Exception as e:
        print(f"[Nightly] Failed to wipe scan_events.json: {e}")

    # --- 3) activity_feed.json -----------------------------------------------
    try:
        save_activity_feed({
            "activities": [],
            "total_activities": 0,
            "last_cleanup": now_iso
        })
    except Exception as e:
        print(f"[Nightly] Failed to wipe activity_feed.json: {e}")

    # --- 4) leaves_feed.json (the OLD leaves.json — same shape as the mirror) -
    # NOTE: We ONLY wipe the feed copy here. The mirror at
    # storage/database/leaves.json is intentionally left alone.
    try:
        empty_leaves = {"requests": [], "approved": [], "rejected": []}
        save_leave_feed_data(empty_leaves)
        # Refresh the in-memory feed copy so the running app sees the empty state
        leave_feed_data.clear()
        leave_feed_data.update(empty_leaves)
    except Exception as e:
        print(f"[Nightly] Failed to wipe leaves_feed.json: {e}")

    # --- 5) In-memory daily state -------------------------------------------
    last_scan_tracking.clear()
    latest_scan["rfid"] = None
    latest_scan["scanned_at"] = None

    print(f"[Nightly] All feeds wiped for {today.isoformat()} at {now_iso}")

## Functions ------------------------------------
# Image compression function
def compress_and_save_image(image_file, rfid, max_size_kb=100, quality=85, max_dimensions=(300, 300)):
    """
    Compress and resize an image to reduce file size.

    Args:
        image_file: The uploaded image file
        rfid: The RFID to use as filename
        max_size_kb: Maximum file size in KB (default: 100KB)
        quality: Initial JPEG quality (1-100)
        max_dimensions: Max width and height (default: 300x300)

    Returns:
        str: The saved file path or None if failed
    """
    if not PIL_AVAILABLE:
        # Fallback: save without compression
        extension = os.path.splitext(image_file.filename)[1].lower()
        rfid_filename = secure_filename(rfid)
        os.makedirs(PROFILE_STORAGE, exist_ok=True)
        filename = rfid_filename + extension
        image_file.save(os.path.join(PROFILE_STORAGE, filename))
        return os.path.join("storage", "profiles", filename).replace(os.sep, "/")

    try:
        # Open the image
        img = Image.open(image_file)

        # Convert to RGB if necessary (for PNG with transparency)
        if img.mode in ('RGBA', 'LA', 'P'):
            background = Image.new('RGB', img.size, (255, 255, 255))
            if img.mode == 'P':
                img = img.convert('RGBA')
            background.paste(img, mask=img.split()[-1] if img.mode == 'RGBA' else None)
            img = background

        # Resize image maintaining aspect ratio
        img.thumbnail(max_dimensions, Image.Resampling.LANCZOS)

        # Determine file extension
        extension = os.path.splitext(image_file.filename)[1].lower()
        rfid_filename = secure_filename(rfid)
        os.makedirs(PROFILE_STORAGE, exist_ok=True)

        # Try to save as JPEG for better compression
        if extension in ['.jpg', '.jpeg']:
            filename = rfid_filename + '.jpg'
            filepath = os.path.join(PROFILE_STORAGE, filename)

            # Try different quality settings to achieve target size
            current_quality = quality
            while current_quality > 10:
                # Save to buffer to check size
                buffer = io.BytesIO()
                img.save(buffer, format='JPEG', quality=current_quality, optimize=True)
                size_kb = len(buffer.getvalue()) / 1024

                if size_kb <= max_size_kb:
                    # Save to file
                    img.save(filepath, format='JPEG', quality=current_quality, optimize=True)
                    print(f"Image compressed to {size_kb:.1f}KB (quality: {current_quality})")
                    return os.path.join("storage", "profiles", filename).replace(os.sep, "/")

                # Reduce quality by 5
                current_quality -= 5

            # If still too large, save with minimum quality
            img.save(filepath, format='JPEG', quality=10, optimize=True)
            return os.path.join("storage", "profiles", filename).replace(os.sep, "/")

        elif extension in ['.png']:
            # For PNG, convert to JPEG for better compression
            filename = rfid_filename + '.jpg'
            filepath = os.path.join(PROFILE_STORAGE, filename)

            # Try different quality settings
            current_quality = quality
            while current_quality > 10:
                buffer = io.BytesIO()
                img.save(buffer, format='JPEG', quality=current_quality, optimize=True)
                size_kb = len(buffer.getvalue()) / 1024

                if size_kb <= max_size_kb:
                    img.save(filepath, format='JPEG', quality=current_quality, optimize=True)
                    print(f"PNG compressed to JPEG {size_kb:.1f}KB (quality: {current_quality})")
                    return os.path.join("storage", "profiles", filename).replace(os.sep, "/")

                current_quality -= 5

            img.save(filepath, format='JPEG', quality=10, optimize=True)
            return os.path.join("storage", "profiles", filename).replace(os.sep, "/")

        else:
            # For other formats, try to save as JPEG
            filename = rfid_filename + '.jpg'
            filepath = os.path.join(PROFILE_STORAGE, filename)
            img.save(filepath, format='JPEG', quality=quality, optimize=True)
            return os.path.join("storage", "profiles", filename).replace(os.sep, "/")

    except Exception as e:
        print(f"Error compressing image: {e}")
        # Fallback: save without compression
        try:
            extension = os.path.splitext(image_file.filename)[1].lower()
            rfid_filename = secure_filename(rfid)
            os.makedirs(PROFILE_STORAGE, exist_ok=True)
            filename = rfid_filename + extension
            image_file.save(os.path.join(PROFILE_STORAGE, filename))
            return os.path.join("storage", "profiles", filename).replace(os.sep, "/")
        except:
            return None

# Load settings
def load_settings():
    """Load settings from JSON file"""
    if not os.path.exists(SETTINGS_FILE):
        # Create default settings file
        save_settings(DEFAULT_SETTINGS)
        return DEFAULT_SETTINGS.copy()

    try:
        with open(SETTINGS_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
            # Merge with defaults to ensure all keys exist
            merged = DEFAULT_SETTINGS.copy()
            for key in merged:
                if key in data:
                    if isinstance(merged[key], dict) and isinstance(data[key], dict):
                        merged[key].update(data[key])
                    else:
                        merged[key] = data[key]
            return merged
    except (OSError, ValueError, json.JSONDecodeError) as e:
        print(f"Error reading settings file: {e}")
        return DEFAULT_SETTINGS.copy()

# Save settings
def save_settings(settings_data):
    """Save settings to JSON file"""
    os.makedirs(os.path.dirname(SETTINGS_FILE), exist_ok=True)
    with open(SETTINGS_FILE, "w", encoding="utf-8") as f:
        json.dump(settings_data, f, indent=4)
        f.write("\n")
    print(f"Settings saved to {SETTINGS_FILE}")

# Load settings on startup
settings = load_settings()

# Compute the required daily work hours from the current settings.
# This is what UT / OT are measured against — it replaces the old
# hardcoded "8 hours" so the Settings page actually affects the DTR.
def get_required_hours():
    """Compute required daily hours from settings (work_end − work_start − lunch).

    Reads settings["attendance"] for work_start, work_end, lunch_start, and
    lunch_end. Returns the required hours as a float. Falls back to 8.0 if
    anything is missing or malformed so attendance recording never breaks.
    """
    try:
        att = settings.get("attendance", {})
        ws = datetime.strptime(att.get("work_start", "08:00"), "%H:%M")
        we = datetime.strptime(att.get("work_end", "17:00"), "%H:%M")
        ls = datetime.strptime(att.get("lunch_start", "12:00"), "%H:%M")
        le = datetime.strptime(att.get("lunch_end", "13:00"), "%H:%M")
        work_span = (we - ws).total_seconds() / 3600
        lunch_span = (le - ls).total_seconds() / 3600
        required = work_span - lunch_span
        return max(0, required)
    except Exception:
        return 8.0

# Get current version from GitHub
def fetch_version_from_github():
    """Fetch version from GitHub raw URL"""
    if not REQUESTS_AVAILABLE:
        return None
    try:
        url = settings.get("system", {}).get("version_url", "https://raw.githubusercontent.com/lolenseu/tapin-rfid-attendance-system/refs/heads/main/version.txt")
        response = requests.get(url, timeout=5)
        if response.status_code == 200:
            version_text = response.text.strip()
            # Parse version from text (e.g., "test - v0.1.55" -> "0.1.55")
            match = re.search(r'v?(\d+\.\d+\.\d+)', version_text)
            if match:
                return match.group(1)
            return version_text
        return None
    except Exception as e:
        print(f"Error fetching version from GitHub: {e}")
        return None

# ============================================================================
# NOTIFICATION STORAGE HELPERS
# ============================================================================
# Every user (admin, hr, employee) has their own notification file keyed by
# their RFID. Path: storage/notification/<RFID>.json
#
# Each file shape:
#     {
#         "rfid": "FB822A54",
#         "uid": "021",
#         "fullname": "JIM-MAR DE LOS REYES",
#         "role": "employee",
#         "notifications": [ { id, type, title, message, read, created_at }, ... ],
#         "unread_count": 0,
#         "total_count": 0,
#         "last_updated": "..."
#     }
#
# Before overwriting any notification file, the previous content is copied to
# <RFID>.json.backup in the SAME folder — exactly like users.json.backup.

def _sanitize_rfid(rfid):
    """Sanitize an RFID so it is safe to use as a filename."""
    if not rfid:
        return ""
    cleaned = re.sub(r'[^A-Za-z0-9_\-]', '', str(rfid).strip().upper())
    return cleaned

def _notification_path(rfid):
    """Return the absolute path to a user's notification file."""
    safe_rfid = _sanitize_rfid(rfid)
    if not safe_rfid:
        return None
    return os.path.join(NOTIFICATION_STORAGE, f"{safe_rfid}.json")

def _notification_backup_path(rfid):
    """Return the absolute path to a user's notification backup file (.json.backup)."""
    path = _notification_path(rfid)
    if not path:
        return None
    return path + ".backup"

def _empty_notification_doc(rfid, uid=None, fullname=None, role=None):
    """Build a fresh empty notification document for a given RFID."""
    return {
        "rfid": _sanitize_rfid(rfid),
        "uid": uid or "",
        "fullname": fullname or "",
        "role": role or "",
        "notifications": [],
        "unread_count": 0,
        "total_count": 0,
        "last_updated": datetime.now().isoformat()
    }

def _backup_notification_file(rfid, existing_doc):
    """Write a .json.backup copy of the current notification document.

    Called right before we overwrite the live file so the previous version
    is preserved as <RFID>.json.backup in the same folder.
    """
    try:
        backup_path = _notification_backup_path(rfid)
        if not backup_path or existing_doc is None:
            return
        os.makedirs(os.path.dirname(backup_path), exist_ok=True)
        with open(backup_path, "w", encoding="utf-8") as f:
            json.dump(existing_doc, f, indent=4)
            f.write("\n")
        print(f"Notification backup written: {backup_path}")
    except Exception as e:
        print(f"Warning: failed to write notification backup for {rfid}: {e}")

def load_notifications(rfid, uid=None, fullname=None, role=None):
    """Load the notification document for a given RFID.

    If the file does not exist, an empty document is created and returned.
    """
    path = _notification_path(rfid)
    if not path:
        return _empty_notification_doc(rfid, uid, fullname, role)

    if not os.path.exists(path):
        doc = _empty_notification_doc(rfid, uid, fullname, role)
        # Persist the empty doc so the user has a real file going forward.
        try:
            os.makedirs(NOTIFICATION_STORAGE, exist_ok=True)
            with open(path, "w", encoding="utf-8") as f:
                json.dump(doc, f, indent=4)
                f.write("\n")
        except Exception as e:
            print(f"Warning: could not create notification file for {rfid}: {e}")
        return doc

    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError, json.JSONDecodeError) as e:
        print(f"Error reading notification file for {rfid}: {e}")
        return _empty_notification_doc(rfid, uid, fullname, role)

    # Normalize structure
    if not isinstance(data, dict):
        data = _empty_notification_doc(rfid, uid, fullname, role)
    if "notifications" not in data or not isinstance(data["notifications"], list):
        data["notifications"] = []
    data["rfid"] = _sanitize_rfid(rfid)
    if uid is not None:
        data["uid"] = uid
    if fullname is not None:
        data["fullname"] = fullname
    if role is not None:
        data["role"] = role
    # Recompute counts so the file is always consistent
    data["total_count"] = len(data["notifications"])
    data["unread_count"] = sum(1 for n in data["notifications"] if not n.get("read", False))
    if "last_updated" not in data:
        data["last_updated"] = datetime.now().isoformat()
    return data

def save_notifications(rfid, doc, backup=True):
    """Persist a notification document to disk.

    If `backup` is True and the live file already exists, the previous
    content is first written to <RFID>.json.backup in the same folder.
    """
    path = _notification_path(rfid)
    if not path:
        return False

    existing = None
    if os.path.exists(path):
        try:
            with open(path, "r", encoding="utf-8") as f:
                existing = json.load(f)
        except Exception:
            existing = None

    if backup and existing is not None:
        _backup_notification_file(rfid, existing)

    doc["rfid"] = _sanitize_rfid(rfid)
    doc["total_count"] = len(doc.get("notifications", []))
    doc["unread_count"] = sum(1 for n in doc.get("notifications", []) if not n.get("read", False))
    doc["last_updated"] = datetime.now().isoformat()

    try:
        os.makedirs(NOTIFICATION_STORAGE, exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(doc, f, indent=4)
            f.write("\n")
        print(f"Notifications saved for {rfid} ({doc['total_count']} entries, {doc['unread_count']} unread)")
        return True
    except Exception as e:
        print(f"Error saving notifications for {rfid}: {e}")
        return False

def push_notification(rfid, title, message, notif_type="system", uid=None, fullname=None, role=None):
    """Append a new notification for the given RFID and save.

    Returns the created notification entry, or None if the RFID is invalid.
    """
    safe_rfid = _sanitize_rfid(rfid)
    if not safe_rfid:
        return None

    doc = load_notifications(safe_rfid, uid=uid, fullname=fullname, role=role)

    # Build a request-safe ID based on the current count.
    try:
        next_num = max([int(n.get("id", "0")) for n in doc.get("notifications", [])] + [0]) + 1
    except Exception:
        next_num = len(doc.get("notifications", [])) + 1
    new_id = str(next_num).zfill(3)

    entry = {
        "id": new_id,
        "type": notif_type,
        "title": title,
        "message": message,
        "read": False,
        "created_at": datetime.now().isoformat()
    }

    doc["notifications"].insert(0, entry)
    # Cap at 200 entries per user to keep files small.
    if len(doc["notifications"]) > 200:
        doc["notifications"] = doc["notifications"][:200]

    save_notifications(safe_rfid, doc)
    return entry

def clear_notifications(rfid):
    """Clear all notifications for a given RFID (keeps the file itself)."""
    safe_rfid = _sanitize_rfid(rfid)
    if not safe_rfid:
        return False

    doc = load_notifications(safe_rfid)
    doc["notifications"] = []
    doc["unread_count"] = 0
    doc["total_count"] = 0
    save_notifications(safe_rfid, doc)
    print(f"Cleared all notifications for {safe_rfid}")
    return True

def mark_notification_read(rfid, notification_id):
    """Mark a single notification as read."""
    safe_rfid = _sanitize_rfid(rfid)
    if not safe_rfid:
        return False

    doc = load_notifications(safe_rfid)
    found = False
    for n in doc.get("notifications", []):
        if str(n.get("id")) == str(notification_id):
            n["read"] = True
            found = True
            break

    if not found:
        return False

    save_notifications(safe_rfid, doc)
    return True

def mark_all_notifications_read(rfid):
    """Mark every notification for a given RFID as read."""
    safe_rfid = _sanitize_rfid(rfid)
    if not safe_rfid:
        return False

    doc = load_notifications(safe_rfid)
    for n in doc.get("notifications", []):
        n["read"] = True
    save_notifications(safe_rfid, doc)
    return True

def delete_notification(rfid, notification_id):
    """Delete a single notification entry."""
    safe_rfid = _sanitize_rfid(rfid)
    if not safe_rfid:
        return False

    doc = load_notifications(safe_rfid)
    before = len(doc.get("notifications", []))
    doc["notifications"] = [
        n for n in doc.get("notifications", [])
        if str(n.get("id")) != str(notification_id)
    ]
    after = len(doc["notifications"])

    if before == after:
        return False

    save_notifications(safe_rfid, doc)
    return True

# ============================================================================
# LEAVE STORAGE (TWO FILES, SAME SHAPE)
# ============================================================================
# Both files use the SAME structure:
#     {"requests": [...], "approved": [...], "rejected": [...]}
#
# storage/feed/leaves_feed.json         <- OLD leaves.json, wiped nightly
# storage/database/leaves.json          <- NEW mirror, never wiped
#
# Every write goes to BOTH files so they always match. Only the feed copy
# is emptied at 12:00 AM by perform_nightly_feed_wipe().

def _empty_leaves():
    """Return a fresh empty leave structure."""
    return {"requests": [], "approved": [], "rejected": []}

def _normalize_leave_payload(data):
    """Ensure the three top-level keys exist and are lists."""
    if not isinstance(data, dict):
        return _empty_leaves()
    if "requests" not in data or not isinstance(data["requests"], list):
        data["requests"] = []
    if "approved" not in data or not isinstance(data["approved"], list):
        data["approved"] = []
    if "rejected" not in data or not isinstance(data["rejected"], list):
        data["rejected"] = []
    return data

def load_leave_data():
    """Load the persistent leave database from storage/database/leaves.json.

    Structure matches the feed: {requests, approved, rejected}.
    """
    if not os.path.exists(LEAVE_DATA_FILE):
        default_data = _empty_leaves()
        with open(LEAVE_DATA_FILE, "w", encoding="utf-8") as f:
            json.dump(default_data, f, indent=4)
            f.write("\n")
        print(f"Created new persistent leave file: {LEAVE_DATA_FILE}")
        return default_data

    try:
        with open(LEAVE_DATA_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
            return _normalize_leave_payload(data)
    except (OSError, ValueError, json.JSONDecodeError) as e:
        print(f"Error reading persistent leave file: {e}")
        return _empty_leaves()

def save_leave_data(leave_data):
    """Save the persistent leave database to storage/database/leaves.json."""
    os.makedirs(os.path.dirname(LEAVE_DATA_FILE), exist_ok=True)
    with open(LEAVE_DATA_FILE, "w", encoding="utf-8") as f:
        json.dump(leave_data, f, indent=4)
        f.write("\n")
    print(f"Leave data saved to {LEAVE_DATA_FILE}")

def load_leave_feed_data():
    """Load the transient leave feed from storage/feed/leaves_feed.json.

    Structure matches the persistent file: {requests, approved, rejected}.
    """
    if not os.path.exists(LEAVE_FEED_FILE):
        default_data = _empty_leaves()
        with open(LEAVE_FEED_FILE, "w", encoding="utf-8") as f:
            json.dump(default_data, f, indent=4)
            f.write("\n")
        print(f"Created new leave feed file: {LEAVE_FEED_FILE}")
        return default_data

    try:
        with open(LEAVE_FEED_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
            return _normalize_leave_payload(data)
    except (OSError, ValueError, json.JSONDecodeError) as e:
        print(f"Error reading leave feed file: {e}")
        return _empty_leaves()

def save_leave_feed_data(leave_feed):
    """Save the transient leave feed to storage/feed/leaves_feed.json."""
    os.makedirs(os.path.dirname(LEAVE_FEED_FILE), exist_ok=True)
    with open(LEAVE_FEED_FILE, "w", encoding="utf-8") as f:
        json.dump(leave_feed, f, indent=4)
        f.write("\n")
    print(f"Leave feed saved to {LEAVE_FEED_FILE}")

def save_both_leave_files(payload):
    """Write the same payload to BOTH the persistent database and the feed.

    Both files hold identical content at all times. Only the feed copy
    gets emptied at midnight.
    """
    save_leave_data(payload)
    save_leave_feed_data(payload)
    # Also refresh the in-memory feed copy so reads stay in sync.
    try:
        leave_feed_data.clear()
        leave_feed_data.update(payload)
    except Exception:
        pass

# Load both on startup. If the feed is missing but the persistent file
# exists, copy the persistent data into the feed so they start in sync.
leave_data = load_leave_data()
leave_feed_data = load_leave_feed_data()

if not leave_feed_data.get("requests") and not leave_feed_data.get("approved") and not leave_feed_data.get("rejected"):
    # Feed is empty — mirror the persistent file so they match on boot.
    if leave_data.get("requests") or leave_data.get("approved") or leave_data.get("rejected"):
        print("Leave feed was empty — mirroring persistent leaves.json into feed for consistency.")
        leave_feed_data = {
            "requests": list(leave_data.get("requests", [])),
            "approved": list(leave_data.get("approved", [])),
            "rejected": list(leave_data.get("rejected", [])),
        }
        save_leave_feed_data(leave_feed_data)

# Load activity feed data
def load_activity_feed():
    """Load activity feed data from JSON file"""
    if not os.path.exists(ACTIVITY_FEED_FILE):
        default_data = {
            "activities": [],
            "total_activities": 0,
            "last_cleanup": datetime.now().isoformat()
        }
        with open(ACTIVITY_FEED_FILE, "w", encoding="utf-8") as f:
            json.dump(default_data, f, indent=4)
            f.write("\n")
        print(f"Created new activity feed file: {ACTIVITY_FEED_FILE}")
        return default_data

    try:
        with open(ACTIVITY_FEED_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
            if "activities" not in data:
                data["activities"] = []
            if "total_activities" not in data:
                data["total_activities"] = len(data["activities"])
            if "last_cleanup" not in data:
                data["last_cleanup"] = datetime.now().isoformat()
            return data
    except (OSError, ValueError, json.JSONDecodeError) as e:
        print(f"Error reading activity feed file: {e}")
        return {"activities": [], "total_activities": 0, "last_cleanup": datetime.now().isoformat()}

# Save activity feed data
def save_activity_feed(activity_data):
    """Save activity feed data to JSON file"""
    os.makedirs(os.path.dirname(ACTIVITY_FEED_FILE), exist_ok=True)
    with open(ACTIVITY_FEED_FILE, "w", encoding="utf-8") as f:
        json.dump(activity_data, f, indent=4)
        f.write("\n")

# Add activity to feed
def add_activity(action, details, user=None, activity_type="system"):
    """
    Add a system activity to the feed.

    Args:
        action (str): The action performed (e.g., "employee_registered", "rfid_scanned")
        details (str): Description of the activity
        user (dict): User who performed the action
        activity_type (str): Type of activity (system, employee, attendance, leave, etc.)

    Returns:
        dict: The created activity entry
    """
    activity_feed_data = load_activity_feed()

    activity_entry = {
        "id": str(len(activity_feed_data["activities"]) + 1),
        "action": action,
        "details": details,
        "type": activity_type,
        "timestamp": datetime.now().isoformat(),
        "user": user
    }

    # Insert at the beginning (newest first)
    activity_feed_data["activities"].insert(0, activity_entry)

    # Keep only last 1000 activities
    if len(activity_feed_data["activities"]) > 1000:
        activity_feed_data["activities"] = activity_feed_data["activities"][:1000]

    activity_feed_data["total_activities"] = len(activity_feed_data["activities"])

    save_activity_feed(activity_feed_data)

    print(f"Activity logged: {action} - {details}")
    return activity_entry

# Load scan events
def load_scan_events():
    if not os.path.exists(SCAN_EVENTS_FILE):
        default_data = {"scan_events": []}
        with open(SCAN_EVENTS_FILE, "w", encoding="utf-8") as f:
            json.dump(default_data, f, indent=4)
            f.write("\n")
        print(f"Created new scan events file: {SCAN_EVENTS_FILE}")
        return default_data

    try:
        with open(SCAN_EVENTS_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
            if "scan_events" not in data:
                data["scan_events"] = []
            return data
    except (OSError, ValueError, json.JSONDecodeError) as e:
        print(f"Error reading scan events file: {e}")
        return {"scan_events": []}

# Save scan events
def save_scan_events(scan_events_data):
    os.makedirs(os.path.dirname(SCAN_EVENTS_FILE), exist_ok=True)
    with open(SCAN_EVENTS_FILE, "w", encoding="utf-8") as f:
        json.dump(scan_events_data, f, indent=4)
        f.write("\n")
    print(f"Scan events saved to {SCAN_EVENTS_FILE}")

# Load persisted DTR records.
def load_attendance_data():
    # Ensure the directory exists
    os.makedirs(os.path.dirname(ATTENDANCE_DATA_FILE), exist_ok=True)

    if not os.path.exists(ATTENDANCE_DATA_FILE):
        # Create empty file with proper structure
        default_data = {"records": []}
        with open(ATTENDANCE_DATA_FILE, "w", encoding="utf-8") as f:
            json.dump(default_data, f, indent=4)
            f.write("\n")
        print(f"Created new attendance file: {ATTENDANCE_DATA_FILE}")
        return default_data

    try:
        with open(ATTENDANCE_DATA_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
            # Ensure we have the proper structure - only records
            if isinstance(data, list):
                return {"records": data}
            if "records" not in data:
                data["records"] = []
            return data
    except (OSError, ValueError, json.JSONDecodeError) as e:
        print(f"Error reading attendance file: {e}")
        if os.path.exists(ATTENDANCE_DATA_FILE):
            backup_file = ATTENDANCE_DATA_FILE + ".backup"
            try:
                os.rename(ATTENDANCE_DATA_FILE, backup_file)
                print(f"Corrupted file backed up to: {backup_file}")
            except:
                pass
        return {"records": []}

# Load scan feed data
def load_scan_feed():
    """Load scan feed data from JSON file"""
    if not os.path.exists(SCAN_FEED_FILE):
        default_data = {
            "scans": [],
            "total_scans": 0,
            "last_cleanup": datetime.now().isoformat()
        }
        with open(SCAN_FEED_FILE, "w", encoding="utf-8") as f:
            json.dump(default_data, f, indent=4)
            f.write("\n")
        print(f"Created new scan feed file: {SCAN_FEED_FILE}")
        return default_data

    try:
        with open(SCAN_FEED_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
            if "scans" not in data:
                data["scans"] = []
            if "total_scans" not in data:
                data["total_scans"] = len(data["scans"])
            if "last_cleanup" not in data:
                data["last_cleanup"] = datetime.now().isoformat()
            return data
    except (OSError, ValueError, json.JSONDecodeError) as e:
        print(f"Error reading scan feed file: {e}")
        return {"scans": [], "total_scans": 0, "last_cleanup": datetime.now().isoformat()}

# Save scan feed data
def save_scan_feed(scan_data):
    """Save scan feed data to JSON file"""
    os.makedirs(os.path.dirname(SCAN_FEED_FILE), exist_ok=True)
    with open(SCAN_FEED_FILE, "w", encoding="utf-8") as f:
        json.dump(scan_data, f, indent=4)
        f.write("\n")

# Add scan to feed
def add_scan_to_feed(rfid, scanned_at, employee=None, found=False, scan_type="unknown"):
    """Add a single scan to the feed with proper formatting.

    Deduplicates on (rfid, scanned_at). If the same physical tap is written
    twice — once by receive_rfid with scan_type="unknown" and again by
    record_attendance_scan with scan_type="am_in"/"pm_in"/etc. — the second
    call updates the existing entry in place instead of appending a new one.
    This also handles the case where receive_rfid passes employee=None first
    and record_attendance_scan passes the real employee a moment later.
    """
    scan_feed_data = load_scan_feed()

    scan_date = datetime.now().date().isoformat()

    # Build the fresh payload for this tap.
    employee_snapshot = None
    if employee:
        employee_snapshot = {
            "uid": employee.get("uid"),
            "employeeid": employee.get("employeeid"),
            "firstname": employee.get("firstname"),
            "lastname": employee.get("lastname"),
            "role": employee.get("role"),
            "department": employee.get("department")
        }

    new_entry = {
        "rfid": rfid,
        "scanned_at": scanned_at,
        "scanned_on": scan_date,
        "found": found,
        "scan_type": scan_type,
        "timestamp": datetime.now().isoformat(),
        "employee": employee_snapshot
    }

    # Deduplicate: look for an existing entry with the same rfid + scanned_at.
    # If we find one, MERGE instead of inserting a duplicate row.
    existing = None
    for idx, entry in enumerate(scan_feed_data.get("scans", [])):
        if entry.get("rfid") == rfid and entry.get("scanned_at") == scanned_at:
            existing = idx
            break

    if existing is not None:
        prev = scan_feed_data["scans"][existing]
        # Prefer the more informative scan_type (real event over "unknown").
        prev_type = str(prev.get("scan_type", "unknown")).lower()
        new_type = str(scan_type or "unknown").lower()
        if prev_type in ("unknown", "") and new_type not in ("unknown", ""):
            prev["scan_type"] = scan_type
        # Fill in the employee record if it was missing before.
        if not prev.get("employee") and employee_snapshot:
            prev["employee"] = employee_snapshot
            prev["found"] = True
        # Refresh the timestamp so the row stays newest-first in the list.
        prev["timestamp"] = new_entry["timestamp"]
        scan_feed_data["scans"][existing] = prev
        print(f"scan feed: merged duplicate tap for {rfid} at {scanned_at} (scan_type={prev['scan_type']})")
    else:
        scan_feed_data["scans"].insert(0, new_entry)

    if len(scan_feed_data["scans"]) > 1000:
        scan_feed_data["scans"] = scan_feed_data["scans"][:1000]

    scan_feed_data["total_scans"] = len(scan_feed_data["scans"])

    save_scan_feed(scan_feed_data)

    return scan_feed_data["scans"][existing] if existing is not None else new_entry

# Load attendance data
attendance_data = load_attendance_data()
attendance_records = attendance_data["records"]

# Load scan events
scan_events_data = load_scan_events()
scan_events = scan_events_data.get("scan_events", [])

if scan_events:
    latest_scan.update({
        "rfid": scan_events[-1].get("rfid"),
        "scanned_at": scan_events[-1].get("scanned_at")
    })

# Save DTR records to the attendance database (ONLY records, no scan events).
def save_attendance_data():
    """Save attendance records to attendance.json file - ONLY records, no scan events"""
    os.makedirs(os.path.dirname(ATTENDANCE_DATA_FILE), exist_ok=True)

    if os.path.exists(ATTENDANCE_DATA_FILE):
        backup_file = ATTENDANCE_DATA_FILE + ".backup"
        try:
            import shutil
            shutil.copy2(ATTENDANCE_DATA_FILE, backup_file)
        except:
            pass

    with open(ATTENDANCE_DATA_FILE, "w", encoding="utf-8") as f:
        json.dump({
            "records": attendance_records
        }, f, indent=4)
        f.write("\n")
    print(f"Attendance data saved to {ATTENDANCE_DATA_FILE} - {len(attendance_records)} total records")

# Build DTR dictionary for a month
def build_dtr_dict(year, month):
    """Build DTR dictionary with date keys like '1-sep', '2-sep'"""
    days_in_month = calendar.monthrange(year, month)[1]
    dtr = {}
    month_name = calendar.month_abbr[month].lower()

    for day in range(1, days_in_month + 1):
        date_obj = datetime(year, month, day)
        date_key = f"{day}-{month_name}"
        dtr[date_key] = {
            "date": date_obj.strftime("%Y-%m-%d"),
            "day": calendar.day_abbr[date_obj.weekday()],
            "am_in": "",
            "am_out": "",
            "pm_in": "",
            "pm_out": "",
            "hours": "0.00",
            "ut": "0.00",
            "ot": "0.00",
            "status": ""
        }
    return dtr

# Find or create a DTR record using the user's identity fields.
def get_attendance_record(employee, scan_date):
    """
    Find existing attendance record for a user and month, or create a new one.
    Uses DTR format with date-keyed entries.
    """
    month_key = scan_date.strftime("%Y-%m")
    month_display = scan_date.strftime("%B %Y")
    uid = employee.get("uid")

    # First try to find existing record for this user and month
    for record in attendance_records:
        if record.get("uid") == uid and record.get("month") == month_key:
            print(f"Found existing record for {employee.get('firstname')} for month {month_key}")
            return record

    # No record exists - create a new one with DTR format
    existing_ids = []
    for r in attendance_records:
        try:
            if str(r.get("id", "")).isdigit():
                existing_ids.append(int(r.get("id")))
        except:
            pass

    new_id = str(max(existing_ids + [0]) + 1).zfill(3)

    record = {
        "id": new_id,
        "uid": uid,
        "employeeid": employee.get("employeeid", ""),
        "rfid": employee.get("rfid", ""),
        "fullname": f"{employee.get('firstname', '')} {employee.get('lastname', '')}".strip(),
        "position": employee.get("position", ""),
        "department": employee.get("department", ""),
        "month": month_key,
        "month_display": month_display,
        "dtr": build_dtr_dict(scan_date.year, scan_date.month),
        "total_hours": "0.00",
        "total_ut": "0.00",
        "total_ot": "0.00"
    }
    attendance_records.append(record)
    print(f"Created new attendance record for {record['fullname']} for month {month_key}")
    return record

# Determine if a time is AM or PM period
def get_period(scan_time):
    """Return 'am' if hour < 12, else 'pm'"""
    return "am" if scan_time.hour < 12 else "pm"

# Check if a user has already timed in for the current period
def has_time_in_for_period(day_data, period):
    """Check if the user already has a time in for the given period"""
    in_key = f"{period}_in"
    return bool(day_data.get(in_key))

# Check if a user has already timed out for the current period
def has_time_out_for_period(day_data, period):
    """Check if the user already has a time out for the given period"""
    out_key = f"{period}_out"
    return bool(day_data.get(out_key))

# Check if a day is marked as on leave
def is_on_leave(day_data):
    """Check if the day record is marked as on leave"""
    return day_data.get("status") == "on_leave"

# Get the appropriate scan type based on current state
def determine_scan_type(day_data, scan_time, employee):
    """
    Determine whether this scan should be a time in or time out.
    Returns: ("am", "in") or ("am", "out") or ("pm", "in") or ("pm", "out") or None (skip)
    """
    rfid = employee.get("rfid")
    period = get_period(scan_time)

    # Check if day is on leave - skip scanning
    if is_on_leave(day_data):
        print(f"Day marked as ON LEAVE for {rfid} - scan skipped")
        return None

    # Check AM status from the day record
    am_has_in = has_time_in_for_period(day_data, "am")
    am_has_out = has_time_out_for_period(day_data, "am")
    am_complete = am_has_in and am_has_out

    # Check PM status from the day record
    pm_has_in = has_time_in_for_period(day_data, "pm")
    pm_has_out = has_time_out_for_period(day_data, "pm")
    pm_complete = pm_has_in and pm_has_out

    # AM period handling
    if period == "am":
        if not am_has_in:
            return ("am", "in")

        if am_has_in and not am_has_out:
            if rfid in last_scan_tracking:
                last_scan_data = last_scan_tracking[rfid]
                last_scan_time = last_scan_data.get("last_scan_time")
                last_scan_type = last_scan_data.get("last_scan_type")

                if last_scan_type == "in":
                    time_diff_seconds = (scan_time - last_scan_time).total_seconds()
                    if time_diff_seconds >= SCAN_COOLDOWN_SECONDS:
                        return ("am", "out")
                    else:
                        mins = time_diff_seconds / 60.0
                        print(f"AM cooldown not met for {rfid} - {mins:.2f} minutes")
                        return None

        if am_complete:
            print(f"AM already complete for {rfid}")
            return None

    # PM period handling
    elif period == "pm":
        if not am_complete:
            if not am_has_in:
                print(f"Late AM time in for {rfid} at {scan_time.strftime('%H:%M:%S')}")
                return ("am", "in")
            elif am_has_in and not am_has_out:
                # Check if we're past lunch_end - if so, treat as PM time in instead of AM out
                try:
                    lunch_end_str = settings.get("attendance", {}).get("lunch_end", "13:00")
                    lunch_end_hour = int(lunch_end_str.split(":")[0])
                    lunch_end_minute = int(lunch_end_str.split(":")[1]) if ":" in lunch_end_str else 0
                    lunch_end_time = scan_time.replace(hour=lunch_end_hour, minute=lunch_end_minute, second=0, microsecond=0)

                    if scan_time >= lunch_end_time:
                        print(f"AM period ended (past lunch_end {lunch_end_str}), treating scan as PM time in for {rfid} at {scan_time.strftime('%H:%M:%S')}")
                        return ("pm", "in")
                except Exception as e:
                    print(f"Error checking lunch_end time: {e}")
                    # Fall back to original logic if settings parsing fails

                if rfid in last_scan_tracking:
                    last_scan_data = last_scan_tracking[rfid]
                    last_scan_time = last_scan_data.get("last_scan_time")
                    last_scan_type = last_scan_data.get("last_scan_type")
                    if last_scan_type == "in":
                        time_diff_seconds = (scan_time - last_scan_time).total_seconds()
                        if time_diff_seconds >= SCAN_COOLDOWN_SECONDS:
                            print(f"Late AM time out for {rfid} at {scan_time.strftime('%H:%M:%S')}")
                            return ("am", "out")
                        else:
                            mins = time_diff_seconds / 60.0
                            print(f"AM cooldown not met for {rfid} - {mins:.2f} minutes")
                            return None
                return ("am", "out")

        if not pm_has_in:
            return ("pm", "in")

        if pm_has_in and not pm_has_out:
            if rfid in last_scan_tracking:
                last_scan_data = last_scan_tracking[rfid]
                last_scan_time = last_scan_data.get("last_scan_time")
                last_scan_type = last_scan_data.get("last_scan_type")

                if last_scan_type == "in":
                    time_diff_seconds = (scan_time - last_scan_time).total_seconds()
                    if time_diff_seconds >= SCAN_COOLDOWN_SECONDS:
                        return ("pm", "out")
                    else:
                        mins = time_diff_seconds / 60.0
                        print(f"PM cooldown not met for {rfid} - {mins:.2f} minutes")
                        return None

        if pm_complete:
            print(f"PM already complete for {rfid}")
            return None

    if not has_time_in_for_period(day_data, period):
        return (period, "in")
    else:
        return None

# Format a datetime as 12-hour time (no AM/PM suffix) for DTR storage.
def format_dtr_time(scan_time):
    """
    Convert a datetime to a 12-hour time string without AM/PM.
    """
    hour = scan_time.hour % 12
    if hour == 0:
        hour = 12
    return f"{hour:02d}:{scan_time.minute:02d}:{scan_time.second:02d}"

# Add a device timestamp to the correct AM or PM DTR slot.
def record_attendance_scan(employee, scanned_at):
    """Record attendance scan - handles creating records for new employees and months"""
    scan_time = parse_scan_time(scanned_at)
    rfid = employee.get("rfid")

    # Get or create the record for this user and month
    record = get_attendance_record(employee, scan_time)

    # Find the day record in DTR
    day_date = scan_time.strftime("%Y-%m-%d")
    day_data = None
    date_key = None

    for key, day in record.get("dtr", {}).items():
        if day.get("date") == day_date:
            day_data = day
            date_key = key
            break

    if not day_data:
        # This shouldn't happen, but just in case
        day_data = {
            "date": day_date,
            "day": calendar.day_abbr[scan_time.weekday()],
            "am_in": "",
            "am_out": "",
            "pm_in": "",
            "pm_out": "",
            "hours": "0.00",
            "ut": "0.00",
            "ot": "0.00",
            "status": ""
        }
        record["dtr"][f"{scan_time.day}-{calendar.month_abbr[scan_time.month].lower()}"] = day_data

    time_value = format_dtr_time(scan_time)

    # Determine the scan type (time in or time out)
    scan_result = determine_scan_type(day_data, scan_time, employee)

    if scan_result is None:
        print(f"Scan skipped for {rfid} - cooldown not met, already scanned, or on leave")
        return record, "skipped"

    period, scan_type = scan_result
    in_key = f"{period}_in"
    out_key = f"{period}_out"

    if scan_type == "in":
        if not day_data[in_key]:
            day_data[in_key] = time_value
            print(f"Recorded {period.upper()} TIME IN for {rfid} at {time_value}")
            last_scan_tracking[rfid] = {
                "last_scan_time": scan_time,
                "last_scan_type": "in"
            }
            add_scan_to_feed(
                rfid,
                scanned_at,
                employee,
                True,
                f"{period}_in"
            )
            # Log activity
            add_activity(
                "attendance_time_in",
                f"{employee.get('firstname', '')} {employee.get('lastname', '')} ({employee.get('employeeid', '')}) clocked in for {period.upper()} shift",
                {"name": f"{employee.get('firstname', '')} {employee.get('lastname', '')}", "uid": employee.get('uid')},
                "attendance"
            )
            # Push a notification to this user's own notification file.
            try:
                push_notification(
                    rfid,
                    f"Time In Recorded ({period.upper()})",
                    f"Your {period.upper()} time-in was recorded at {time_value}.",
                    notif_type="attendance",
                    uid=employee.get("uid"),
                    fullname=f"{employee.get('firstname', '')} {employee.get('lastname', '')}".strip(),
                    role=employee.get("role")
                )
            except Exception as e:
                print(f"Warning: failed to push time-in notification for {rfid}: {e}")
        else:
            print(f"{period.upper()} TIME IN already exists for {rfid}")
            return record, "already_exists"
    elif scan_type == "out":
        if not day_data[out_key]:
            day_data[out_key] = time_value
            print(f"Recorded {period.upper()} TIME OUT for {rfid} at {time_value}")
            last_scan_tracking[rfid] = {
                "last_scan_time": scan_time,
                "last_scan_type": "out"
            }
            add_scan_to_feed(
                rfid,
                scanned_at,
                employee,
                True,
                f"{period}_out"
            )
            # Log activity
            add_activity(
                "attendance_time_out",
                f"{employee.get('firstname', '')} {employee.get('lastname', '')} ({employee.get('employeeid', '')}) clocked out for {period.upper()} shift",
                {"name": f"{employee.get('firstname', '')} {employee.get('lastname', '')}", "uid": employee.get('uid')},
                "attendance"
            )
            # Push a notification to this user's own notification file.
            try:
                push_notification(
                    rfid,
                    f"Time Out Recorded ({period.upper()})",
                    f"Your {period.upper()} time-out was recorded at {time_value}.",
                    notif_type="attendance",
                    uid=employee.get("uid"),
                    fullname=f"{employee.get('firstname', '')} {employee.get('lastname', '')}".strip(),
                    role=employee.get("role")
                )
            except Exception as e:
                print(f"Warning: failed to push time-out notification for {rfid}: {e}")
        else:
            print(f"{period.upper()} TIME OUT already exists for {rfid}")
            return record, "already_exists"

    # Calculate hours after each update.
    # Pass the period so 12-hour stored times are interpreted correctly.
    am_hours = calculate_hours(day_data.get("am_in", ""), day_data.get("am_out", ""), period="am")
    pm_hours = calculate_hours(day_data.get("pm_in", ""), day_data.get("pm_out", ""), period="pm")
    total_hours = am_hours + pm_hours

    # Only charge UT / OT when the employee has at least one complete
    # in/out pair for the day. A lone time-in (no matching time-out) is
    # treated as "no hours recorded yet" rather than 8 hours of undertime.
    am_complete = bool(day_data.get("am_in")) and bool(day_data.get("am_out"))
    pm_complete = bool(day_data.get("pm_in")) and bool(day_data.get("pm_out"))
    has_complete_pair = am_complete or pm_complete

    # Required daily hours now come from settings.json (work_start,
    # work_end, lunch_start, lunch_end) instead of a hardcoded 8.
    required_hours = get_required_hours()

    day_data["hours"] = f"{total_hours:.2f}"

    if has_complete_pair:
        day_data["ut"] = f"{max(0, required_hours - total_hours):.2f}"
        day_data["ot"] = f"{max(0, total_hours - required_hours):.2f}"
    else:
        day_data["ut"] = "0.00"
        day_data["ot"] = "0.00"

    # Calculate total hours for the month
    total_hours_month = 0
    total_ut_month = 0
    total_ot_month = 0
    for day in record.get("dtr", {}).values():
        try:
            total_hours_month += float(day.get("hours", "0.00"))
            total_ut_month += float(day.get("ut", "0.00"))
            total_ot_month += float(day.get("ot", "0.00"))
        except:
            pass

    record["total_hours"] = f"{total_hours_month:.2f}"
    record["total_ut"] = f"{total_ut_month:.2f}"
    record["total_ot"] = f"{total_ot_month:.2f}"

    return record, "success"

# Parse the timestamp supplied by the RFID device.
def parse_scan_time(scanned_at):
    try:
        return datetime.strptime(scanned_at, "%Y-%m-%d %H:%M:%S")
    except (TypeError, ValueError):
        return datetime.now()

# Calculate completed hours between an in and out time.
# Accepts 12-hour formatted times (e.g. "08:30:00" or "01:45:00").
# The `period` argument ("am" or "pm") tells us whether an hour < 12
# should be interpreted as morning or afternoon.
def calculate_hours(start_time, end_time, period=None):
    if not start_time or not end_time:
        return 0
    try:
        start = datetime.strptime(start_time, "%H:%M:%S")
        end = datetime.strptime(end_time, "%H:%M:%S")

        # If a period was supplied and the parsed hour is less than 12,
        # add 12 hours so afternoon times are computed correctly.
        if period == "pm":
            if start.hour < 12:
                start = start.replace(hour=start.hour + 12)
            if end.hour < 12:
                end = end.replace(hour=end.hour + 12)
        elif period == "am":
            # 12:xx in the AM slot should actually be 00:xx (midnight hour)
            if start.hour == 12:
                start = start.replace(hour=0)
            if end.hour == 12:
                end = end.replace(hour=0)

        return max(0, (end - start).total_seconds() / 3600)
    except:
        return 0

# Ensure every registered user has a DTR record for the current month.
def initialize_attendance_records():
    """Only adds missing records for the current month, never overwrites existing ones"""
    current_month = datetime.now()
    records_created = 0
    for employee in employee_database.values():
        get_attendance_record(employee, current_month)
        records_created += 1
    save_attendance_data()
    print(f"Initialized attendance records - {records_created} employees checked")

# Build the RFID lookup database from all user roles.
def load_employee_database():
    os.makedirs(os.path.dirname(USER_DATA_FILE), exist_ok=True)

    if not os.path.exists(USER_DATA_FILE):
        print("File not found: storage/database/users.json - database is empty")
        default_data = {"admin": [], "hr": [], "employees": []}
        with open(USER_DATA_FILE, "w", encoding="utf-8") as f:
            json.dump(default_data, f, indent=4)
            f.write("\n")
        return {}

    try:
        with open(USER_DATA_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (json.JSONDecodeError, OSError) as e:
        print("Error reading storage/database/users.json:", str(e))
        if os.path.exists(USER_DATA_FILE):
            backup_file = USER_DATA_FILE + ".backup"
            try:
                os.rename(USER_DATA_FILE, backup_file)
                print(f"Corrupted users.json backed up to: {backup_file}")
            except:
                pass
        return {}

    db = {}
    for category in ["admin", "hr", "employees"]:
        if category in data and isinstance(data[category], list):
            for emp in data[category]:
                rfid = emp.get("rfid", "").strip().upper()
                emp["role"] = "employee" if category == "employees" else category
                if rfid:
                    # Normal case: index by RFID
                    db[rfid] = emp
                else:
                    # Fallback: index by UID so the employee still appears in the system
                    uid = str(emp.get("uid", "")).strip()
                    if uid:
                        # Use a synthetic key that won't collide with real RFIDs
                        fallback_key = f"__UID__{uid}"
                        db[fallback_key] = emp
                        print(f"  Loaded employee without RFID (UID {uid}): {emp.get('lastname', '')}")
    print("Loaded", len(db), "employees from storage/database/users.json")
    return db

employee_database = load_employee_database()

# Delete devices that have stopped sending heartbeat pings.
def remove_offline_devices():
    current_time = datetime.now()
    offline_devices = [
        device_id for device_id, data in device_status.items()
        if (current_time - data["last_seen_at"]).total_seconds() > DEVICE_TIMEOUT_SECONDS
    ]
    for device_id in offline_devices:
        del device_status[device_id]

# Get the current online device list for web display.
def get_online_devices():
    remove_offline_devices()
    return [
        {
            "device_id": device_id,
            "status": data["status"],
            "last_seen": data["last_seen"],
        }
        for device_id, data in device_status.items()
    ]

# Calculate live attendance totals from today's recognized RFID scans.
def get_dashboard_statistics():
    today = datetime.now().date()
    today_events = [event for event in scan_events if event.get("scanned_on") == today.isoformat()]

    # All employees (regardless of RFID)
    all_employees = [
        emp for emp in employee_database.values()
        if emp.get("role") == "employee"
    ]
    total_employees = len(all_employees)

    # Only those with real RFIDs can be matched to scans
    employee_rfids = {
        emp.get("rfid", "").strip().upper()
        for emp in all_employees
        if emp.get("rfid", "").strip()
    }
    present_rfids = {
        event["rfid"] for event in today_events
        if event.get("rfid") in employee_rfids
    }
    present_today = len(present_rfids)
    absent_today = max(total_employees - present_today, 0)
    attendance_rate = round((present_today / total_employees) * 100, 1) if total_employees else 0

    return {
        "total_employees": total_employees,
        "present_today": present_today,
        "absent_today": absent_today,
        "employees_late": 0,
        "on_leave": len(leave_data.get("approved", [])),
        "attendance_rate": attendance_rate,
        "rfid_scans_today": len(today_events),
        "departments": 0,
    }

# Prepare recent scans and user records for the dashboard UI.
def get_dashboard_data():
    recent_scans = []
    for event in reversed(scan_events[-50:]):
        employee = employee_database.get(event.get("rfid"))
        recent_scans.append({
            "rfid": event.get("rfid"),
            "scanned_at": event.get("scanned_at"),
            "found": bool(employee),
            "employee": {
                "uid": employee.get("uid"),
                "employeeid": employee.get("employeeid"),
                "lastname": employee.get("lastname"),
                "firstname": employee.get("firstname"),
                "role": employee.get("role"),
                "department": employee.get("department"),
                "image": employee.get("image")
            } if employee else None
        })

    users = [
        {
            "uid": employee.get("uid"),
            "rfid": employee.get("rfid"),
            "employeeid": employee.get("employeeid"),
            "lastname": employee.get("lastname"),
            "firstname": employee.get("firstname"),
            "address": employee.get("address"),
            "bdate": employee.get("bdate"),
            "cpnumber": employee.get("cpnumber"),
            "email": employee.get("email"),
            "username": employee.get("username"),
            "role": employee.get("role"),
            "department": employee.get("department"),
            "position": employee.get("position"),
            "image": employee.get("image"),
            "timestamp_creation": employee.get("timestamp_creation"),
            "timestamp_modified": employee.get("timestamp_modified")
        }
        for employee in employee_database.values()
    ]

    # Load activity feed
    activity_feed = load_activity_feed()

    # Both leave files hold the same data, so the persistent copy is the
    # source of truth for the dashboard payload.
    leaves_payload = {
        "requests": leave_data.get("requests", []),
        "approved": leave_data.get("approved", []),
        "rejected": leave_data.get("rejected", []),
    }

    return {
        "stats": get_dashboard_statistics(),
        "users": users,
        "attendance": attendance_records,
        "scans": recent_scans,
        "devices": get_online_devices(),
        "latest_scan": recent_scans[0] if recent_scans else None,
        "leaves": leaves_payload,
        "activities": activity_feed.get("activities", [])
    }

# Return only the supported role from a user record.
def get_user_role(user):
    role = str(user.get("role", "employee")).strip().lower()
    return role if role in ROLE_DASHBOARDS else "employee"

# Build the frontend destination for the authenticated role.
def get_role_redirect(role):
    return ROLE_DASHBOARDS[role]

# Helper function to verify JWT token
def verify_token():
    auth_header = request.headers.get('Authorization')
    if not auth_header or not auth_header.startswith('Bearer '):
        return None, jsonify({"status": "error", "message": "No token provided"}), 401

    token = auth_header.split(' ')[1]
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=['HS256'])
        user_data = payload.get('user')
        if not user_data:
            return None, jsonify({"status": "error", "message": "Invalid token"}), 401
        return user_data, None, None
    except jwt.ExpiredSignatureError:
        return None, jsonify({"status": "error", "message": "Token expired"}), 401
    except jwt.InvalidTokenError:
        return None, jsonify({"status": "error", "message": "Invalid token"}), 401

# Get the latest scan for a specific RFID with attendance details
@app.route("/api/get-employee-attendance/<rfid>", methods=["GET"])
def get_employee_attendance(rfid):
    """Get attendance details for a specific employee including today's time in/out"""
    rfid = rfid.strip().upper()
    employee = employee_database.get(rfid)

    # Fallback: try to find by UID if not found by RFID
    if not employee:
        for emp in employee_database.values():
            if str(emp.get("uid", "")).strip() == rfid:
                employee = emp
                break

    if not employee:
        return jsonify({
            "status": "error",
            "message": "Employee not found"
        }), 404

    today = datetime.now().date()
    today_str = today.strftime("%Y-%m-%d")
    month_key = today.strftime("%Y-%m")

    # Find attendance record for this employee
    attendance_record = None
    for record in attendance_records:
        if record.get("uid") == employee.get("uid") and record.get("month") == month_key:
            attendance_record = record
            break

    # Get today's data from DTR
    am_in = None
    am_out = None
    pm_in = None
    pm_out = None
    status = None

    if attendance_record:
        for key, day in attendance_record.get("dtr", {}).items():
            if day.get("date") == today_str:
                am_in = day.get("am_in", "")
                am_out = day.get("am_out", "")
                pm_in = day.get("pm_in", "")
                pm_out = day.get("pm_out", "")
                status = day.get("status", "")
                break

    # Build response
    response_data = {
        "status": "success",
        "employee": {
            "uid": employee.get("uid"),
            "employeeid": employee.get("employeeid"),
            "firstname": employee.get("firstname"),
            "lastname": employee.get("lastname"),
            "role": employee.get("role"),
            "image": employee.get("image", "")
        },
        "attendance": {
            "date": today_str,
            "am_in": am_in or "",
            "am_out": am_out or "",
            "pm_in": pm_in or "",
            "pm_out": pm_out or "",
            "status": status or ""
        }
    }

    return jsonify(response_data), 200

# ============================================================================
# NOTIFICATION API ROUTES
# ============================================================================

@app.route("/api/notifications/<rfid>", methods=["GET"])
def get_notifications(rfid):
    """Fetch the notification document for a specific RFID."""
    safe_rfid = _sanitize_rfid(rfid)
    if not safe_rfid:
        return jsonify({"status": "error", "message": "Invalid RFID"}), 400

    # Pull employee info if we know this RFID so the doc is always current.
    employee = employee_database.get(safe_rfid)
    uid = employee.get("uid") if employee else None
    fullname = f"{employee.get('firstname', '')} {employee.get('lastname', '')}".strip() if employee else None
    role = employee.get("role") if employee else None

    doc = load_notifications(safe_rfid, uid=uid, fullname=fullname, role=role)
    return jsonify({"status": "success", "data": doc}), 200

@app.route("/api/notifications/<rfid>", methods=["POST"])
def create_notification(rfid):
    """Create a new notification for a specific RFID.

    Body (JSON):
        {
            "title": "...",
            "message": "...",
            "type": "system" | "attendance" | "leave" | "employee"
        }
    """
    safe_rfid = _sanitize_rfid(rfid)
    if not safe_rfid:
        return jsonify({"status": "error", "message": "Invalid RFID"}), 400

    data = request.get_json() or {}
    title = str(data.get("title", "")).strip()
    message = str(data.get("message", "")).strip()
    notif_type = str(data.get("type", "system")).strip().lower() or "system"

    if not title or not message:
        return jsonify({"status": "error", "message": "title and message are required"}), 400

    employee = employee_database.get(safe_rfid)
    entry = push_notification(
        safe_rfid,
        title,
        message,
        notif_type=notif_type,
        uid=employee.get("uid") if employee else None,
        fullname=f"{employee.get('firstname', '')} {employee.get('lastname', '')}".strip() if employee else None,
        role=employee.get("role") if employee else None
    )

    if not entry:
        return jsonify({"status": "error", "message": "Could not create notification"}), 500

    return jsonify({"status": "success", "data": entry}), 200

@app.route("/api/notifications/<rfid>/clear", methods=["POST"])
def clear_user_notifications(rfid):
    """Clear ALL notifications for a given RFID."""
    safe_rfid = _sanitize_rfid(rfid)
    if not safe_rfid:
        return jsonify({"status": "error", "message": "Invalid RFID"}), 400

    ok = clear_notifications(safe_rfid)
    if not ok:
        return jsonify({"status": "error", "message": "Could not clear notifications"}), 500

    return jsonify({"status": "success", "message": "All notifications cleared"}), 200

@app.route("/api/notifications/<rfid>/read-all", methods=["POST"])
def mark_all_read(rfid):
    """Mark every notification for a given RFID as read."""
    safe_rfid = _sanitize_rfid(rfid)
    if not safe_rfid:
        return jsonify({"status": "error", "message": "Invalid RFID"}), 400

    ok = mark_all_notifications_read(safe_rfid)
    if not ok:
        return jsonify({"status": "error", "message": "Could not update notifications"}), 500

    return jsonify({"status": "success", "message": "All notifications marked read"}), 200

@app.route("/api/notifications/<rfid>/<notification_id>", methods=["PATCH"])
def update_notification(rfid, notification_id):
    """Mark a single notification as read."""
    safe_rfid = _sanitize_rfid(rfid)
    if not safe_rfid:
        return jsonify({"status": "error", "message": "Invalid RFID"}), 400

    ok = mark_notification_read(safe_rfid, notification_id)
    if not ok:
        return jsonify({"status": "error", "message": "Notification not found"}), 404

    return jsonify({"status": "success", "message": "Notification marked read"}), 200

@app.route("/api/notifications/<rfid>/<notification_id>", methods=["DELETE"])
def delete_single_notification(rfid, notification_id):
    """Delete a single notification entry."""
    safe_rfid = _sanitize_rfid(rfid)
    if not safe_rfid:
        return jsonify({"status": "error", "message": "Invalid RFID"}), 400

    ok = delete_notification(safe_rfid, notification_id)
    if not ok:
        return jsonify({"status": "error", "message": "Notification not found"}), 404

    return jsonify({"status": "success", "message": "Notification deleted"}), 200

## DTR GENERATION ROUTES ------------------------------------
# Get all employees (excluding admin and hr) for DTR selection
@app.route("/api/dtr/employees", methods=["GET"])
def get_dtr_employees():
    """Get list of all employees (excluding admin and hr) for DTR selection"""
    auth_header = request.headers.get('Authorization')
    if auth_header and auth_header.startswith('Bearer '):
        user_data, error_response, status_code = verify_token()
        if error_response:
            return error_response, status_code
    else:
        if not session.get("user"):
            return jsonify({
                "status": "error",
                "message": "Session expired or user is not logged in"
            }), 401

    employees = []
    for key, emp in employee_database.items():
        role = emp.get("role", "").lower()
        if role not in ["admin", "hr"]:
            employees.append({
                "uid": emp.get("uid"),
                "employeeid": emp.get("employeeid"),
                "rfid": emp.get("rfid", ""),
                "fullname": f"{emp.get('firstname', '')} {emp.get('lastname', '')}".strip(),
                "firstname": emp.get("firstname"),
                "lastname": emp.get("lastname"),
                "position": emp.get("position", ""),
                "department": emp.get("department", ""),
                "role": role
            })

    # Sort by fullname
    employees.sort(key=lambda x: x.get("fullname", ""))

    return jsonify({
        "status": "success",
        "data": employees
    }), 200

# Get attendance record for a specific employee for DTR generation
@app.route("/api/dtr/record/<rfid>", methods=["GET"])
def get_dtr_record(rfid):
    """Get attendance record for a specific employee for DTR generation"""
    auth_header = request.headers.get('Authorization')
    if auth_header and auth_header.startswith('Bearer '):
        user_data, error_response, status_code = verify_token()
        if error_response:
            return error_response, status_code
    else:
        if not session.get("user"):
            return jsonify({
                "status": "error",
                "message": "Session expired or user is not logged in"
            }), 401

    identifier = rfid.strip().upper()
    employee = employee_database.get(identifier)

    # Fallback: try to find by UID if not found by RFID
    if not employee:
        for emp in employee_database.values():
            if str(emp.get("uid", "")).strip() == identifier:
                employee = emp
                break

    if not employee:
        return jsonify({
            "status": "error",
            "message": "Employee not found"
        }), 404

    # Get month parameter (default to current month)
    month = request.args.get("month", datetime.now().strftime("%Y-%m"))

    # Find attendance record for this employee and month
    attendance_record = None
    for record in attendance_records:
        if record.get("uid") == employee.get("uid") and record.get("month") == month:
            attendance_record = record
            break

    if not attendance_record:
        # Create a new record for this employee and month
        scan_date = datetime.strptime(month + "-01", "%Y-%m-%d")
        attendance_record = get_attendance_record(employee, scan_date)
        save_attendance_data()

    # Prepare the response with DTR data
    dtr_data = []
    for date_key, day_data in attendance_record.get("dtr", {}).items():
        dtr_data.append({
            "date": day_data.get("date", ""),
            "day": day_data.get("day", ""),
            "am_in": day_data.get("am_in", ""),
            "am_out": day_data.get("am_out", ""),
            "pm_in": day_data.get("pm_in", ""),
            "pm_out": day_data.get("pm_out", ""),
            "hours": day_data.get("hours", "0.00"),
            "ut": day_data.get("ut", "0.00"),
            "ot": day_data.get("ot", "0.00"),
            "status": day_data.get("status", "")
        })

    # Log activity
    add_activity(
        "dtr_viewed",
        f"DTR viewed for {employee.get('firstname', '')} {employee.get('lastname', '')} for {attendance_record.get('month_display', '')}",
        {"name": session.get("user", {}).get("fullname", "User")},
        "attendance"
    )

    return jsonify({
        "status": "success",
        "data": {
            "employee": {
                "uid": employee.get("uid"),
                "employeeid": employee.get("employeeid"),
                "rfid": employee.get("rfid", ""),
                "fullname": f"{employee.get('firstname', '')} {employee.get('lastname', '')}".strip(),
                "firstname": employee.get("firstname"),
                "lastname": employee.get("lastname"),
                "position": employee.get("position", ""),
                "department": employee.get("department", ""),
                "image": employee.get("image", "")
            },
            "record": {
                "id": attendance_record.get("id"),
                "month": attendance_record.get("month"),
                "month_display": attendance_record.get("month_display"),
                "total_hours": attendance_record.get("total_hours", "0.00"),
                "total_ut": attendance_record.get("total_ut", "0.00"),
                "total_ot": attendance_record.get("total_ot", "0.00"),
                "dtr": dtr_data
            }
        }
    }), 200

# Generate and download DTR as PDF
@app.route("/api/dtr/generate-pdf/<rfid>", methods=["GET"])
def generate_dtr_pdf(rfid):
    """Generate DTR PDF for a specific employee"""
    # Check if reportlab is available
    if not REPORTLAB_AVAILABLE:
        return jsonify({
            "status": "error",
            "message": "PDF generation is not available. Please install reportlab."
        }), 500

    auth_header = request.headers.get('Authorization')
    if auth_header and auth_header.startswith('Bearer '):
        user_data, error_response, status_code = verify_token()
        if error_response:
            return error_response, status_code
    else:
        if not session.get("user"):
            return jsonify({
                "status": "error",
                "message": "Session expired or user is not logged in"
            }), 401

    identifier = rfid.strip().upper()
    employee = employee_database.get(identifier)

    # Fallback: try to find by UID if not found by RFID
    if not employee:
        for emp in employee_database.values():
            if str(emp.get("uid", "")).strip() == identifier:
                employee = emp
                break

    if not employee:
        return jsonify({
            "status": "error",
            "message": "Employee not found"
        }), 404

    # Get month parameter (default to current month)
    month = request.args.get("month", datetime.now().strftime("%Y-%m"))

    # Find attendance record for this employee and month
    attendance_record = None
    for record in attendance_records:
        if record.get("uid") == employee.get("uid") and record.get("month") == month:
            attendance_record = record
            break

    if not attendance_record:
        scan_date = datetime.strptime(month + "-01", "%Y-%m-%d")
        attendance_record = get_attendance_record(employee, scan_date)
        save_attendance_data()

    # Create PDF
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=landscape(letter),
                           rightMargin=0.5*inch, leftMargin=0.5*inch,
                           topMargin=0.5*inch, bottomMargin=0.5*inch)

    styles = getSampleStyleSheet()
    styles.add(ParagraphStyle(
        name='CenterTitle',
        parent=styles['Normal'],
        fontSize=14,
        alignment=TA_CENTER,
        fontName='Helvetica-Bold',
        spaceAfter=6
    ))
    styles.add(ParagraphStyle(
        name='CenterSubtitle',
        parent=styles['Normal'],
        fontSize=10,
        alignment=TA_CENTER,
        fontName='Helvetica',
        spaceAfter=4
    ))
    styles.add(ParagraphStyle(
        name='CenterSmall',
        parent=styles['Normal'],
        fontSize=8,
        alignment=TA_CENTER,
        fontName='Helvetica',
        spaceAfter=2
    ))
    styles.add(ParagraphStyle(
        name='RightText',
        parent=styles['Normal'],
        fontSize=9,
        alignment=TA_RIGHT,
        fontName='Helvetica'
    ))
    styles.add(ParagraphStyle(
        name='InfoText',
        parent=styles['Normal'],
        fontSize=9,
        fontName='Helvetica',
        spaceAfter=2
    ))

    elements = []

    # Title
    elements.append(Paragraph("DAILY TIME RECORD", styles['CenterTitle']))
    elements.append(Paragraph("Civil Service Commission · Republic of the Philippines", styles['CenterSubtitle']))
    elements.append(Paragraph("CSC Form No. 48 — Revised 2018", styles['CenterSmall']))
    elements.append(Spacer(1, 0.15*inch))

    # Employee Info
    fullname = f"{employee.get('firstname', '')} {employee.get('lastname', '')}".strip()
    employee_info = [
        [Paragraph(f"<b>Employee:</b> {fullname}", styles['InfoText']),
         Paragraph(f"<b>Employee ID:</b> {employee.get('employeeid', '')}", styles['InfoText'])],
        [Paragraph(f"<b>Position:</b> {employee.get('position', '')}", styles['InfoText']),
         Paragraph(f"<b>Department:</b> {employee.get('department', '')}", styles['InfoText'])],
        [Paragraph(f"<b>Month:</b> {attendance_record.get('month_display', '')}", styles['InfoText']),
         Paragraph(f"<b>RFID:</b> {employee.get('rfid', '')}", styles['InfoText'])]
    ]

    info_table = Table(employee_info, colWidths=[4.5*inch, 4.5*inch])
    info_table.setStyle(TableStyle([
        ('FONTNAME', (0, 0), (-1, -1), 'Helvetica'),
        ('FONTSIZE', (0, 0), (-1, -1), 9),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('TOPPADDING', (0, 0), (-1, -1), 2),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 2),
    ]))
    elements.append(info_table)
    elements.append(Spacer(1, 0.15*inch))

    # DTR Table
    dtr_data = []
    header = ['Day', 'Date', 'AM In', 'AM Out', 'PM In', 'PM Out', 'Hours', 'UT', 'OT', 'Status']
    dtr_data.append(header)

    for date_key, day in attendance_record.get("dtr", {}).items():
        row = [
            day.get("day", ""),
            day.get("date", ""),
            day.get("am_in", ""),
            day.get("am_out", ""),
            day.get("pm_in", ""),
            day.get("pm_out", ""),
            day.get("hours", "0.00"),
            day.get("ut", "0.00"),
            day.get("ot", "0.00"),
            day.get("status", "")
        ]
        dtr_data.append(row)

    # Add totals row
    dtr_data.append([
        "TOTALS", "", "", "", "", "",
        attendance_record.get("total_hours", "0.00"),
        attendance_record.get("total_ut", "0.00"),
        attendance_record.get("total_ot", "0.00"),
        ""
    ])

    # Create table with column widths - landscape gives more room
    col_widths = [0.5*inch, 0.9*inch, 0.65*inch, 0.65*inch, 0.65*inch, 0.65*inch, 0.6*inch, 0.5*inch, 0.5*inch, 0.7*inch]
    dtr_table = Table(dtr_data, colWidths=col_widths, repeatRows=1)

    # Style the table
    table_style = TableStyle([
        ('FONTNAME', (0, 0), (-1, -1), 'Helvetica'),
        ('FONTSIZE', (0, 0), (-1, -1), 7),
        ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('GRID', (0, 0), (-1, -2), 0.5, colors.black),
        ('BOX', (0, 0), (-1, -1), 1, colors.black),
        ('BACKGROUND', (0, 0), (-1, 0), colors.lightgrey),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, 0), 7),
        ('BACKGROUND', (0, -1), (-1, -1), colors.lightgrey),
        ('FONTNAME', (0, -1), (-1, -1), 'Helvetica-Bold'),
        ('FONTSIZE', (0, -1), (-1, -1), 7),
        ('TOPPADDING', (0, 0), (-1, -1), 2),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 2),
        ('LEFTPADDING', (0, 0), (-1, -1), 2),
        ('RIGHTPADDING', (0, 0), (-1, -1), 2),
    ])

    # Color rows that are on leave
    for i, row in enumerate(dtr_data[1:], start=1):
        if len(row) > 9 and row[9] == "on_leave":
            table_style.add('BACKGROUND', (0, i), (-1, i), colors.yellow)

    dtr_table.setStyle(table_style)
    elements.append(dtr_table)
    elements.append(Spacer(1, 0.2*inch))

    # Signature lines
    sig_data = [
        ['', '', ''],
        ['______________________', '______________________', '______________________'],
        ['Employee Signature', 'Prepared By', 'Approved By'],
        ['', 'HR Officer', 'Department Head']
    ]
    sig_table = Table(sig_data, colWidths=[2.7*inch, 2.7*inch, 2.7*inch])
    sig_table.setStyle(TableStyle([
        ('FONTNAME', (0, 0), (-1, -1), 'Helvetica'),
        ('FONTSIZE', (0, 0), (-1, -1), 8),
        ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('TOPPADDING', (0, 0), (-1, -1), 4),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
        ('FONTNAME', (0, 2), (-1, 2), 'Helvetica-Bold'),
    ]))
    elements.append(sig_table)

    # Build PDF
    doc.build(elements)
    buffer.seek(0)

    # Log activity
    add_activity(
        "dtr_generated",
        f"DTR PDF generated for {employee.get('firstname', '')} {employee.get('lastname', '')} for {attendance_record.get('month_display', '')}",
        {"name": session.get("user", {}).get("fullname", "User")},
        "attendance"
    )

    # Return PDF
    filename = f"DTR_{employee.get('lastname', 'unknown')}_{employee.get('firstname', 'unknown')}_{month}.pdf"
    response = make_response(buffer.getvalue())
    response.headers['Content-Type'] = 'application/pdf'
    response.headers['Content-Disposition'] = f'attachment; filename="{filename}"'

    return response

# Get available months for DTR
@app.route("/api/dtr/months", methods=["GET"])
def get_dtr_months():
    """Get list of available months with attendance records"""
    auth_header = request.headers.get('Authorization')
    if auth_header and auth_header.startswith('Bearer '):
        user_data, error_response, status_code = verify_token()
        if error_response:
            return error_response, status_code
    else:
        if not session.get("user"):
            return jsonify({
                "status": "error",
                "message": "Session expired or user is not logged in"
            }), 401

    months = set()
    for record in attendance_records:
        month = record.get("month")
        month_display = record.get("month_display")
        if month and month_display:
            months.add((month, month_display))

    # Sort by month descending (newest first)
    sorted_months = sorted(list(months), key=lambda x: x[0], reverse=True)

    # If no months exist, add current month
    if not sorted_months:
        current_month = datetime.now().strftime("%Y-%m")
        current_display = datetime.now().strftime("%B %Y")
        sorted_months = [(current_month, current_display)]

    return jsonify({
        "status": "success",
        "data": [{"value": m[0], "label": m[1]} for m in sorted_months]
    }), 200

## LEAVE MANAGEMENT ROUTES ------------------------------------
# Request leave
@app.route("/api/request-leave", methods=["POST"])
def request_leave():
    try:
        data = request.get_json()
        if not data:
            return jsonify({"status": "error", "message": "Missing data"}), 400

        required = ["rfid", "start_date", "end_date", "reason", "leave_type"]
        if not all(key in data for key in required):
            return jsonify({
                "status": "error",
                "message": "Missing required fields: rfid, start_date, end_date, reason, leave_type"
            }), 400

        rfid = data["rfid"].strip().upper()
        employee = employee_database.get(rfid)

        # Fallback: try to find by UID if not found by RFID
        if not employee:
            for emp in employee_database.values():
                if str(emp.get("uid", "")).strip() == rfid:
                    employee = emp
                    break

        if not employee:
            return jsonify({"status": "error", "message": "Employee not found"}), 404

        # Build a request ID that won't collide with existing entries.
        existing_ids = []
        for req in leave_data.get("requests", []) + leave_data.get("approved", []) + leave_data.get("rejected", []):
            try:
                existing_ids.append(int(req.get("id", "0")))
            except (ValueError, TypeError):
                pass
        request_id = str(max(existing_ids + [0]) + 1).zfill(3)

        leave_request = {
            "id": request_id,
            "rfid": rfid,
            "uid": employee.get("uid"),
            "employeeid": employee.get("employeeid"),
            "fullname": f"{employee.get('firstname', '')} {employee.get('lastname', '')}".strip(),
            "department": employee.get("department", ""),
            "leave_type": data["leave_type"],
            "start_date": data["start_date"],
            "end_date": data["end_date"],
            "reason": data.get("reason", ""),
            "status": "pending",
            "requested_at": datetime.now().isoformat(),
            "processed_at": None,
            "processed_by": None,
            "days": []
        }

        start_date = datetime.strptime(data["start_date"], "%Y-%m-%d")
        end_date = datetime.strptime(data["end_date"], "%Y-%m-%d")

        current_date = start_date
        while current_date <= end_date:
            if current_date.weekday() < 5:
                leave_request["days"].append(current_date.strftime("%Y-%m-%d"))
            current_date += timedelta(days=1)

        # Append to the persistent structure and mirror to BOTH files.
        leave_data["requests"].append(leave_request)
        save_both_leave_files(leave_data)

        # Log activity
        add_activity(
            "leave_requested",
            f"{employee.get('firstname', '')} {employee.get('lastname', '')} requested {data['leave_type']} leave from {data['start_date']} to {data['end_date']}",
            {"name": f"{employee.get('firstname', '')} {employee.get('lastname', '')}", "uid": employee.get('uid')},
            "leave"
        )

        # Notify the employee that their request was received.
        try:
            push_notification(
                rfid,
                "Leave Request Submitted",
                f"Your {data['leave_type']} leave request from {data['start_date']} to {data['end_date']} is now pending approval.",
                notif_type="leave",
                uid=employee.get("uid"),
                fullname=f"{employee.get('firstname', '')} {employee.get('lastname', '')}".strip(),
                role=employee.get("role")
            )
        except Exception as e:
            print(f"Warning: failed to push leave-request notification: {e}")

        return jsonify({
            "status": "success",
            "message": "Leave request submitted successfully",
            "data": leave_request
        }), 200

    except Exception as e:
        print(f"Leave request error: {str(e)}")
        return jsonify({"status": "error", "message": str(e)}), 500

# Get all leave requests (for HR/Admin)
@app.route("/api/leave-requests", methods=["GET"])
def get_leave_requests():
    auth_header = request.headers.get('Authorization')
    if auth_header and auth_header.startswith('Bearer '):
        user_data, error_response, status_code = verify_token()
        if error_response:
            return error_response, status_code
    else:
        if not session.get("user"):
            return jsonify({
                "status": "error",
                "message": "Session expired or user is not logged in"
            }), 401

    # Persistent file is the source of truth — the feed mirrors it.
    return jsonify({
        "status": "success",
        "data": {
            "requests": leave_data.get("requests", []),
            "approved": leave_data.get("approved", []),
            "rejected": leave_data.get("rejected", []),
        }
    }), 200

# Get leave requests for a specific employee
@app.route("/api/leave-requests/<rfid>", methods=["GET"])
def get_employee_leave_requests(rfid):
    identifier = rfid.strip().upper()

    # Try RFID lookup first
    employee = employee_database.get(identifier)

    # Fallback: try to find by UID
    if not employee:
        for emp in employee_database.values():
            if str(emp.get("uid", "")).strip() == identifier:
                employee = emp
                break

    if not employee:
        return jsonify({"status": "error", "message": "Employee not found"}), 404

    # Use the employee's UID for filtering so it works with both RFID and UID lookups
    uid = employee.get("uid")

    employee_requests = [
        req for req in leave_data.get("requests", []) if req.get("uid") == uid
    ]
    employee_approved = [
        req for req in leave_data.get("approved", []) if req.get("uid") == uid
    ]
    employee_rejected = [
        req for req in leave_data.get("rejected", []) if req.get("uid") == uid
    ]

    return jsonify({
        "status": "success",
        "data": {
            "requests": employee_requests,
            "approved": employee_approved,
            "rejected": employee_rejected
        }
    }), 200

# Approve leave request
@app.route("/api/approve-leave/<request_id>", methods=["POST"])
def approve_leave(request_id):
    try:
        auth_header = request.headers.get('Authorization')
        if auth_header and auth_header.startswith('Bearer '):
            user_data, error_response, status_code = verify_token()
            if error_response:
                return error_response, status_code
        else:
            if not session.get("user"):
                return jsonify({
                    "status": "error",
                    "message": "Session expired or user is not logged in"
                }), 401

        request_to_approve = None
        request_index = -1

        for idx, req in enumerate(leave_data["requests"]):
            if req.get("id") == request_id:
                request_to_approve = req
                request_index = idx
                break

        if not request_to_approve:
            return jsonify({"status": "error", "message": "Leave request not found"}), 404

        request_to_approve["status"] = "approved"
        request_to_approve["processed_at"] = datetime.now().isoformat()
        request_to_approve["processed_by"] = user_data.get("fullname") or user_data.get("username")

        leave_data["approved"].append(request_to_approve)
        leave_data["requests"].pop(request_index)

        # Update attendance records for the approved leave days
        uid = request_to_approve.get("uid")
        for date_str in request_to_approve.get("days", []):
            date_obj = datetime.strptime(date_str, "%Y-%m-%d")
            month_key = date_obj.strftime("%Y-%m")

            for record in attendance_records:
                if record.get("uid") == uid and record.get("month") == month_key:
                    for key, day in record.get("dtr", {}).items():
                        if day.get("date") == date_str:
                            day["status"] = "on_leave"
                            day["am_in"] = ""
                            day["am_out"] = ""
                            day["pm_in"] = ""
                            day["pm_out"] = ""
                            day["hours"] = "0.00"
                            day["ut"] = "0.00"
                            day["ot"] = "0.00"
                            print(f"Marked {date_str} as ON LEAVE for {request_to_approve.get('fullname')}")
                            break
                    break

        # Mirror to BOTH leave files.
        save_both_leave_files(leave_data)
        save_attendance_data()

        # Log activity
        add_activity(
            "leave_approved",
            f"Leave request #{request_id} for {request_to_approve.get('fullname', '')} was approved by {user_data.get('fullname') or user_data.get('username')}",
            {"name": user_data.get('fullname') or user_data.get('username'), "uid": user_data.get('uid')},
            "leave"
        )

        # Notify the employee that their request was approved.
        try:
            push_notification(
                request_to_approve.get("rfid"),
                "Leave Request Approved",
                f"Your {request_to_approve.get('leave_type', 'leave')} request from {request_to_approve.get('start_date', '')} to {request_to_approve.get('end_date', '')} has been approved.",
                notif_type="leave",
                uid=request_to_approve.get("uid"),
                fullname=request_to_approve.get("fullname"),
                role="employee"
            )
        except Exception as e:
            print(f"Warning: failed to push leave-approved notification: {e}")

        return jsonify({
            "status": "success",
            "message": "Leave request approved successfully",
            "data": request_to_approve
        }), 200

    except Exception as e:
        print(f"Approve leave error: {str(e)}")
        return jsonify({"status": "error", "message": str(e)}), 500

# Reject leave request
@app.route("/api/reject-leave/<request_id>", methods=["POST"])
def reject_leave(request_id):
    try:
        auth_header = request.headers.get('Authorization')
        if auth_header and auth_header.startswith('Bearer '):
            user_data, error_response, status_code = verify_token()
            if error_response:
                return error_response, status_code
        else:
            if not session.get("user"):
                return jsonify({
                    "status": "error",
                    "message": "Session expired or user is not logged in"
                }), 401

        request_to_reject = None
        request_index = -1

        for idx, req in enumerate(leave_data["requests"]):
            if req.get("id") == request_id:
                request_to_reject = req
                request_index = idx
                break

        if not request_to_reject:
            return jsonify({"status": "error", "message": "Leave request not found"}), 404

        request_to_reject["status"] = "rejected"
        request_to_reject["processed_at"] = datetime.now().isoformat()
        request_to_reject["processed_by"] = user_data.get("fullname") or user_data.get("username")

        leave_data["rejected"].append(request_to_reject)
        leave_data["requests"].pop(request_index)

        # Mirror to BOTH leave files.
        save_both_leave_files(leave_data)

        # Log activity
        add_activity(
            "leave_rejected",
            f"Leave request #{request_id} for {request_to_reject.get('fullname', '')} was rejected by {user_data.get('fullname') or user_data.get('username')}",
            {"name": user_data.get('fullname') or user_data.get('username'), "uid": user_data.get('uid')},
            "leave"
        )

        # Notify the employee that their request was rejected.
        try:
            push_notification(
                request_to_reject.get("rfid"),
                "Leave Request Rejected",
                f"Your {request_to_reject.get('leave_type', 'leave')} request from {request_to_reject.get('start_date', '')} to {request_to_reject.get('end_date', '')} has been rejected.",
                notif_type="leave",
                uid=request_to_reject.get("uid"),
                fullname=request_to_reject.get("fullname"),
                role="employee"
            )
        except Exception as e:
            print(f"Warning: failed to push leave-rejected notification: {e}")

        return jsonify({
            "status": "success",
            "message": "Leave request rejected",
            "data": request_to_reject
        }), 200

    except Exception as e:
        print(f"Reject leave error: {str(e)}")
        return jsonify({"status": "error", "message": str(e)}), 500

## Settings Routes ------------------------------------
# Update settings
@app.route("/api/settings", methods=["GET"])
def get_settings():
    """Get current system settings"""
    auth_header = request.headers.get('Authorization')
    if auth_header and auth_header.startswith('Bearer '):
        user_data, error_response, status_code = verify_token()
        if error_response:
            return error_response, status_code
    else:
        if not session.get("user"):
            return jsonify({
                "status": "error",
                "message": "Session expired or user is not logged in"
            }), 401

    # Check for version update from GitHub
    github_version = fetch_version_from_github()
    current_version = settings.get("system", {}).get("version", "1.0.0")

    # Return settings with version info
    response_data = settings.copy()
    response_data["system"] = response_data.get("system", {}).copy()
    response_data["system"]["version"] = current_version
    response_data["system"]["github_version"] = github_version
    response_data["system"]["version_url"] = settings.get("system", {}).get("version_url", "")

    return jsonify({
        "status": "success",
        "data": response_data
    }), 200

# Update settings
@app.route("/api/settings", methods=["PUT"])
def update_settings():
    """Update system settings"""
    auth_header = request.headers.get('Authorization')
    if auth_header and auth_header.startswith('Bearer '):
        user_data, error_response, status_code = verify_token()
        if error_response:
            return error_response, status_code
    else:
        if not session.get("user"):
            return jsonify({
                "status": "error",
                "message": "Session expired or user is not logged in"
            }), 401

    try:
        data = request.get_json()
        if not data:
            return jsonify({
                "status": "error",
                "message": "No data provided"
            }), 400

        # Update attendance settings
        if "attendance" in data:
            for key in ["work_start", "work_end", "lunch_start", "lunch_end", "grace_period"]:
                if key in data["attendance"]:
                    settings["attendance"][key] = data["attendance"][key]

        # Update institution settings
        if "institution" in data:
            for key in ["name", "system_name", "academic_year", "hr_email"]:
                if key in data["institution"]:
                    settings["institution"][key] = data["institution"][key]

        # Update system settings (except version which is auto-managed)
        if "system" in data:
            if "version_url" in data["system"]:
                settings["system"]["version_url"] = data["system"]["version_url"]

        # Save settings
        save_settings(settings)

        # Log activity
        add_activity(
            "settings_updated",
            "System settings were updated",
            {"name": session.get("user", {}).get("fullname", "User")},
            "system"
        )

        return jsonify({
            "status": "success",
            "message": "Settings updated successfully",
            "data": settings
        }), 200

    except Exception as e:
        print(f"Error updating settings: {e}")
        return jsonify({
            "status": "error",
            "message": str(e)
        }), 500

# Check for version update
@app.route("/api/settings/check-version", methods=["GET"])
def check_version():
    """Check for newer version from GitHub"""
    auth_header = request.headers.get('Authorization')
    if auth_header and auth_header.startswith('Bearer '):
        user_data, error_response, status_code = verify_token()
        if error_response:
            return error_response, status_code
    else:
        if not session.get("user"):
            return jsonify({
                "status": "error",
                "message": "Session expired or user is not logged in"
            }), 401

    github_version = fetch_version_from_github()
    current_version = settings.get("system", {}).get("version", "1.0.0")

    is_newer = False
    if github_version:
        try:
            # Simple version comparison
            current_parts = current_version.split('.')
            github_parts = github_version.split('.')

            # Pad to same length
            while len(current_parts) < len(github_parts):
                current_parts.append('0')
            while len(github_parts) < len(current_parts):
                github_parts.append('0')

            for i in range(len(current_parts)):
                if int(github_parts[i]) > int(current_parts[i]):
                    is_newer = True
                    break
                elif int(github_parts[i]) < int(current_parts[i]):
                    break
        except:
            is_newer = github_version != current_version

    return jsonify({
        "status": "success",
        "data": {
            "current_version": current_version,
            "github_version": github_version,
            "is_newer_available": is_newer,
            "version_url": settings.get("system", {}).get("version_url", "")
        }
    }), 200

# Reset settings to defaults
@app.route("/api/settings/reset", methods=["POST"])
def reset_settings():
    """Reset settings to default values"""
    auth_header = request.headers.get('Authorization')
    if auth_header and auth_header.startswith('Bearer '):
        user_data, error_response, status_code = verify_token()
        if error_response:
            return error_response, status_code
    else:
        if not session.get("user"):
            return jsonify({
                "status": "error",
                "message": "Session expired or user is not logged in"
            }), 401

    global settings
    settings = DEFAULT_SETTINGS.copy()
    save_settings(settings)

    # Log activity
    add_activity(
        "settings_reset",
        "System settings were reset to defaults",
        {"name": session.get("user", {}).get("fullname", "User")},
        "system"
    )

    return jsonify({
        "status": "success",
        "message": "Settings reset to defaults",
        "data": settings
    }), 200

## Web Routes ------------------------------------
# Add CORS and no-cache headers to API responses.
@app.after_request
def add_cors_headers(response):
    origin = request.headers.get("Origin")
    if origin:
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Access-Control-Allow-Credentials"] = "true"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type, Cookie, Set-Cookie, Authorization, X-Requested-With"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS, PUT, DELETE, PATCH"
    if request.path.startswith("/api/") or request.path.startswith("/facialrecognition/"):
        response.headers["Cache-Control"] = "no-store"
    return response

@app.route('/')
def serve_index():
    return send_file('login.html')

@app.route('/login.html')
def serve_login():
    return send_file('login.html')

@app.route('/pages/<path:filename>')
def serve_pages(filename):
    return send_file(f'pages/{filename}')

@app.route('/css/<path:filename>')
def serve_css(filename):
    return send_file(f'css/{filename}')

@app.route('/js/<path:filename>')
def serve_js(filename):
    return send_file(f'js/{filename}')

# Serve profile images from storage folder (outside app)
@app.route('/storage/profiles/<filename>')
def serve_profile_image(filename):
    return send_from_directory(PROFILE_STORAGE, filename)

# Serve assets (logo, etc.)
@app.route('/storage/assets/<path:filename>')
def serve_asset(filename):
    assets_dir = os.path.join(BASE_DIR, "storage", "assets")
    return send_from_directory(assets_dir, filename)

## Authentication Routes ------------------------------------
# FIXED: Authenticate all roles and create a three-hour session.
@app.route("/api/login", methods=["POST"])
def login():
    try:
        data = request.get_json()
        if not data:
            return jsonify({
                "status": "error",
                "message": "Username and password are required"
            }), 400

        username = str(data.get("username", "")).strip()
        password = str(data.get("password", "")).strip()
        password_hash = hashlib.md5(password.encode("utf-8")).hexdigest()

        print(f"Login attempt - Username: '{username}'")
        print(f"Password hash: '{password_hash}'")
        print(f"Total users in database: {len(employee_database)}")

        for emp in employee_database.values():
            print(f"  User in DB: '{emp.get('username')}' with role: {emp.get('role')}")

        for emp in employee_database.values():
            stored_username = emp.get("username")
            if stored_username and stored_username == username:
                print(f"Username match found for: {username}")
                stored_hash = emp.get("password_hash", "").lower()
                print(f"Stored hash: '{stored_hash}'")
                print(f"Input hash:  '{password_hash}'")

                if password_hash == stored_hash:
                    role = get_user_role(emp)
                    user_data = {
                        "uid": emp.get("uid"),
                        "employeeid": emp.get("employeeid"),
                        "username": emp.get("username"),
                        "fullname": emp.get("firstname", "") + " " + emp.get("lastname", ""),
                        "role": role,
                        "rfid": emp.get("rfid")
                    }

                    token = jwt.encode({
                        'user': user_data,
                        'exp': datetime.utcnow() + JWT_EXPIRATION
                    }, JWT_SECRET, algorithm='HS256')

                    session.permanent = True
                    session["user"] = user_data
                    session.modified = True

                    print("Login successful for:", username)

                    # Log login activity
                    add_activity(
                        "user_login",
                        f"{user_data.get('fullname')} ({username}) logged in as {role.upper()}",
                        {"name": user_data.get('fullname'), "uid": user_data.get('uid')},
                        "system"
                    )

                    # Push a login notification to this user's own file.
                    try:
                        push_notification(
                            emp.get("rfid"),
                            "Login Successful",
                            f"Your account was accessed at {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}.",
                            notif_type="system",
                            uid=emp.get("uid"),
                            fullname=f"{emp.get('firstname', '')} {emp.get('lastname', '')}".strip(),
                            role=role
                        )
                    except Exception as e:
                        print(f"Warning: failed to push login notification: {e}")

                    return jsonify({
                        "status": "success",
                        "message": "Login successful",
                        "redirect": get_role_redirect(role),
                        "user": user_data,
                        "token": token
                    }), 200

        print(f"Login failed for: {username} - User not found or password mismatch")
        return jsonify({
            "status": "error",
            "message": "Invalid username or password"
        }), 401
    except Exception as e:
        print("Login error:", str(e))
        return jsonify({
            "status": "error",
            "message": str(e)
        }), 500

# Verify JWT token
@app.route("/api/verify-token", methods=["POST"])
def verify_token_route():
    user_data, error_response, status_code = verify_token()
    if error_response:
        return error_response, status_code
    return jsonify({"status": "success", "user": user_data}), 200

# Return the currently authenticated user's session.
@app.route("/api/session", methods=["GET"])
def get_session():
    auth_header = request.headers.get('Authorization')
    if auth_header and auth_header.startswith('Bearer '):
        user_data, error_response, status_code = verify_token()
        if not error_response:
            return jsonify({"status": "success", "user": user_data}), 200

    user = session.get("user")
    if not user:
        return jsonify({
            "status": "error",
            "message": "Session expired or user is not logged in"
        }), 401
    return jsonify({
        "status": "success",
        "user": user
    }), 200

# Clear the authenticated user's session.
@app.route("/api/logout", methods=["POST", "GET", "OPTIONS"])
def logout():
    try:
        user = session.get("user")

        # Log logout activity before clearing session
        if user:
            add_activity(
                "user_logout",
                f"{user.get('fullname', 'User')} logged out",
                {"name": user.get('fullname'), "uid": user.get('uid')},
                "system"
            )

        session.clear()

        response = jsonify({
            "status": "success",
            "message": "Logged out successfully"
        })

        response.set_cookie('tapin_session', '', expires=0)
        response.set_cookie('session', '', expires=0)

        print("User logged out successfully")
        return response, 200
    except Exception as e:
        print(f"Logout error: {str(e)}")
        return jsonify({
            "status": "error",
            "message": f"Logout failed: {str(e)}"
        }), 500

## Employee Management Routes ------------------------------------
# Register a new admin, HR, or employee account.
@app.route("/api/register-employee", methods=["POST"])
def register_employee():
    try:
        data = request.form
        required = ["employeeid", "rfid", "lastname", "firstname", "address", "bdate", "cpnumber", "email", "username", "password", "role"]
        if not data or not all(key in data for key in required):
            return jsonify({
                "status": "error",
                "message": "Missing required fields",
                "required_fields": required
            }), 400

        role = str(data.get("role", "employee")).strip().lower()
        if role not in ["admin", "hr", "employee"]:
            return jsonify({
                "status": "error",
                "message": "Role must be admin, hr, or employee"
            }), 400

        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        category = "employees" if role == "employee" else role
        image_file = request.files.get("image")
        image_path = ""

        os.makedirs(os.path.dirname(USER_DATA_FILE), exist_ok=True)

        if os.path.exists(USER_DATA_FILE):
            with open(USER_DATA_FILE, "r", encoding="utf-8") as f:
                database = json.load(f)
        else:
            database = {"admin": [], "hr": [], "employees": []}

        username = str(data.get("username", "")).strip()
        rfid = str(data.get("rfid", "")).strip().upper()

        if any(emp.get("rfid", "").strip().upper() == rfid or emp.get("username") == username
               for records in database.values() for emp in records):
            return jsonify({
                "status": "error",
                "message": "RFID or username is already registered"
            }), 409

        uid_start, uid_end = ROLE_UID_RANGES[role]
        employee_uids = [
            int(emp.get("uid"))
            for records in database.values()
            for emp in records
            if str(emp.get("uid", "")).isdigit()
        ]
        role_uids = [value for value in employee_uids if uid_start <= value <= uid_end]
        uid = str(max([uid_start - 1] + role_uids) + 1).zfill(3)

        # Process image with compression
        if image_file and image_file.filename:
            extension = os.path.splitext(image_file.filename)[1].lower()
            if extension not in [".jpg", ".jpeg", ".png", ".gif", ".webp"]:
                return jsonify({
                    "status": "error",
                    "message": "Image must be JPG, JPEG, PNG, GIF, or WEBP"
                }), 400

            # Use the compression function
            image_path = compress_and_save_image(image_file, rfid)

            if not image_path:
                # Fallback to original saving method if compression fails
                rfid_filename = secure_filename(rfid)
                os.makedirs(PROFILE_STORAGE, exist_ok=True)
                filename = rfid_filename + extension
                image_file.save(os.path.join(PROFILE_STORAGE, filename))
                image_path = os.path.join("storage", "profiles", filename).replace(os.sep, "/")

        employee = {
            "uid": uid,
            "rfid": rfid,
            "employeeid": str(data.get("employeeid", "")).strip(),
            "lastname": str(data.get("lastname", "")).strip(),
            "firstname": str(data.get("firstname", "")).strip(),
            "address": str(data.get("address", "")).strip(),
            "bdate": str(data.get("bdate", "")).strip(),
            "cpnumber": str(data.get("cpnumber", "")).strip(),
            "email": str(data.get("email", "")).strip(),
            "username": str(data.get("username", "")).strip(),
            "password_hash": hashlib.md5(str(data.get("password", "")).encode("utf-8")).hexdigest(),
            "role": role,
            "department": None,
            "position": None,
            "image": image_path,
            "timestamp_creation": now,
            "timestamp_modified": now
        }
        database.setdefault(category, []).append(employee)

        if os.path.exists(USER_DATA_FILE):
            import shutil
            shutil.copy2(USER_DATA_FILE, USER_DATA_FILE + ".backup")

        with open(USER_DATA_FILE, "w", encoding="utf-8") as f:
            json.dump(database, f, indent=4)
            f.write("\n")

        employee_database[rfid] = employee

        print("Registered:", employee["firstname"], employee["lastname"], "UID:", uid, "RFID:", rfid)

        # Log activity
        add_activity(
            "employee_registered",
            f"New {role.upper()} registered: {employee['firstname']} {employee['lastname']} (ID: {employee['employeeid']})",
            {"name": "System", "uid": "system"},
            "employee"
        )

        # Create an empty notification file for the new user, with a welcome entry.
        try:
            push_notification(
                rfid,
                "Welcome to TAPIN",
                f"Hello {employee['firstname']}, your account has been registered successfully.",
                notif_type="system",
                uid=uid,
                fullname=f"{employee['firstname']} {employee['lastname']}".strip(),
                role=role
            )
        except Exception as e:
            print(f"Warning: failed to create welcome notification: {e}")

        return jsonify({
            "status": "success",
            "message": "Employee registered successfully",
            "data": employee
        }), 200
    except Exception as e:
        return jsonify({
            "status": "error",
            "message": "Registration failed: " + str(e)
        }), 500

# Update employee data - FIXED to handle image updates
@app.route("/api/update-employee/<rfid>", methods=["PUT"])
def update_employee(rfid):
    try:
        rfid = rfid.strip().upper()
        data = request.form

        os.makedirs(os.path.dirname(USER_DATA_FILE), exist_ok=True)

        if not os.path.exists(USER_DATA_FILE):
            return jsonify({
                "status": "error",
                "message": "Database file not found"
            }), 404

        with open(USER_DATA_FILE, "r", encoding="utf-8") as f:
            database = json.load(f)

        found = False
        updated_employee = None
        category_found = None
        index_found = None

        for category in ["admin", "hr", "employees"]:
            if category in database:
                for idx, emp in enumerate(database[category]):
                    if emp.get("rfid", "").strip().upper() == rfid:
                        found = True
                        category_found = category
                        index_found = idx
                        updated_employee = emp
                        break
                if found:
                    break

        # Fallback: try to find by UID if not found by RFID
        if not found:
            for category in ["admin", "hr", "employees"]:
                if category in database:
                    for idx, emp in enumerate(database[category]):
                        if str(emp.get("uid", "")).strip() == rfid:
                            found = True
                            category_found = category
                            index_found = idx
                            updated_employee = emp
                            break
                    if found:
                        break

        if not found:
            return jsonify({
                "status": "error",
                "message": "Employee not found"
            }), 404

        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

        # Update text fields
        if "lastname" in data and data.get("lastname"):
            updated_employee["lastname"] = str(data.get("lastname", "")).strip()
        if "firstname" in data and data.get("firstname"):
            updated_employee["firstname"] = str(data.get("firstname", "")).strip()
        if "address" in data and data.get("address"):
            updated_employee["address"] = str(data.get("address", "")).strip()
        if "bdate" in data and data.get("bdate"):
            updated_employee["bdate"] = str(data.get("bdate", "")).strip()
        if "cpnumber" in data and data.get("cpnumber"):
            updated_employee["cpnumber"] = str(data.get("cpnumber", "")).strip()
        if "email" in data and data.get("email"):
            updated_employee["email"] = str(data.get("email", "")).strip()
        if "username" in data and data.get("username"):
            updated_employee["username"] = str(data.get("username", "")).strip()
        if "department" in data:
            updated_employee["department"] = str(data.get("department", "")).strip()
        if "position" in data:
            updated_employee["position"] = str(data.get("position", "")).strip()

        # Update password if provided
        if "password" in data and data.get("password"):
            updated_employee["password_hash"] = hashlib.md5(str(data.get("password", "")).encode("utf-8")).hexdigest()

        # Handle image update
        image_file = request.files.get("image")
        if image_file and image_file.filename:
            # Validate file extension
            extension = os.path.splitext(image_file.filename)[1].lower()
            if extension not in [".jpg", ".jpeg", ".png", ".gif", ".webp"]:
                return jsonify({
                    "status": "error",
                    "message": "Image must be JPG, JPEG, PNG, GIF, or WEBP"
                }), 400

            # Delete old image file if it exists
            old_image = updated_employee.get("image")
            if old_image:
                old_image_path = os.path.join(BASE_DIR, old_image)
                if os.path.exists(old_image_path):
                    try:
                        os.remove(old_image_path)
                        print(f"Deleted old image: {old_image_path}")
                    except Exception as e:
                        print(f"Error deleting old image: {e}")

            # Use the compression function for new image
            image_path = compress_and_save_image(image_file, rfid)

            if image_path:
                updated_employee["image"] = image_path
                print(f"New image saved: {image_path}")
            else:
                # Fallback to original saving method if compression fails
                rfid_filename = secure_filename(rfid)
                os.makedirs(PROFILE_STORAGE, exist_ok=True)
                filename = rfid_filename + extension
                image_file.save(os.path.join(PROFILE_STORAGE, filename))
                image_path = os.path.join("storage", "profiles", filename).replace(os.sep, "/")
                updated_employee["image"] = image_path
                print(f"New image saved (fallback): {image_path}")

        # Allow changing RFID via form data (client sends new value in 'rfid')
        new_rfid_value = None
        if "rfid" in data and data.get("rfid"):
            candidate = str(data.get("rfid", "")).strip().upper()
            if candidate and candidate != rfid:
                # ensure uniqueness across database
                collision = False
                for cat in ["admin", "hr", "employees"]:
                    if cat in database:
                        for emp in database[cat]:
                            if emp.get("rfid", "").strip().upper() == candidate:
                                collision = True
                                break
                    if collision:
                        break
                if collision:
                    return jsonify({
                        "status": "error",
                        "message": "RFID already assigned to another employee"
                    }), 400

                # update the employee object and attendance records
                updated_employee["rfid"] = candidate
                new_rfid_value = candidate
                try:
                    for rec in attendance_records:
                        if rec.get("uid") == updated_employee.get("uid"):
                            rec["rfid"] = candidate
                    # persist attendance changes
                    save_attendance_data()
                except Exception as e:
                    print(f"Warning: failed to update attendance records for RFID change: {e}")

        updated_employee["timestamp_modified"] = now

        # Update database
        database[category_found][index_found] = updated_employee

        # Create backup
        import shutil
        shutil.copy2(USER_DATA_FILE, USER_DATA_FILE + ".backup")

        # Save to file
        with open(USER_DATA_FILE, "w", encoding="utf-8") as f:
            json.dump(database, f, indent=4)
            f.write("\n")

        # Update in-memory database (handle RFID rename if requested)
        try:
            if new_rfid_value:
                # remove old key if present
                if rfid in employee_database:
                    try:
                        del employee_database[rfid]
                    except Exception:
                        pass
                employee_database[new_rfid_value] = updated_employee
            else:
                employee_database[rfid] = updated_employee
        except Exception as e:
            print(f"Warning: failed to update in-memory employee_database mapping: {e}")

        # Log activity
        add_activity(
            "employee_updated",
            f"Employee {updated_employee['firstname']} {updated_employee['lastname']} (ID: {updated_employee['employeeid']}) was updated",
            {"name": "System", "uid": "system"},
            "employee"
        )

        # Notify the employee that their profile was updated.
        try:
            push_notification(
                updated_employee.get("rfid") or rfid,
                "Profile Updated",
                "Your profile information was updated successfully.",
                notif_type="employee",
                uid=updated_employee.get("uid"),
                fullname=f"{updated_employee.get('firstname', '')} {updated_employee.get('lastname', '')}".strip(),
                role=updated_employee.get("role")
            )
        except Exception as e:
            print(f"Warning: failed to push profile-update notification: {e}")

        return jsonify({
            "status": "success",
            "message": "Employee updated successfully",
            "data": updated_employee
        }), 200

    except Exception as e:
        print(f"Update error: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({
            "status": "error",
            "message": "Update failed: " + str(e)
        }), 500

## Dashboard Routes ------------------------------------
# Return all current dashboard data in one authenticated response.
@app.route("/api/dashboard-data", methods=["GET"])
def dashboard_data():
    auth_header = request.headers.get('Authorization')
    if auth_header and auth_header.startswith('Bearer '):
        user_data, error_response, status_code = verify_token()
        if error_response:
            return error_response, status_code
    else:
        if not session.get("user"):
            return jsonify({
                "status": "error",
                "message": "Session expired or user is not logged in"
            }), 401

    return jsonify({
        "status": "success",
        "data": get_dashboard_data()
    }), 200

# Return live employee and RFID totals for the dashboard cards.
@app.route("/api/dashboard-stats", methods=["GET"])
def dashboard_stats():
    return jsonify({
        "status": "success",
        "stats": get_dashboard_statistics()
    }), 200

# Serve scan feed data
@app.route("/api/scan-feed", methods=["GET"])
def get_scan_feed():
    # Wipe all feeds once per calendar day (first request after midnight).
    perform_nightly_feed_wipe()
    scan_feed_data = load_scan_feed()
    return jsonify({
        "status": "success",
        "data": scan_feed_data
    }), 200

# Serve activity feed data for timeline
@app.route("/api/activity-feed", methods=["GET"])
def get_activity_feed():
    """Get the activity feed data for the dashboard timeline"""
    # Wipe all feeds once per calendar day (first request after midnight).
    perform_nightly_feed_wipe()
    limit = request.args.get("limit", default=50, type=int)
    activity_feed_data = load_activity_feed()
    activities = activity_feed_data.get("activities", [])

    # Return limited activities
    if limit and limit > 0:
        activities = activities[:limit]

    return jsonify({
        "status": "success",
        "data": {
            "activities": activities,
            "total_activities": activity_feed_data.get("total_activities", 0)
        }
    }), 200

# Return devices that have sent a recent ping.
@app.route("/api/get-device-status", methods=["GET"])
def get_device_status():
    return jsonify({
        "status": "success",
        "devices": get_online_devices()
    }), 200

# Check whether one device is currently online.
@app.route("/api/check-device/<device_id>", methods=["GET"])
def check_device(device_id):
    remove_offline_devices()
    data = device_status.get(device_id)
    if not data:
        return jsonify({
            "status": "unknown",
            "message": "Device not found"
        }), 404
    return jsonify({
        "status": "success",
        "device_id": device_id,
        "device_status": data["status"],
        "last_seen": data["last_seen"]
    }), 200

# Return persistent DTR records for a requested month.
@app.route("/api/attendance", methods=["GET"])
def get_attendance():
    auth_header = request.headers.get('Authorization')
    if auth_header and auth_header.startswith('Bearer '):
        user_data, error_response, status_code = verify_token()
        if error_response:
            return error_response, status_code
    else:
        if not session.get("user"):
            return jsonify({
                "status": "error",
                "message": "Session expired or user is not logged in"
            }), 401

    month = request.args.get("month", datetime.now().strftime("%Y-%m"))
    records = [record for record in attendance_records if record.get("month") == month]
    return jsonify({
        "status": "success",
        "month": month,
        "records": records
    }), 200

# Return the latest RFID scan and online devices for the web dashboard.
@app.route("/api/get-latest-rfid", methods=["GET"])
def get_latest_rfid():
    """Get the latest RFID scan with full attendance data for the employee"""
    # Wipe all feeds once per calendar day (first request after midnight).
    perform_nightly_feed_wipe()
    rfid = latest_scan.get("rfid")
    scanned_at = latest_scan.get("scanned_at")
    employee = employee_database.get(rfid) if rfid else None

    employee_data = None
    attendance_data = None

    if employee:
        # Build employee data with full image URL
        stored_image = employee.get("image", "")
        image_url = ""

        if stored_image:
            if stored_image.startswith("http"):
                image_url = stored_image
            else:
                image_url = f"{request.host_url}{stored_image}"
        else:
            rfid_filename = employee.get("rfid", "")
            if rfid_filename:
                image_extensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp']
                for ext in image_extensions:
                    image_path = os.path.join(PROFILE_STORAGE, rfid_filename + ext)
                    if os.path.exists(image_path):
                        image_url = f"{request.host_url}storage/profiles/{rfid_filename}{ext}"
                        break

        employee_data = {
            "uid": employee.get("uid"),
            "rfid": employee.get("rfid"),
            "employeeid": employee.get("employeeid"),
            "lastname": employee.get("lastname"),
            "firstname": employee.get("firstname"),
            "role": employee.get("role"),
            "image": image_url
        }

        # Get today's attendance data - ALWAYS try to get or create record
        today = datetime.now()
        today_str = today.strftime("%Y-%m-%d")
        month_key = today.strftime("%Y-%m")

        # Try to find existing record
        for record in attendance_records:
            if record.get("uid") == employee.get("uid") and record.get("month") == month_key:
                for key, day in record.get("dtr", {}).items():
                    if day.get("date") == today_str:
                        attendance_data = {
                            "am_in": day.get("am_in", ""),
                            "am_out": day.get("am_out", ""),
                            "pm_in": day.get("pm_in", ""),
                            "pm_out": day.get("pm_out", ""),
                            "status": day.get("status", "")
                        }
                        break
                break

        # If no record found, create one and return empty data
        if attendance_data is None:
            # Create a new attendance record for this employee
            record = get_attendance_record(employee, today)
            # Get the newly created record's data
            for key, day in record.get("dtr", {}).items():
                if day.get("date") == today_str:
                    attendance_data = {
                        "am_in": "",
                        "am_out": "",
                        "pm_in": "",
                        "pm_out": "",
                        "status": ""
                    }
                    break
            # Save the new record
            save_attendance_data()
            print(f"Created new attendance record for {employee.get('firstname')} for today")

    # If no employee found, still return a valid response
    if not employee_data and not attendance_data:
        return jsonify({
            "status": "success",
            "rfid": rfid,
            "scanned_at": scanned_at,
            "devices": get_online_devices(),
            "found": False,
            "employee": None,
            "attendance": None
        }), 200

    return jsonify({
        "status": "success",
        "rfid": rfid,
        "scanned_at": scanned_at,
        "devices": get_online_devices(),
        "found": bool(employee),
        "employee": employee_data,
        "attendance": attendance_data
    }), 200

# Reload users.json into the in-memory RFID lookup database.
@app.route("/api/reload-db", methods=["POST"])
def reload_db():
    global employee_database
    employee_database = load_employee_database()
    initialize_attendance_records()

    # Log activity
    add_activity(
        "database_reloaded",
        "Employee database was reloaded from storage",
        {"name": "System", "uid": "system"},
        "system"
    )

    return jsonify({
        "status": "success",
        "message": "Database reloaded",
        "total": len(employee_database)
    }), 200

## IoT Routes ------------------------------------
# Receive a heartbeat ping from an RFID device.
@app.route("/api/device-ping", methods=["POST"])
def device_ping():
    try:
        data = request.get_json()
        if not data or not data.get("device_id"):
            return jsonify({
                "status": "error",
                "message": "Missing required field: device_id"
            }), 400
        device_id = str(data["device_id"]).strip()
        status = data.get("status", "alive")
        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        device_status[device_id] = {
            "status": status,
            "last_seen": now,
            "last_seen_at": datetime.now()
        }
        print("Ping received from", device_id, "Last seen:", now)
        return jsonify({
            "status": "success",
            "message": "Ping recorded",
            "device_id": device_id,
            "last_seen": now
        }), 200
    except Exception as e:
        return jsonify({
            "status": "error",
            "message": str(e)
        }), 500

## Receive an RFID scan and match it to a user record - RETURNS PLAIN TEXT FOR ESP32
@app.route("/api/receive-rfid", methods=["POST"])
def receive_rfid():
    try:
        print(f"RFID receive request received")
        print(f"Content-Type: {request.headers.get('Content-Type')}")

        # Wipe all feeds once per calendar day (first request after midnight).
        perform_nightly_feed_wipe()

        # Get raw data for debugging
        raw_data = request.get_data()
        print(f"Raw data: {raw_data}")

        # Try to parse JSON
        data = request.get_json()
        if not data:
            print("ERROR: Invalid JSON or missing data")
            return "ERROR: Invalid JSON or missing data", 400

        if "rfid" not in data or "scanned_at" not in data:
            print("ERROR: Missing required fields: rfid and scanned_at")
            return "ERROR: Missing required fields: rfid and scanned_at", 400

        rfid = str(data["rfid"]).strip().upper()
        scanned_at = str(data["scanned_at"])

        print(f"Processing RFID: {rfid} at {scanned_at}")

        # Update latest scan
        latest_scan["rfid"] = rfid
        latest_scan["scanned_at"] = scanned_at

        # Check if employee exists
        employee = employee_database.get(rfid)
        found = bool(employee)

        # Do NOT call add_scan_to_feed here — record_attendance_scan will do it
        # with the correct scan_type (am_in / am_out / pm_in / pm_out) once the
        # in/out state machine runs below.

        # Add to scan events (raw data for statistics)
        scan_event = {
            "rfid": rfid,
            "scanned_at": scanned_at,
            "scanned_on": datetime.now().date().isoformat()
        }
        scan_events.append(scan_event)
        # Save scan events
        scan_events_data = {"scan_events": scan_events[-10000:]}
        save_scan_events(scan_events_data)

        # Process attendance if employee found
        if employee:
            print(f"RFID matched: {employee['firstname']} {employee['lastname']}")
            record, result = record_attendance_scan(employee, scanned_at)
            print(f"Attendance record result: {result}")
            # Save attendance data (ONLY records, no scan events)
            save_attendance_data()
            # Return simple OK with scan result
            return f"OK: {result}", 200
        else:
            print(f"RFID not found in database: {rfid}")
            # Log unknown RFID scan
            add_activity(
                "unknown_rfid_scanned",
                f"Unknown RFID card scanned: {rfid}",
                None,
                "system"
            )
            return "ERROR: RFID not found", 404

    except Exception as e:
        print(f"Error in receive_rfid: {str(e)}")
        import traceback
        traceback.print_exc()
        return f"ERROR: {str(e)}", 500

## Error Handlers ------------------------------------
@app.errorhandler(404)
def page_not_found(e):
    return jsonify({
        "status": "error",
        "message": "Invalid request",
        "timestamp": datetime.now().isoformat()
    }), 404

## OPTIONS Handlers ------------------------------------
@app.route("/api/login", methods=["OPTIONS"])
@app.route("/api/session", methods=["OPTIONS"])
@app.route("/api/logout", methods=["OPTIONS"])
@app.route("/api/dashboard-data", methods=["OPTIONS"])
@app.route("/api/verify-token", methods=["OPTIONS"])
@app.route("/api/register-employee", methods=["OPTIONS"])
@app.route("/api/update-employee/<rfid>", methods=["OPTIONS"])
@app.route("/api/receive-rfid", methods=["OPTIONS"])
@app.route("/api/device-ping", methods=["OPTIONS"])
@app.route("/api/scan-feed", methods=["OPTIONS"])
@app.route("/api/activity-feed", methods=["OPTIONS"])
@app.route("/api/request-leave", methods=["OPTIONS"])
@app.route("/api/leave-requests", methods=["OPTIONS"])
@app.route("/api/approve-leave/<request_id>", methods=["OPTIONS"])
@app.route("/api/reject-leave/<request_id>", methods=["OPTIONS"])
@app.route("/api/dtr/employees", methods=["OPTIONS"])
@app.route("/api/dtr/record/<rfid>", methods=["OPTIONS"])
@app.route("/api/dtr/generate-pdf/<rfid>", methods=["OPTIONS"])
@app.route("/api/dtr/months", methods=["OPTIONS"])
@app.route("/api/settings", methods=["OPTIONS"])
@app.route("/api/settings/check-version", methods=["OPTIONS"])
@app.route("/api/settings/reset", methods=["OPTIONS"])
@app.route("/api/notifications/<rfid>", methods=["OPTIONS"])
@app.route("/api/notifications/<rfid>/clear", methods=["OPTIONS"])
@app.route("/api/notifications/<rfid>/read-all", methods=["OPTIONS"])
@app.route("/api/notifications/<rfid>/<notification_id>", methods=["OPTIONS"])
def handle_options():
    response = jsonify({"status": "ok"})
    origin = request.headers.get("Origin")
    if origin:
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Access-Control-Allow-Credentials"] = "true"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type, Cookie, Set-Cookie, Authorization, X-Requested-With"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS, PUT, DELETE, PATCH"
    return response, 200

# ============================================================================
# FACE RECOGNITION OPTIONS HANDLERS
# ============================================================================
# Add OPTIONS handlers for facial recognition routes
@app.route("/facialrecognition/api/status", methods=["OPTIONS"])
@app.route("/facialrecognition/api/employees", methods=["OPTIONS"])
@app.route("/facialrecognition/api/verify-and-record", methods=["OPTIONS"])
@app.route("/facialrecognition/api/check-face", methods=["OPTIONS"])
@app.route("/facialrecognition/api/recent-attendance", methods=["OPTIONS"])
@app.route("/facialrecognition/api/dashboard-stats", methods=["OPTIONS"])
@app.route("/facialrecognition/api/scan-log", methods=["OPTIONS"])
def handle_scanner_options():
    response = jsonify({"status": "ok"})
    origin = request.headers.get("Origin")
    if origin:
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Access-Control-Allow-Credentials"] = "true"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type, Cookie, Set-Cookie, Authorization, X-Requested-With"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS, PUT, DELETE, PATCH"
    return response, 200

## Main ------------------------------------
if __name__ == "__main__":
    initialize_attendance_records()

    # Get port from environment variable (Railway sets PORT)
    # If PORT env var is set (e.g., on Railway), use it directly.
    # Otherwise, find a free port starting from 5000 for local development.
    env_port = os.environ.get("PORT")

    if env_port:
        # Production / Railway: use the provided port
        port = int(env_port)
    else:
        # Local development: check if 5000 is free, otherwise find the next available port
        if is_port_in_use(5000):
            print(f"⚠️  Port 5000 is already in use. Searching for a free port...")
            port = find_free_port(start_port=5001, max_attempts=20)
            if port is None:
                print("❌ ERROR: Could not find any free port between 5001 and 5020.")
                print("   Please stop the process using port 5000, or set the PORT environment variable.")
                raise SystemExit(1)
            print(f"✅ Found free port: {port}")
        else:
            port = 5000

    # Print environment info
    print(f"\n{'='*60}")
    print(f"🚀 Starting TapIn API Server")
    print(f"📍 Environment: {'Production' if is_production() else 'Development'}")
    print(f"🔗 Base URL: {get_base_url()}")
    print(f"📁 Storage: {BASE_DIR}/storage")
    print(f"🌐 Port: {port}")
    print(f"{'='*60}\n")

    # For production, use HTTPS secure settings
    if is_production():
        app.run(host='0.0.0.0', port=port, debug=False)
    else:
        # For development, run with debug enabled
        app.run(host='0.0.0.0', port=port, debug=True)