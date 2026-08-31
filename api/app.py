## Imports
import os
import json
import hashlib
import calendar
import jwt
import secrets

from flask import Flask, jsonify, request, session, send_from_directory, send_file
from werkzeug.utils import secure_filename
from datetime import datetime, timedelta

## Variables ------------------------------------
# Create the Flask application.
app = Flask(__name__)
app.secret_key = os.environ.get("FLASK_SECRET_KEY", "tapin-development-secret-key")
app.permanent_session_lifetime = timedelta(hours=3)

# JWT Configuration
JWT_SECRET = os.environ.get("JWT_SECRET", secrets.token_urlsafe(32))
JWT_EXPIRATION = timedelta(hours=3)

# Update session cookie settings for better compatibility
app.config.update(
    SESSION_COOKIE_SAMESITE='None',
    SESSION_COOKIE_SECURE=False,
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_PATH='/',
    SESSION_COOKIE_DOMAIN=None,
    SESSION_COOKIE_NAME='tapin_session'
)

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

# Profile images storage
PROFILE_STORAGE = os.path.join(BASE_DIR, "storage", "profiles")

# Scan feed storage - keeps detailed logs of all scans
SCAN_FEED_FILE = os.path.join(BASE_DIR, "storage", "feed", "scan_feed.json")

# Scan events storage - keeps raw scan events (moved to feed)
SCAN_EVENTS_FILE = os.path.join(BASE_DIR, "storage", "feed", "scan_events.json")

# Leave requests storage (moved to feed)
LEAVE_DATA_FILE = os.path.join(BASE_DIR, "storage", "feed", "leaves.json")

# Ensure directories exist
os.makedirs(os.path.dirname(USER_DATA_FILE), exist_ok=True)
os.makedirs(os.path.dirname(ATTENDANCE_DATA_FILE), exist_ok=True)
os.makedirs(os.path.dirname(PROFILE_STORAGE), exist_ok=True)
os.makedirs(os.path.dirname(SCAN_FEED_FILE), exist_ok=True)
os.makedirs(os.path.dirname(SCAN_EVENTS_FILE), exist_ok=True)
os.makedirs(os.path.dirname(LEAVE_DATA_FILE), exist_ok=True)

# Debug: Print paths to verify
print(f"BASE_DIR: {BASE_DIR}")
print(f"USER_DATA_FILE: {USER_DATA_FILE}")
print(f"ATTENDANCE_DATA_FILE: {ATTENDANCE_DATA_FILE}")
print(f"PROFILE_STORAGE: {PROFILE_STORAGE}")
print(f"SCAN_FEED_FILE: {SCAN_FEED_FILE}")
print(f"SCAN_EVENTS_FILE: {SCAN_EVENTS_FILE}")
print(f"LEAVE_DATA_FILE: {LEAVE_DATA_FILE}")

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

## Functions ------------------------------------
# Load leave data
def load_leave_data():
    if not os.path.exists(LEAVE_DATA_FILE):
        default_data = {"requests": [], "approved": [], "rejected": []}
        with open(LEAVE_DATA_FILE, "w", encoding="utf-8") as f:
            json.dump(default_data, f, indent=4)
            f.write("\n")
        print(f"Created new leave file: {LEAVE_DATA_FILE}")
        return default_data
    
    try:
        with open(LEAVE_DATA_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
            if "requests" not in data:
                data["requests"] = []
            if "approved" not in data:
                data["approved"] = []
            if "rejected" not in data:
                data["rejected"] = []
            return data
    except (OSError, ValueError, json.JSONDecodeError) as e:
        print(f"Error reading leave file: {e}")
        return {"requests": [], "approved": [], "rejected": []}

# Save leave data
def save_leave_data(leave_data):
    os.makedirs(os.path.dirname(LEAVE_DATA_FILE), exist_ok=True)
    with open(LEAVE_DATA_FILE, "w", encoding="utf-8") as f:
        json.dump(leave_data, f, indent=4)
        f.write("\n")
    print(f"Leave data saved to {LEAVE_DATA_FILE}")

# Load leave data
leave_data = load_leave_data()

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
    """Add a single scan to the feed with proper formatting"""
    scan_feed_data = load_scan_feed()
    
    scan_date = datetime.now().date().isoformat()
    
    last_cleanup = datetime.fromisoformat(scan_feed_data.get("last_cleanup", datetime.now().isoformat()))
    days_since_cleanup = (datetime.now() - last_cleanup).days
    
    if days_since_cleanup >= 7:
        scan_feed_data["scans"] = []
        scan_feed_data["last_cleanup"] = datetime.now().isoformat()
        scan_feed_data["total_scans"] = 0
        print("Weekly scan feed cleanup performed")
    
    scan_entry = {
        "rfid": rfid,
        "scanned_at": scanned_at,
        "scanned_on": scan_date,
        "found": found,
        "scan_type": scan_type,
        "timestamp": datetime.now().isoformat()
    }
    
    if employee:
        scan_entry["employee"] = {
            "uid": employee.get("uid"),
            "employeeid": employee.get("employeeid"),
            "firstname": employee.get("firstname"),
            "lastname": employee.get("lastname"),
            "role": employee.get("role")
        }
    else:
        scan_entry["employee"] = None
    
    scan_feed_data["scans"].insert(0, scan_entry)
    
    if len(scan_feed_data["scans"]) > 1000:
        scan_feed_data["scans"] = scan_feed_data["scans"][:1000]
    
    scan_feed_data["total_scans"] = len(scan_feed_data["scans"])
    
    save_scan_feed(scan_feed_data)
    
    return scan_entry

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
                    time_diff = (scan_time - last_scan_time).total_seconds() / 3600
                    if time_diff >= 1.0:
                        return ("am", "out")
                    else:
                        print(f"AM cooldown not met for {rfid} - {time_diff:.2f} hours")
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
                if rfid in last_scan_tracking:
                    last_scan_data = last_scan_tracking[rfid]
                    last_scan_time = last_scan_data.get("last_scan_time")
                    last_scan_type = last_scan_data.get("last_scan_type")
                    if last_scan_type == "in":
                        time_diff = (scan_time - last_scan_time).total_seconds() / 3600
                        if time_diff >= 1.0:
                            print(f"Late AM time out for {rfid} at {scan_time.strftime('%H:%M:%S')}")
                            return ("am", "out")
                        else:
                            print(f"AM cooldown not met for {rfid} - {time_diff:.2f} hours")
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
                    time_diff = (scan_time - last_scan_time).total_seconds() / 3600
                    if time_diff >= 1.0:
                        return ("pm", "out")
                    else:
                        print(f"PM cooldown not met for {rfid} - {time_diff:.2f} hours")
                        return None
        
        if pm_complete:
            print(f"PM already complete for {rfid}")
            return None
    
    if not has_time_in_for_period(day_data, period):
        return (period, "in")
    else:
        return None

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
    
    time_value = scan_time.strftime("%H:%M:%S")
    
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
        else:
            print(f"{period.upper()} TIME OUT already exists for {rfid}")
            return record, "already_exists"
    
    # Calculate hours after each update
    am_hours = calculate_hours(day_data.get("am_in", ""), day_data.get("am_out", ""))
    pm_hours = calculate_hours(day_data.get("pm_in", ""), day_data.get("pm_out", ""))
    total_hours = am_hours + pm_hours
    day_data["hours"] = f"{total_hours:.2f}"
    day_data["ut"] = f"{max(0, 8 - total_hours):.2f}"
    day_data["ot"] = f"{max(0, total_hours - 8):.2f}"
    
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
def calculate_hours(start_time, end_time):
    if not start_time or not end_time:
        return 0
    try:
        start = datetime.strptime(start_time, "%H:%M:%S")
        end = datetime.strptime(end_time, "%H:%M:%S")
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
                if rfid:
                    emp["role"] = "employee" if category == "employees" else category
                    db[rfid] = emp
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
    employee_rfids = {
        emp.get("rfid", "").strip().upper()
        for emp in employee_database.values()
        if emp.get("role") == "employee"
    }
    present_rfids = {
        event["rfid"] for event in today_events
        if event.get("rfid") in employee_rfids
    }
    total_employees = len(employee_rfids)
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
    return {
        "stats": get_dashboard_statistics(),
        "users": users,
        "attendance": attendance_records,
        "scans": recent_scans,
        "devices": get_online_devices(),
        "latest_scan": recent_scans[0] if recent_scans else None,
        "leaves": leave_data
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
        
        if not employee:
            return jsonify({"status": "error", "message": "Employee not found"}), 404
        
        request_id = str(len(leave_data["requests"]) + 1).zfill(3)
        
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
        
        leave_data["requests"].append(leave_request)
        save_leave_data(leave_data)
        
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
    
    return jsonify({
        "status": "success",
        "data": leave_data
    }), 200

# Get leave requests for a specific employee
@app.route("/api/leave-requests/<rfid>", methods=["GET"])
def get_employee_leave_requests(rfid):
    rfid = rfid.strip().upper()
    
    if rfid not in employee_database:
        return jsonify({"status": "error", "message": "Employee not found"}), 404
    
    employee_requests = [
        req for req in leave_data["requests"] if req.get("rfid") == rfid
    ]
    employee_approved = [
        req for req in leave_data["approved"] if req.get("rfid") == rfid
    ]
    employee_rejected = [
        req for req in leave_data["rejected"] if req.get("rfid") == rfid
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
        
        save_leave_data(leave_data)
        save_attendance_data()
        
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
        
        save_leave_data(leave_data)
        
        return jsonify({
            "status": "success",
            "message": "Leave request rejected",
            "data": request_to_reject
        }), 200
        
    except Exception as e:
        print(f"Reject leave error: {str(e)}")
        return jsonify({"status": "error", "message": str(e)}), 500

## Web Routes ------------------------------------
# Add CORS and no-cache headers to API responses.
@app.after_request
def add_cors_headers(response):
    origin = request.headers.get("Origin")
    if origin:
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Access-Control-Allow-Credentials"] = "true"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type, Cookie, Set-Cookie, Authorization"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS, PUT, DELETE"
    if request.path.startswith("/api/"):
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

        if image_file and image_file.filename:
            extension = os.path.splitext(image_file.filename)[1].lower()
            if extension not in [".jpg", ".jpeg", ".png", ".gif", ".webp"]:
                return jsonify({
                    "status": "error",
                    "message": "Image must be JPG, JPEG, PNG, GIF, or WEBP"
                }), 400
            
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

# Update employee data
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
        
        if not found:
            return jsonify({
                "status": "error",
                "message": "Employee not found"
            }), 404
        
        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        
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
        
        if "password" in data and data.get("password"):
            updated_employee["password_hash"] = hashlib.md5(str(data.get("password", "")).encode("utf-8")).hexdigest()
        
        image_file = request.files.get("image")
        if image_file and image_file.filename:
            extension = os.path.splitext(image_file.filename)[1].lower()
            if extension not in [".jpg", ".jpeg", ".png", ".gif", ".webp"]:
                return jsonify({
                    "status": "error",
                    "message": "Image must be JPG, JPEG, PNG, GIF, or WEBP"
                }), 400
            
            old_image = updated_employee.get("image")
            if old_image:
                old_image_path = os.path.join(BASE_DIR, old_image)
                if os.path.exists(old_image_path):
                    try:
                        os.remove(old_image_path)
                    except:
                        pass
            
            rfid_filename = secure_filename(rfid)
            os.makedirs(PROFILE_STORAGE, exist_ok=True)
            filename = rfid_filename + extension
            image_file.save(os.path.join(PROFILE_STORAGE, filename))
            updated_employee["image"] = os.path.join("storage", "profiles", filename).replace(os.sep, "/")
        
        updated_employee["timestamp_modified"] = now
        
        database[category_found][index_found] = updated_employee
        
        import shutil
        shutil.copy2(USER_DATA_FILE, USER_DATA_FILE + ".backup")
        
        with open(USER_DATA_FILE, "w", encoding="utf-8") as f:
            json.dump(database, f, indent=4)
            f.write("\n")
        
        employee_database[rfid] = updated_employee
        
        return jsonify({
            "status": "success",
            "message": "Employee updated successfully",
            "data": updated_employee
        }), 200
        
    except Exception as e:
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
    scan_feed_data = load_scan_feed()
    return jsonify({
        "status": "success",
        "data": scan_feed_data
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
        print(f"Raw data: {request.get_data()}")
        
        data = request.get_json()
        if not data:
            return "ERROR: Invalid JSON or missing data", 400
            
        if "rfid" not in data or "scanned_at" not in data:
            return "ERROR: Missing required fields: rfid and scanned_at", 400

        rfid = str(data["rfid"]).strip().upper()
        scanned_at = str(data["scanned_at"])

        print(f"Processing RFID: {rfid} at {scanned_at}")

        latest_scan["rfid"] = rfid
        latest_scan["scanned_at"] = scanned_at
        
        employee = employee_database.get(rfid)
        found = bool(employee)
        
        # Add to scan feed (detailed log for display)
        add_scan_to_feed(rfid, scanned_at, employee, found)
        
        # Add to scan events (raw data for statistics)
        scan_event = {
            "rfid": rfid,
            "scanned_at": scanned_at,
            "scanned_on": datetime.now().date().isoformat()
        }
        scan_events.append(scan_event)
        # Save scan events separately
        scan_events_data = {"scan_events": scan_events[-10000:]}
        save_scan_events(scan_events_data)

        scan_result = "not_found"
        if employee:
            print(f"RFID matched: {employee['firstname']} {employee['lastname']}")
            record, result = record_attendance_scan(employee, scanned_at)
            scan_result = result
            print(f"Attendance record result: {result}")
            # Save attendance data (ONLY records, no scan events)
            save_attendance_data()
            # Return simple OK with scan result
            return f"OK: {scan_result}", 200
        else:
            print(f"RFID not found in database: {rfid}")
            return "ERROR: RFID not found", 404

    except Exception as e:
        print(f"Error in receive_rfid: {str(e)}")
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
@app.route("/api/request-leave", methods=["OPTIONS"])
@app.route("/api/leave-requests", methods=["OPTIONS"])
@app.route("/api/approve-leave/<request_id>", methods=["OPTIONS"])
@app.route("/api/reject-leave/<request_id>", methods=["OPTIONS"])
def handle_options():
    response = jsonify({"status": "ok"})
    origin = request.headers.get("Origin")
    if origin:
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Access-Control-Allow-Credentials"] = "true"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type, Cookie, Set-Cookie, Authorization"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS, PUT, DELETE"
    return response, 200

## Main ------------------------------------
if __name__ == "__main__":
    initialize_attendance_records()
    # Get port from environment variable (Railway sets PORT)
    port = int(os.environ.get("PORT", 5000))
    app.run(host='0.0.0.0', port=port, debug=True)