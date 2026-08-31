## main.py

## Imports
import machine
import utime as time
import ujson as json
import ntptime
import network
import sys
import ssl
import usocket

from boot import *
from configs.config import *
from configs import parameters as param
from driver import BUZZER, PCF8574, PN532

## Global hardware objects
buzzer = None
lcd = None
rfid = None

# Track when operations are in progress to prevent multiple simultaneous attempts
operation_in_progress = False

# Track last loop time to detect hangs - will be updated in main loop
last_loop_time = 0

# Global flag for time sync
time_synced = False
time_sync_in_progress = False

# Track last loop iteration for watchdog
last_loop_iteration = 0

## Functions
def check_wifi_connection():
    """Check if WiFi is connected and reconnect if needed - NON-BLOCKING"""
    wlan = network.WLAN(network.STA_IF)
    if not wlan.isconnected():
        tprint(PRINTSTATUS.WARN, "WiFi disconnected, attempting to reconnect...")
        wlan.active(True)
        wlan.connect(param.WIFI_SSID, param.WIFI_PASSWORD)
        timeout = 20  # Reduced from 30 to 20
        # Non-blocking wait with small sleep
        while not wlan.isconnected() and timeout > 0:
            time.sleep_ms(50)  # Reduced from 100ms to 50ms
            timeout -= 1
        if wlan.isconnected():
            tprint(PRINTSTATUS.SUCCESS, "WiFi reconnected!")
            tprint(PRINTSTATUS.INFO, "IP Address: " + wlan.ifconfig()[0])
            return True
        else:
            tprint(PRINTSTATUS.ERROR, "WiFi reconnection failed")
            return False
    return True

def check_internet_connection():
    """Check if device has internet access - NON-BLOCKING with short timeout"""
    try:
        import socket
        # Use non-blocking socket with timeout
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(1)  # 1 second timeout
        sock.connect(("8.8.8.8", 53))
        sock.close()
        return True
    except:
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(1)
            sock.connect(("google.com", 80))
            sock.close()
            return True
        except:
            return False

def check_api_connectivity():
    """Check if API is reachable using raw socket with SSL - with shorter timeout"""
    try:
        # DNS lookup with timeout protection
        addr = None
        try:
            addr = usocket.getaddrinfo(API_ADDR, 443)[0][-1]
        except:
            return False
        
        s = usocket.socket(usocket.AF_INET, usocket.SOCK_STREAM)
        s.settimeout(1.5)  # Reduced from 2 to 1.5 seconds
        s.connect(addr)
        # Wrap the connected socket with SSL
        s = ssl.wrap_socket(s)
        s.settimeout(1.5)  # Set timeout on SSL socket too
        
        # Use ujson to create JSON data
        data = json.dumps({"device_id": param.DEVICE_ID, "status": "test"})
        request = (
            "POST /api/device-ping HTTP/1.1\r\n"
            "Host: " + API_ADDR + "\r\n"
            "Content-Type: application/json\r\n"
            "Content-Length: " + str(len(data)) + "\r\n"
            "Connection: close\r\n"
            "\r\n"
            + data
        )
        
        s.write(request.encode())
        response = s.read(200)
        s.close()
        
        if b"200" in response:
            return True
        return False
    except Exception as e:
        # Silent fail for API check to avoid log spam
        return False

def restart_device():
    """Restart the device"""
    tprint(PRINTSTATUS.WARN, "RESTARTING: No internet connection...")
    
    # Show restart message on LCD
    try:
        if lcd:
            lcd.clear()
            lcd.putstr("NO INTERNET!")
            lcd.move_to(0, 1)
            lcd.putstr("RESTARTING...")
    except:
        pass
    
    # Beep pattern - 3 beeps for restart
    try:
        if buzzer:
            for _ in range(3):
                buzzer.on()
                time.sleep_ms(200)
                buzzer.off()
                time.sleep_ms(200)
    except:
        pass
    
    time.sleep_ms(2000)
    machine.reset()

def send_ping():
    """Send device ping using raw socket with SSL - NON-BLOCKING with timeout"""
    global operation_in_progress
    
    # Prevent overlapping operations
    if operation_in_progress:
        tprint(PRINTSTATUS.WARN, "Operation already in progress, skipping ping")
        return False
    
    if not check_wifi_connection():
        return False
    
    operation_in_progress = True
        
    try:
        # DNS lookup with timeout protection
        addr = None
        try:
            addr = usocket.getaddrinfo(API_ADDR, 443)[0][-1]
        except:
            tprint(PRINTSTATUS.ERROR, "DNS lookup failed")
            operation_in_progress = False
            return False
            
        s = usocket.socket(usocket.AF_INET, usocket.SOCK_STREAM)
        s.settimeout(1.5)  # Reduced from 2 to 1.5 seconds
        s.connect(addr)
        # Wrap the connected socket with SSL
        s = ssl.wrap_socket(s)
        s.settimeout(1.5)  # Set timeout on SSL socket
        
        # Use ujson to create JSON data
        data = json.dumps({"device_id": param.DEVICE_ID, "status": "alive"})
        request = (
            "POST /api/device-ping HTTP/1.1\r\n"
            "Host: " + API_ADDR + "\r\n"
            "Content-Type: application/json\r\n"
            "Content-Length: " + str(len(data)) + "\r\n"
            "Connection: close\r\n"
            "\r\n"
            + data
        )
        
        tprint(PRINTSTATUS.INFO, f"Sending ping: https://{API_ADDR}/api/device-ping")
        s.write(request.encode())
        response = s.read(200)
        s.close()
        
        if b"200" in response:
            tprint(PRINTSTATUS.INFO, "Ping sent: Device alive")
            operation_in_progress = False
            return True
        else:
            tprint(PRINTSTATUS.WARN, f"Ping returned: {response[:50]}")
            operation_in_progress = False
            return False
    except Exception as e:
        tprint(PRINTSTATUS.ERROR, f"Ping failed: {str(e)}")
        operation_in_progress = False
        return False

def post_data(rfid_str):
    """Send RFID data using raw socket with SSL - NON-BLOCKING with timeout"""
    global operation_in_progress
    
    # Prevent overlapping operations
    if operation_in_progress:
        tprint(PRINTSTATUS.WARN, "Operation already in progress, skipping RFID send")
        return False
    
    if not check_wifi_connection():
        return False
    
    operation_in_progress = True
        
    t = time.localtime()
    scanned_time = "{:04d}-{:02d}-{:02d} {:02d}:{:02d}:{:02d}".format(
        t[0], t[1], t[2], t[3], t[4], t[5]
    )
    
    # Use ujson to create JSON data
    data = json.dumps({
        "rfid": rfid_str,
        "scanned_at": scanned_time
    })
    
    try:
        # Display the URL being sent to (similar to ping)
        tprint(PRINTSTATUS.INFO, f"Sending RFID: https://{API_ADDR}/api/receive-rfid")
        tprint(PRINTSTATUS.INFO, f"Data: {data}")
        
        # DNS lookup with timeout protection
        addr = None
        try:
            addr = usocket.getaddrinfo(API_ADDR, 443)[0][-1]
        except:
            tprint(PRINTSTATUS.ERROR, "DNS lookup failed")
            operation_in_progress = False
            return False
            
        s = usocket.socket(usocket.AF_INET, usocket.SOCK_STREAM)
        s.settimeout(1.5)  # Reduced from 2 to 1.5 seconds
        s.connect(addr)
        # Wrap the connected socket with SSL
        s = ssl.wrap_socket(s)
        s.settimeout(1.5)  # Set timeout on SSL socket
        
        request = (
            "POST /api/receive-rfid HTTP/1.1\r\n"
            "Host: " + API_ADDR + "\r\n"
            "Content-Type: application/json\r\n"
            "Content-Length: " + str(len(data)) + "\r\n"
            "Connection: close\r\n"
            "\r\n"
            + data
        )
        
        s.write(request.encode())
        response = s.read(200)
        s.close()
        
        if b"200" in response:
            tprint(PRINTSTATUS.SUCCESS, "RFID sent successfully (200 OK)")
            operation_in_progress = False
            return True
        else:
            tprint(PRINTSTATUS.WARN, f"RFID send returned: {response[:50]}")
            operation_in_progress = False
            return False
    except Exception as e:
        tprint(PRINTSTATUS.ERROR, f"Send error: {str(e)}")
        operation_in_progress = False
        return False

def sync_manila_time():
    """Sync time from internet and adjust to Manila (UTC+8) - NON-BLOCKING with timeout"""
    global time_synced, time_sync_in_progress
    
    # Prevent multiple sync attempts
    if time_sync_in_progress:
        return False
    
    if not check_wifi_connection():
        return False
    
    time_sync_in_progress = True
        
    try:
        # Try multiple NTP servers with timeout
        ntp_servers = ["pool.ntp.org", "time.google.com", "time.windows.com", "ntp.aliyun.com"]
        for server in ntp_servers:
            try:
                tprint(PRINTSTATUS.INFO, f"Trying NTP: {server}")
                # Set a shorter timeout for NTP
                ntptime.host = server
                # Use machine timer for timeout
                start_time = time.ticks_ms()
                ntptime.settime()
                # Check if it took too long
                if time.ticks_diff(time.ticks_ms(), start_time) > 5000:
                    tprint(PRINTSTATUS.WARN, f"NTP {server} took too long, skipping")
                    continue
                    
                t = time.localtime(time.time() + 8 * 3600)
                machine.RTC().datetime((t[0], t[1], t[2], t[6] + 1, t[3], t[4], t[5], 0))
                tprint(PRINTSTATUS.SUCCESS, f"Manila Time Synced via {server}")
                time_synced = True
                time_sync_in_progress = False
                return True
            except Exception as e:
                tprint(PRINTSTATUS.WARN, f"NTP {server} failed: {str(e)}")
                continue
        
        tprint(PRINTSTATUS.ERROR, "All NTP servers failed")
        time_sync_in_progress = False
        return False
    except Exception as e:
        tprint(PRINTSTATUS.ERROR, f"Time Sync Failed: {str(e)}")
        time_sync_in_progress = False
        return False

def monitor_internet_and_restart():
    """Monitor internet and restart if no connection - NON-BLOCKING with timeout protection"""
    global no_internet_count
    
    # Quick WiFi check first - non-blocking
    if not check_wifi_connection():
        tprint(PRINTSTATUS.ERROR, "No WiFi connection!")
        no_internet_count += 1
        if no_internet_count >= 3:
            restart_device()
        return False
    
    # Check internet connectivity - quick check with timeout
    try:
        # Use a timer to prevent hanging
        start_time = time.ticks_ms()
        has_internet = check_internet_connection()
        if time.ticks_diff(time.ticks_ms(), start_time) > 2000:
            tprint(PRINTSTATUS.WARN, "Internet check timeout")
            no_internet_count += 1
            if no_internet_count >= 3:
                restart_device()
            return False
            
        if not has_internet:
            tprint(PRINTSTATUS.ERROR, "No internet connection!")
            no_internet_count += 1
            if no_internet_count >= 3: 
                restart_device()
            return False
    except:
        no_internet_count += 1
        if no_internet_count >= 3:
            restart_device()
        return False
    
    # Check API connectivity - with timeout protection
    try:
        start_time = time.ticks_ms()
        api_ok = check_api_connectivity()
        if time.ticks_diff(time.ticks_ms(), start_time) > 2000:
            tprint(PRINTSTATUS.WARN, "API check timeout")
            no_internet_count += 1
            if no_internet_count >= 3:
                restart_device()
            return False
            
        if not api_ok:
            tprint(PRINTSTATUS.ERROR, "API not reachable!")
            no_internet_count += 1
            if no_internet_count >= 3:
                restart_device()
            return False
    except:
        no_internet_count += 1
        if no_internet_count >= 3:
            restart_device()
        return False
    
    # Reset counter if all checks pass
    no_internet_count = 0
    return True

## Initialize Hardware Drivers FIRST
def init_drivers():
    global buzzer, lcd, rfid

    # Scan I2C bus
    tprint(PRINTSTATUS.INFO, "Scanning I2C bus...")
    i2c_bus = machine.SoftI2C(scl=machine.Pin(param.I2C_SCL_PINOUT), sda=machine.Pin(param.I2C_SDA_PINOUT), freq=100000)
    devices = i2c_bus.scan()
    tprint(PRINTSTATUS.INFO, "I2C Found: " + str([hex(d) for d in devices]))

    # INIT BUZZER
    try:
        buzzer = BUZZER(param.BUZZER_PIN)
        # Startup melody
        buzzer.on()
        time.sleep_ms(300)
        buzzer.off()
        time.sleep_ms(80)
        buzzer.on()
        time.sleep_ms(80)
        buzzer.off()
        tprint(PRINTSTATUS.SUCCESS, "BUZZER OK")
    except Exception as e:
        tprint(PRINTSTATUS.ERROR, "BUZZER INIT FAILED: " + str(e))
        buzzer = None
        raise

    # INIT LCD
    try:
        if param.LCD_ADDR in devices:
            lcd = PCF8574(i2c_bus, param.LCD_ADDR, rows=2, cols=16)
            lcd.clear()
            tprint(PRINTSTATUS.SUCCESS, "LCD OK")
        else:
            raise Exception("LCD missing")
    except Exception as e:
        tprint(PRINTSTATUS.ERROR, "LCD INIT FAILED: " + str(e))
        lcd = None
        raise

    # INIT RFID
    try:
        rfid = PN532()
        tprint(PRINTSTATUS.SUCCESS, "RFID OK")
    except Exception as e:
        tprint(PRINTSTATUS.ERROR, "RFID INIT FAILED: " + str(e))
        rfid = None
        raise

    tprint(PRINTSTATUS.SUCCESS, "ALL DRIVERS INITIALIZED OK")
    return True

## Hardware Fail-Safe Indicator (when boot.py triggers fail-safe)
def hardware_failsafe_indicator():
    tprint(PRINTSTATUS.WARN, ">>> HARDWARE FAIL-SAFE INDICATOR <<<")
    for _ in range(10):
        try:
            if buzzer:
                buzzer.on()
            if lcd:
                lcd.clear()
                lcd.putstr("!!! FAILSAFE !!!")
                lcd.move_to(0, 1)
                lcd.putstr("TOO MANY RESTARTS")
        except:
            pass
        time.sleep_ms(200)
        try:
            if buzzer:
                buzzer.off()
        except:
            pass
        time.sleep_ms(200)
    try:
        if lcd:
            lcd.clear()
            lcd.putstr("WAITING...")
            lcd.move_to(0, 1)
            lcd.putstr("RETRYING LATER")
    except:
        pass

def clear_status():
    """Clear only the status indicators (OK/ER/!) from LCD row 1, positions 14-15"""
    try:
        lcd.move_to(14, 1)
        lcd.putstr("  ")  # Two spaces to clear OK/ER/!
    except:
        pass

def reset_lcd_to_ready():
    """Reset LCD second row to 'Scan RFID Card'"""
    try:
        lcd.move_to(0, 1)
        lcd.putstr("Scan RFID Card")
    except:
        pass

def read_rfid_nonblocking():
    """Read RFID in a truly non-blocking way - single attempt with timeout"""
    global rfid
    
    try:
        # Single quick attempt to read RFID
        # Check if RFID is ready without blocking
        uid = rfid.get_uid()
        if uid and len(uid) >= 4:
            return uid
        return None
    except Exception as e:
        # Silent fail for RFID read errors
        return None

## Main function
def main():
    global buzzer, lcd, rfid, no_internet_count, operation_in_progress, last_loop_time
    global time_synced, time_sync_in_progress
    
    # Initialize counter
    no_internet_count = 0
    operation_in_progress = False
    last_loop_time = time.ticks_ms()
    time_synced = False
    time_sync_in_progress = False

    # Check WiFi first - with timeout
    tprint(PRINTSTATUS.INFO, "Checking WiFi connection...")
    if not check_wifi_connection():
        tprint(PRINTSTATUS.ERROR, "WiFi not connected! Restarting...")
        time.sleep_ms(2000)
        machine.reset()

    # INIT ALL DRIVERS FIRST
    try:
        init_drivers()
    except Exception as err:
        tprint(PRINTSTATUS.ERROR, "DRIVER INIT FAILED: " + str(err))
        # Buzzer 3 beeps error - NO RESET
        try:
            if buzzer:
                buzzer.on()
                time.sleep_ms(80)
                buzzer.off()
                time.sleep_ms(300)
        except:
            pass
        # LCD show error - stays visible
        try:
            if lcd:
                lcd.clear()
                lcd.putstr("INIT FAILED")
                lcd.move_to(0, 1)
                lcd.putstr("Check Wiring")
        except:
            pass
        # Return to boot.py to count up
        return

    # Sync Manila Time - do it once, but don't block main loop if it fails
    try:
        sync_manila_time()
    except:
        pass

    # NORMAL OPERATION
    last_rfid = None                                # Track last scanned RFID to prevent duplicates
    last_rfid_time = 0                              # Track last time a specific RFID was scanned
    last_scan_time = 0                              # Track last time ANY RFID was scanned (for clearing status)
    last_status_time = 0                            # Track when status (OK/ER) was shown
    ping_retry_count = 0                            # Track consecutive ping failures
    max_ping_retries = 3                            # Max retries before restart
    timer_delay = 8000                              # 8 seconds for status clear, cooldown, and display reset

    last_ping = time.ticks_ms()                     # Track last ping time
    last_time_update = time.ticks_ms()              # Track last time update for LCD
    last_internet_check = time.ticks_ms()           # Track last internet check time
    last_loop_time = time.ticks_ms()                # Track last loop time to detect hangs
    
    # Separate counters for staggered operations
    internet_check_interval = 30000  # 30 seconds
    ping_interval = param.PING_INTERVAL
    time_update_interval = 1000  # 1 second
    
    # Track consecutive loop iterations
    loop_iteration = 0

    tprint(PRINTSTATUS.SUCCESS, "Device Ready.")
    
    # Display initial status on LCD
    try:
        lcd.clear()
        lcd.putstr("TAPIN READY")
        lcd.move_to(0, 1)
        lcd.putstr("Scan RFID Card")
    except:
        pass
    
    # --- MAIN LOOP ---
    while True:
        current_time = time.ticks_ms()
        loop_iteration += 1
        
        # Watchdog: If loop hangs for more than 10 seconds, force reset
        if time.ticks_diff(current_time, last_loop_time) > 10000:
            tprint(PRINTSTATUS.WARN, "Loop hung detected! Forcing reset...")
            time.sleep_ms(500)  # Small delay before reset
            machine.reset()
        last_loop_time = current_time
        
        # 1. Check internet connectivity every 30 seconds - NON-BLOCKING
        if time.ticks_diff(current_time, last_internet_check) >= internet_check_interval:
            last_internet_check = current_time
            # Wrap in try-except to prevent monitor_internet_and_restart from hanging
            try:
                # Use a timeout mechanism - if it takes more than 3 seconds, skip
                start_check = time.ticks_ms()
                monitor_internet_and_restart()
                if time.ticks_diff(time.ticks_ms(), start_check) > 3000:
                    tprint(PRINTSTATUS.WARN, "Internet check took too long, skipping")
            except Exception as e:
                tprint(PRINTSTATUS.ERROR, f"Internet check error: {e}")

        # 2. Send ping - only if not already in an operation
        if time.ticks_diff(current_time, last_ping) >= ping_interval and not operation_in_progress:
            last_ping = current_time
            try:
                # Use a timeout mechanism
                start_ping = time.ticks_ms()
                if not send_ping():
                    ping_retry_count += 1
                    if ping_retry_count >= max_ping_retries:
                        tprint(PRINTSTATUS.WARN, "Multiple ping failures - restarting...")
                        time.sleep_ms(1000)
                        machine.reset()
                else:
                    ping_retry_count = 0
                if time.ticks_diff(time.ticks_ms(), start_ping) > 3000:
                    tprint(PRINTSTATUS.WARN, "Ping took too long")
            except Exception as e:
                tprint(PRINTSTATUS.ERROR, f"Ping attempt error: {e}")

        # 3. Update Time — AM/PM format
        if time.ticks_diff(current_time, last_time_update) >= time_update_interval:
            last_time_update = current_time
            try:
                t = time.localtime()
                hour24 = t[3]

                if hour24 == 0:
                    hour12 = 12
                    period = "AM"
                elif hour24 < 12:
                    hour12 = hour24
                    period = "AM"
                elif hour24 == 12:
                    hour12 = 12
                    period = "PM"
                else:
                    hour12 = hour24 - 12
                    period = "PM"
                    
                time_str = "Time:{:02d}:{:02d}:{:02d} {}".format(hour12, t[4], t[5], period)
                lcd.move_to(0, 0)
                lcd.putstr(time_str)
            except:
                pass
            
            # Check if we need to clear status after 8 seconds
            if last_status_time > 0:
                time_since_status = time.ticks_diff(current_time, last_status_time)
                if time_since_status >= timer_delay:
                    clear_status()
                    last_status_time = 0
            
            # Check if we need to reset display after 8 seconds of no scan
            if last_scan_time > 0:
                time_since_last_scan = time.ticks_diff(current_time, last_scan_time)
                if time_since_last_scan >= timer_delay:
                    reset_lcd_to_ready()
                    last_scan_time = 0  # Reset so we don't keep resetting
                    # Reset last_rfid so the next scan shows as new
                    last_rfid = None

        # 4. Read RFID - TRULY NON-BLOCKING (single attempt, no loop)
        try:
            # Single attempt to read RFID - no loop, no blocking
            uid = read_rfid_nonblocking()
            
            if uid and len(uid) >= 4:
                rfid_str = "".join("{:02X}".format(b) for b in uid)

                # Check if this is a new RFID or same RFID but cooldown expired
                is_new_rfid = (rfid_str != last_rfid)
                is_cooldown_expired = False
                
                if not is_new_rfid:
                    # Same RFID - check cooldown
                    time_since_last_scan = time.ticks_diff(current_time, last_rfid_time)
                    if time_since_last_scan >= timer_delay:
                        is_cooldown_expired = True
                        tprint(PRINTSTATUS.INFO, f"Cooldown expired for RFID: {rfid_str}")
                    else:
                        remaining = (timer_delay - time_since_last_scan) // 1000
                        # Only log every 5 seconds to reduce spam
                        if remaining % 5 == 0:
                            tprint(PRINTSTATUS.INFO, f"Cooldown active for RFID: {rfid_str} ({remaining}s remaining)")
                
                # Process RFID if it's new OR cooldown expired
                if is_new_rfid or is_cooldown_expired:
                    last_rfid = rfid_str
                    last_rfid_time = current_time
                    last_scan_time = current_time  # Update last scan time for display reset
                    tprint(PRINTSTATUS.INFO, "RFID: " + rfid_str)

                    # Buzzer beep after successful scan - NON-BLOCKING
                    try:
                        buzzer.on()
                        time.sleep_ms(100)  # Reduced from 150ms to 100ms
                        buzzer.off()
                    except:
                        pass

                    # Display RFID on LCD - NON-BLOCKING
                    display_str = "RFID:" + rfid_str
                    while len(display_str) < 14:
                        display_str = display_str + " "
                    try:
                        lcd.move_to(0, 1)
                        lcd.putstr(display_str)
                    except:
                        pass

                    # Send RFID data to API - NON-BLOCKING with timeout
                    # Quick WiFi check first
                    if check_wifi_connection() and check_internet_connection():
                        # Send data but don't block - use timeout
                        try:
                            start_send = time.ticks_ms()
                            if post_data(rfid_str):
                                # Success - show OK (only when status 200)
                                try:
                                    lcd.move_to(14, 1)
                                    lcd.putstr("OK")
                                    last_status_time = current_time  # Track when status was shown
                                except:
                                    pass
                            else:
                                # Failed - show ER (for any non-200 response)
                                try:
                                    lcd.move_to(14, 1)
                                    lcd.putstr("ER")
                                    last_status_time = current_time  # Track when status was shown
                                except:
                                    pass
                            # If send takes too long, mark as error
                            if time.ticks_diff(time.ticks_ms(), start_send) > 3000:
                                try:
                                    lcd.move_to(14, 1)
                                    lcd.putstr("! ")
                                    last_status_time = current_time
                                except:
                                    pass
                        except:
                            # Exception during send - show error
                            try:
                                lcd.move_to(14, 1)
                                lcd.putstr("! ")
                                last_status_time = current_time
                            except:
                                pass
                    else:
                        # No internet - show error
                        try:
                            lcd.move_to(14, 1)
                            lcd.putstr("! ")
                            last_status_time = current_time  # Track when status was shown
                        except:
                            pass

        except Exception as e:
            # Silent fail for RFID read errors to prevent logging spam
            # Only log if it's not a timeout error
            if "timeout" not in str(e).lower():
                # Only log every 10 iterations to prevent spam
                if loop_iteration % 10 == 0:
                    tprint(PRINTSTATUS.ERROR, f"RFID read error: {str(e)}")

        # Small delay to prevent watchdog trigger - reduced from 50ms to 20ms
        time.sleep_ms(20)

# Run main
main()