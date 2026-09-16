"""
TapIn Face Scanner Module.

This module handles:
1. Face detection from browser camera
2. Face recognition by comparing with saved .tfs files
3. Finding the matching employee and their RFID
4. Recording attendance via RFID verification
5. Logging all face detections

Architecture:
    Browser camera -> face-api.js -> local CPU/GPU recognition
                       |
                       v
            Load .tfs files from storage/samples/
                       |
                       v
                Compare face with saved data
                       |
                       v
            Find matching employee + RFID
                       |
                       v
                Flask verification API
                       |
                       v
             Record attendance with RFID
"""

import json
import os
import shutil
import pickle
from datetime import datetime

from flask import Blueprint, jsonify, request, send_from_directory

facescanner_bp = Blueprint(
    "facialrecognition",
    __name__,
    url_prefix="/facialrecognition",
)

# Get base directory from the main app
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STORAGE_DIR = os.path.join(BASE_DIR, "storage")
DATABASE_DIR = os.path.join(STORAGE_DIR, "database")
SAMPLES_DIR = os.path.join(STORAGE_DIR, "samples")
LOG_DIR = os.path.join(STORAGE_DIR, "logs")
FACE_DATA_FILE = os.path.join(DATABASE_DIR, "face_embeddings.json")
SCAN_LOG_FILE = os.path.join(LOG_DIR, "face_scans.json")

MIN_CONFIDENCE = float(os.environ.get("FACE_MIN_CONFIDENCE", "70.0"))
ATTENDANCE_COOLDOWN = int(os.environ.get("FACE_ATTENDANCE_COOLDOWN", "10"))  # seconds


def _ensure_directories():
    """Ensure all required directories exist."""
    os.makedirs(DATABASE_DIR, exist_ok=True)
    os.makedirs(SAMPLES_DIR, exist_ok=True)
    os.makedirs(LOG_DIR, exist_ok=True)
    if not os.path.exists(FACE_DATA_FILE):
        with open(FACE_DATA_FILE, "w", encoding="utf-8") as f:
            json.dump({"version": 1, "employees": {}}, f, indent=2)


def _load_face_data():
    """Load face embeddings data from file."""
    _ensure_directories()
    try:
        with open(FACE_DATA_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
            if not isinstance(data, dict):
                raise ValueError("face_embeddings.json must contain an object")
            data.setdefault("version", 1)
            data.setdefault("employees", {})
            return data
    except Exception as e:
        print(f"⚠️ Error loading face data: {e}")
        return {"version": 1, "employees": {}}


def _load_tfs_file(rfid):
    """Load face descriptors from .tfs file."""
    filename = f"{rfid}.tfs"
    filepath = os.path.join(SAMPLES_DIR, filename)
    
    if not os.path.exists(filepath):
        return None
    
    try:
        with open(filepath, "rb") as f:
            data = pickle.load(f)
        return data
    except Exception as e:
        print(f"⚠️ Error loading .tfs file {filename}: {e}")
        return None


def _list_tfs_files():
    """List all .tfs files in storage/samples/"""
    _ensure_directories()
    tfs_files = []
    for filename in os.listdir(SAMPLES_DIR):
        if filename.endswith(".tfs"):
            tfs_files.append(filename)
    return tfs_files


def _load_all_tfs_data():
    """Load all .tfs files and return combined data."""
    _ensure_directories()
    all_data = {}
    for filename in os.listdir(SAMPLES_DIR):
        if filename.endswith(".tfs"):
            rfid = filename.replace(".tfs", "")
            data = _load_tfs_file(rfid)
            if data:
                all_data[rfid] = data
    return all_data


def _log_face_scan(rfid, employee, confidence, status, scan_type="face_detection"):
    """Log face detection/recognition events to scan log."""
    _ensure_directories()
    
    log_entry = {
        "timestamp": datetime.now().isoformat(timespec="seconds"),
        "rfid": rfid,
        "employee": {
            "uid": employee.get("uid", "") if employee else "",
            "employeeid": employee.get("employeeid", "") if employee else "",
            "firstname": employee.get("firstname", "") if employee else "",
            "lastname": employee.get("lastname", "") if employee else "",
        } if employee else None,
        "confidence": confidence,
        "status": status,
        "scan_type": scan_type,
    }
    
    # Load existing log
    log_data = []
    if os.path.exists(SCAN_LOG_FILE):
        try:
            with open(SCAN_LOG_FILE, "r", encoding="utf-8") as f:
                log_data = json.load(f)
                if not isinstance(log_data, list):
                    log_data = []
        except:
            log_data = []
    
    # Add new entry and keep last 1000
    log_data.insert(0, log_entry)
    if len(log_data) > 1000:
        log_data = log_data[:1000]
    
    # Save log
    with open(SCAN_LOG_FILE, "w", encoding="utf-8") as f:
        json.dump(log_data, f, indent=2)
    
    print(f"📝 Face scan logged: {rfid} - {status} - {confidence:.1f}%")
    return log_entry


def _get_employee_by_rfid(rfid):
    """Get employee from the existing API's employee database by RFID."""
    try:
        from app import employee_database
        return employee_database.get(rfid.strip().upper())
    except Exception as e:
        print(f"⚠️ Error getting employee by RFID: {e}")
    return None


def _get_employee_by_uid(uid):
    """Get employee from the existing API's employee database by UID."""
    try:
        from app import employee_database
        uid = str(uid).strip()
        for rfid, emp in employee_database.items():
            if str(emp.get("uid", "")).strip() == uid:
                return emp
    except Exception as e:
        print(f"⚠️ Error getting employee by UID: {e}")
    return None


def _get_all_employees():
    """Get all employees from the existing API's employee database."""
    try:
        from app import employee_database
        return list(employee_database.values())
    except Exception as e:
        print(f"⚠️ Error getting all employees: {e}")
        return []


def _employee_public(employee):
    """Return a public-safe version of employee data."""
    if not employee:
        return None
    return {
        "uid": employee.get("uid", ""),
        "rfid": employee.get("rfid", ""),
        "employeeid": employee.get("employeeid", ""),
        "firstname": employee.get("firstname", ""),
        "lastname": employee.get("lastname", ""),
        "name": f"{employee.get('firstname', '')} {employee.get('lastname', '')}".strip(),
        "role": employee.get("role", "employee"),
        "department": employee.get("department", ""),
        "position": employee.get("position", ""),
        "image": employee.get("image", ""),
    }


@facescanner_bp.get("/")
def facescanner_page():
    """Serve the face scanner page."""
    return send_from_directory(
        os.path.join(os.path.dirname(__file__)),
        "index.html"
    )


@facescanner_bp.get("/app.js")
def facescanner_js():
    """Serve the JavaScript file."""
    return send_from_directory(
        os.path.join(os.path.dirname(__file__)),
        "app.js"
    )


@facescanner_bp.get("/styles.css")
def facescanner_css():
    """Serve the CSS file."""
    return send_from_directory(
        os.path.join(os.path.dirname(__file__)),
        "styles.css"
    )


@facescanner_bp.get("/api/status")
def scanner_status():
    """Get the status of the face scanner service."""
    tfs_files = _list_tfs_files()
    return jsonify({
        "status": "success",
        "service": "face-scanner",
        "tfs_files_found": len(tfs_files),
        "tfs_files": tfs_files,
        "min_confidence": MIN_CONFIDENCE,
        "attendance_cooldown": ATTENDANCE_COOLDOWN,
    })


@facescanner_bp.get("/api/employees")
def scanner_employees():
    """
    Return all employees with their face data from .tfs files.
    """
    tfs_data = _load_all_tfs_data()
    all_employees = _get_all_employees()
    
    result = []
    for rfid, data in tfs_data.items():
        employee = _get_employee_by_rfid(rfid)
        if not employee:
            # Try to create employee from .tfs data
            employee = {
                "rfid": rfid,
                "uid": data.get("uid", ""),
                "employeeid": data.get("employeeid", ""),
                "firstname": data.get("firstname", ""),
                "lastname": data.get("lastname", ""),
                "role": "employee",
            }
        
        result.append({
            "employee": _employee_public(employee),
            "rfid": rfid,
            "descriptors": data.get("descriptors", []),
            "samples": data.get("samples", 0),
            "created_at": data.get("created_at", ""),
            "updated_at": data.get("updated_at", ""),
        })

    return jsonify({
        "status": "success",
        "count": len(result),
        "employees": result,
        "tfs_files": _list_tfs_files(),
    })


@facescanner_bp.post("/api/verify-rfid")
def verify_rfid():
    """
    Verify if an RFID exists in the system.
    Used when employee taps their RFID card.
    """
    body = request.get_json(silent=True) or {}
    rfid = str(body.get("rfid", "")).strip().upper()
    scanned_at = str(body.get("scanned_at", "")).strip()

    if not rfid:
        return jsonify({
            "status": "error",
            "message": "Missing RFID"
        }), 400

    employee = _get_employee_by_rfid(rfid)
    if not employee:
        _log_face_scan(rfid, None, 0, "rfid_not_found", "rfid_verification")
        return jsonify({
            "status": "not_found",
            "message": "RFID not found in system",
            "rfid": rfid,
        }), 404

    # Check if .tfs file exists
    tfs_data = _load_tfs_file(rfid)
    has_face = tfs_data is not None

    # Log the RFID verification
    _log_face_scan(rfid, employee, 100, "rfid_verified", "rfid_verification")

    return jsonify({
        "status": "success",
        "message": "RFID verified" + (" - face registered" if has_face else " - no face registered"),
        "rfid": rfid,
        "employee": _employee_public(employee),
        "has_face": has_face,
        "samples": tfs_data.get("samples", 0) if has_face else 0,
    }), 200


@facescanner_bp.post("/api/verify-and-record")
def verify_and_record():
    """
    Verify the browser's face recognition result and record attendance.
    
    The browser sends:
    - uid: Employee UID
    - rfid: Employee RFID (matched from face data)
    - confidence: Recognition confidence (0-100)
    - scanned_at: Timestamp
    
    This endpoint:
    1. Verifies the employee exists
    2. Checks confidence is above threshold
    3. Records attendance using the employee's RFID
    4. Logs the face scan
    5. Returns success/failure
    """
    body = request.get_json(silent=True) or {}

    uid = str(body.get("uid", "")).strip()
    rfid = str(body.get("rfid", "")).strip().upper()
    confidence_raw = body.get("confidence", 0)
    scanned_at = str(body.get("scanned_at", "")).strip()
    face_detected = body.get("face_detected", True)

    try:
        confidence = float(confidence_raw)
    except (TypeError, ValueError):
        return jsonify({
            "status": "error",
            "message": "Invalid confidence"
        }), 400

    if not uid and not rfid:
        return jsonify({
            "status": "error",
            "message": "Missing employee UID or RFID"
        }), 400

    if confidence < MIN_CONFIDENCE:
        return jsonify({
            "status": "rejected",
            "message": f"Face confidence {confidence:.1f}% is below "
                       f"the {MIN_CONFIDENCE:.1f}% threshold",
            "uid": uid,
            "rfid": rfid,
            "confidence": confidence,
        }), 403

    # Get employee by UID or RFID
    employee = None
    if uid:
        employee = _get_employee_by_uid(uid)
    if not employee and rfid:
        employee = _get_employee_by_rfid(rfid)

    if not employee:
        return jsonify({
            "status": "rejected",
            "message": "Employee not found in the system",
            "uid": uid,
            "rfid": rfid,
        }), 404

    # Check .tfs file exists
    employee_rfid = str(employee.get("rfid", "")).strip().upper()
    tfs_data = _load_tfs_file(employee_rfid)
    if not tfs_data:
        return jsonify({
            "status": "rejected",
            "message": "Employee has no .tfs face file registered",
            "uid": uid,
            "rfid": employee_rfid,
        }), 404

    # Normalize timestamp
    if not scanned_at:
        scanned_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    else:
        try:
            scanned_dt = datetime.fromisoformat(scanned_at.replace("Z", "+00:00"))
            scanned_at = scanned_dt.astimezone().strftime("%Y-%m-%d %H:%M:%S")
        except ValueError:
            scanned_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    # ========================================================================
    # RECORD ATTENDANCE - Reuse existing app.py functions
    # ========================================================================
    try:
        from app import record_attendance_scan, save_attendance_data
        from app import add_scan_to_feed, add_activity, scan_events, save_scan_events
        
        # Record the attendance scan - uses RFID to log time in/out
        record, result = record_attendance_scan(employee, scanned_at)
        save_attendance_data()

        # Log the face scan
        _log_face_scan(employee_rfid, employee, confidence, "face_verified", "face_verification")

        # Add to scan feed (for dashboard display)
        add_scan_to_feed(
            employee_rfid, 
            scanned_at, 
            employee, 
            True, 
            scan_type="face_recognition"
        )

        # Add to scan events
        scan_events.append({
            "rfid": employee_rfid,
            "scanned_at": scanned_at,
            "scanned_on": datetime.now().date().isoformat(),
            "scan_type": "face",
            "confidence": confidence,
        })
        save_scan_events({"scan_events": scan_events[-10000:]})

        # Log activity
        add_activity(
            "face_attendance",
            f"✅ Face recognized: {employee.get('firstname', '')} {employee.get('lastname', '')} "
            f"({employee.get('employeeid', '')}) - {confidence:.1f}% confidence - {result}",
            {"name": "Face Scanner", "uid": "system"},
            "attendance"
        )

        is_present = result in ["success", "already_exists"]

        return jsonify({
            "status": "success",
            "message": result,
            "source": "face-scanner",
            "confidence": confidence,
            "scanned_at": scanned_at,
            "employee": _employee_public(employee),
            "is_present": is_present,
            "rfid_used": employee_rfid,
            "attendance_status": result,
            "tfs_file": f"{employee_rfid}.tfs",
            "samples": tfs_data.get("samples", 0),
        }), 200

    except Exception as exc:
        print(f"❌ Attendance recording failed: {exc}")
        import traceback
        traceback.print_exc()
        return jsonify({
            "status": "error",
            "message": f"Attendance recording failed: {str(exc)}",
            "uid": uid,
            "rfid": rfid,
        }), 500


@facescanner_bp.get("/api/scan-log")
def get_scan_log():
    """Get the face scan log."""
    limit = request.args.get("limit", default=50, type=int)
    
    log_data = []
    if os.path.exists(SCAN_LOG_FILE):
        try:
            with open(SCAN_LOG_FILE, "r", encoding="utf-8") as f:
                log_data = json.load(f)
                if not isinstance(log_data, list):
                    log_data = []
        except:
            log_data = []
    
    if limit and limit > 0:
        log_data = log_data[:limit]
    
    return jsonify({
        "status": "success",
        "count": len(log_data),
        "logs": log_data,
    })


@facescanner_bp.get("/api/recent-attendance")
def recent_attendance():
    """Get recent attendance records for display."""
    try:
        from app import attendance_records
        recent = []
        today = datetime.now().date().isoformat()
        
        for record in attendance_records[-50:]:
            dtr = record.get("dtr", {})
            for date_key, day in dtr.items():
                if day.get("date") == today:
                    recent.append({
                        "employee": record.get("fullname", ""),
                        "employeeid": record.get("employeeid", ""),
                        "date": day.get("date", ""),
                        "am_in": day.get("am_in", ""),
                        "am_out": day.get("am_out", ""),
                        "pm_in": day.get("pm_in", ""),
                        "pm_out": day.get("pm_out", ""),
                        "hours": day.get("hours", "0.00"),
                        "status": day.get("status", ""),
                    })
        
        return jsonify({
            "status": "success",
            "count": len(recent),
            "attendance": recent,
        })
    except Exception as e:
        return jsonify({
            "status": "error",
            "message": str(e),
            "attendance": [],
        }), 200


@facescanner_bp.get("/api/dashboard-stats")
def scanner_dashboard_stats():
    """Get dashboard statistics for the face scanner."""
    try:
        from app import get_dashboard_statistics
        stats = get_dashboard_statistics()
        
        tfs_files = _list_tfs_files()
        stats["tfs_files"] = len(tfs_files)
        stats["face_scanner_active"] = True
        
        return jsonify({
            "status": "success",
            "stats": stats,
        })
    except Exception as e:
        return jsonify({
            "status": "error",
            "message": str(e),
        }), 200


def register(app):
    """Register the blueprint with the Flask app."""
    _ensure_directories()
    app.register_blueprint(facescanner_bp)
    print("✅ Face recognition module at /facialrecognition")
    print("   📷 Detects faces using .tfs files")
    print("   🔒 Records attendance via RFID verification")
    print(f"   🎯 Minimum confidence: {MIN_CONFIDENCE}%")
    print(f"   📁 Samples directory: {SAMPLES_DIR}")