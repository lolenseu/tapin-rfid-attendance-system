# train.py
"""
TapIn Face Model Trainer Dashboard
Import 5 face images and export as [RFID].tapin for use with app.py
"""

import os
import sys
import json
import cv2
import numpy as np
import pickle
import shutil
from datetime import datetime
from tkinter import filedialog, messagebox
import tkinter as tk
from tkinter import ttk
from PIL import Image, ImageTk

# ============================================================================
# EXTERNAL STORAGE PATH CONFIGURATION
# ============================================================================
def get_storage_path():
    """Get the storage path that works for both development and compiled EXE."""
    if getattr(sys, 'frozen', False):
        base_dir = os.path.dirname(sys.executable)
    else:
        base_dir = os.path.dirname(os.path.abspath(__file__))
    return os.path.join(base_dir, "storage")

# ============================================================================
# Configuration
# ============================================================================
STORAGE_DIR = get_storage_path()
DATABASE_DIR = os.path.join(STORAGE_DIR, "database")
SAMPLES_DIR = os.path.join(STORAGE_DIR, "samples")
MODELS_DIR = os.path.join(STORAGE_DIR, "models")
USERS_FILE = os.path.join(DATABASE_DIR, "users.json")

# Sample requirements
REQUIRED_SAMPLES = 5
RFID_MAX_LENGTH = 8
MODEL_EXTENSION = ".tapin"

# ============================================================================
# Ensure Directories Exist
# ============================================================================
os.makedirs(DATABASE_DIR, exist_ok=True)
os.makedirs(SAMPLES_DIR, exist_ok=True)
os.makedirs(MODELS_DIR, exist_ok=True)

# ============================================================================
# Colors
# ============================================================================
COLORS = {
    "primary": "#2563EB",
    "primary_dark": "#1D4ED8",
    "primary_light": "#DBEAFE",
    "secondary": "#3B82F6",
    "accent": "#06B6D4",
    "accent_light": "#CFFAFE",
    "success": "#22C55E",
    "success_light": "#DCFCE7",
    "warning": "#F59E0B",
    "warning_light": "#FEF3C7",
    "danger": "#EF4444",
    "danger_light": "#FEE2E2",
    "info": "#3B82F6",
    "info_light": "#DBEAFE",
    "leave": "#8B5CF6",
    "leave_light": "#EDE9FE",
    "white": "#FFFFFF",
    "gray_50": "#F8FAFC",
    "gray_100": "#F1F5F9",
    "gray_200": "#E2E8F0",
    "gray_300": "#CBD5E1",
    "gray_400": "#94A3B8",
    "gray_500": "#64748B",
    "gray_600": "#475569",
    "gray_700": "#334155",
    "gray_800": "#1E293B",
    "gray_900": "#0F172A",
}


class FaceModelTrainer:
    def __init__(self, root):
        self.root = root
        self.root.title("TapIn - Face Model Trainer")
        self.root.geometry("1100x750")
        self.root.configure(bg=COLORS["gray_50"])
        self.root.resizable(False, False)

        # Initialize
        self.face_cascade = None
        self.recognizer = cv2.face.LBPHFaceRecognizer_create()
        self.sample_images = []
        self.face_detected = False
        self.is_closing = False

        # Load cascade
        self.init_face_cascade()
        
        # Create UI
        self.create_widgets()
        
        # Update status
        self.update_status()

    def init_face_cascade(self):
        """Initialize OpenCV face detector with optimized parameters"""
        try:
            cascade_paths = [
                cv2.data.haarcascades + 'haarcascade_frontalface_default.xml',
                os.path.join(cv2.__path__[0], 'data', 'haarcascade_frontalface_default.xml'),
            ]
            
            for path in cascade_paths:
                if os.path.exists(path):
                    self.face_cascade = cv2.CascadeClassifier(path)
                    print(f"Loaded cascade from: {path}")
                    break
            
            if self.face_cascade is None:
                print("Warning: Could not load face cascade.")
                self.face_cascade = cv2.CascadeClassifier()
        except Exception as e:
            print(f"Error initializing face cascade: {e}")
            self.face_cascade = None

    def detect_faces(self, gray):
        """Detect faces with optimized parameters"""
        if self.face_cascade is None:
            return []
        
        # Try different parameters for better detection
        faces = self.face_cascade.detectMultiScale(
            gray,
            scaleFactor=1.1,
            minNeighbors=5,
            minSize=(50, 50),
            flags=cv2.CASCADE_SCALE_IMAGE
        )
        
        # If no faces found, try with more sensitive parameters
        if len(faces) == 0:
            faces = self.face_cascade.detectMultiScale(
                gray,
                scaleFactor=1.05,
                minNeighbors=3,
                minSize=(40, 40),
                flags=cv2.CASCADE_SCALE_IMAGE
            )
        
        # If still no faces, try with even more sensitive parameters
        if len(faces) == 0:
            faces = self.face_cascade.detectMultiScale(
                gray,
                scaleFactor=1.03,
                minNeighbors=2,
                minSize=(30, 30),
                flags=cv2.CASCADE_SCALE_IMAGE
            )
        
        # If multiple faces detected, return the largest one
        if len(faces) > 1:
            faces = sorted(faces, key=lambda f: f[2] * f[3], reverse=True)
            faces = [faces[0]]
        
        return faces

    def create_widgets(self):
        """Create the UI widgets"""
        # Header
        header_frame = tk.Frame(self.root, bg=COLORS["primary"], height=70)
        header_frame.pack(fill=tk.X, side=tk.TOP)
        header_frame.pack_propagate(False)

        header_title = tk.Label(header_frame, text="TapIn Face Model Trainer", 
                               font=("Segoe UI", 20, "bold"), 
                               bg=COLORS["primary"], fg="white")
        header_title.pack(side=tk.LEFT, padx=20, pady=15)

        header_sub = tk.Label(header_frame, text=f"Import 5 images → Export as [RFID]{MODEL_EXTENSION}", 
                             font=("Segoe UI", 12), 
                             bg=COLORS["primary"], fg=COLORS["accent_light"])
        header_sub.pack(side=tk.LEFT, padx=15, pady=15)

        # Status indicator
        self.status_indicator = tk.Label(header_frame, text="● Ready", 
                                        font=("Segoe UI", 11, "bold"),
                                        bg=COLORS["primary"], fg=COLORS["success_light"])
        self.status_indicator.pack(side=tk.RIGHT, padx=20, pady=15)

        # Main content
        main_frame = tk.Frame(self.root, bg=COLORS["gray_50"])
        main_frame.pack(fill=tk.BOTH, expand=True, padx=20, pady=20)

        # LEFT PANEL - Controls
        left_panel = tk.Frame(main_frame, bg=COLORS["white"], relief=tk.RAISED, bd=1)
        left_panel.pack(side=tk.LEFT, fill=tk.BOTH, expand=False, padx=(0, 10))
        left_panel.configure(width=380)
        left_panel.pack_propagate(False)

        # Panel header
        panel_header = tk.Frame(left_panel, bg=COLORS["primary_light"], height=40)
        panel_header.pack(fill=tk.X, side=tk.TOP)
        panel_header.pack_propagate(False)
        tk.Label(panel_header, text="⚙️ Employee Setup", 
                font=("Segoe UI", 12, "bold"),
                bg=COLORS["primary_light"], fg=COLORS["primary_dark"]).pack(side=tk.LEFT, padx=15, pady=8)

        # Content container
        content_frame = tk.Frame(left_panel, bg=COLORS["white"])
        content_frame.pack(fill=tk.BOTH, expand=True, padx=20, pady=20)

        # RFID Entry
        tk.Label(content_frame, text=f"RFID Number (max {RFID_MAX_LENGTH} chars):", 
                font=("Segoe UI", 10, "bold"),
                bg=COLORS["white"], fg=COLORS["gray_700"]).pack(anchor=tk.W, pady=(0, 5))
        
        self.rfid_entry = tk.Entry(content_frame, font=("Segoe UI", 12),
                                   bg=COLORS["gray_50"], fg=COLORS["gray_700"],
                                   relief=tk.FLAT, bd=2, highlightthickness=1,
                                   highlightcolor=COLORS["primary"],
                                   highlightbackground=COLORS["gray_300"])
        self.rfid_entry.pack(fill=tk.X, pady=(0, 15))
        self.rfid_entry.insert(0, f"Enter RFID number (max {RFID_MAX_LENGTH} chars)...")
        self.rfid_entry.bind("<FocusIn>", lambda e: self.rfid_entry.delete(0, tk.END) if self.rfid_entry.get() == f"Enter RFID number (max {RFID_MAX_LENGTH} chars)..." else None)
        self.rfid_entry.bind("<KeyRelease>", self.limit_rfid_length)

        # Name Entry
        tk.Label(content_frame, text="Employee Name:", 
                font=("Segoe UI", 10, "bold"),
                bg=COLORS["white"], fg=COLORS["gray_700"]).pack(anchor=tk.W, pady=(0, 5))
        
        self.name_entry = tk.Entry(content_frame, font=("Segoe UI", 12),
                                   bg=COLORS["gray_50"], fg=COLORS["gray_700"],
                                   relief=tk.FLAT, bd=2, highlightthickness=1,
                                   highlightcolor=COLORS["primary"],
                                   highlightbackground=COLORS["gray_300"])
        self.name_entry.pack(fill=tk.X, pady=(0, 20))
        self.name_entry.insert(0, "Enter employee name...")
        self.name_entry.bind("<FocusIn>", lambda e: self.name_entry.delete(0, tk.END) if self.name_entry.get() == "Enter employee name..." else None)

        # Separator
        ttk.Separator(content_frame, orient='horizontal').pack(fill=tk.X, pady=10)

        # Import buttons
        tk.Label(content_frame, text="Import Face Images:", 
                font=("Segoe UI", 10, "bold"),
                bg=COLORS["white"], fg=COLORS["gray_700"]).pack(anchor=tk.W, pady=(0, 10))

        # Import from files
        self.import_btn = tk.Button(content_frame, text="📁 Import 5 Images from Files", 
                                    command=self.import_images,
                                    font=("Segoe UI", 10, "bold"),
                                    bg=COLORS["primary"], fg="white",
                                    padx=20, pady=10, relief=tk.FLAT, cursor="hand2")
        self.import_btn.pack(fill=tk.X, pady=5)

        # Import from camera
        self.camera_btn = tk.Button(content_frame, text="📸 Capture 5 from Camera", 
                                    command=self.capture_from_camera,
                                    font=("Segoe UI", 10, "bold"),
                                    bg=COLORS["secondary"], fg="white",
                                    padx=20, pady=10, relief=tk.FLAT, cursor="hand2")
        self.camera_btn.pack(fill=tk.X, pady=5)

        # Separator
        ttk.Separator(content_frame, orient='horizontal').pack(fill=tk.X, pady=15)

        # Export button - Green with white text
        self.export_btn = tk.Button(content_frame, text=f"💾 Export {MODEL_EXTENSION} File", 
                                    command=self.export_tapin,
                                    font=("Segoe UI", 11, "bold"),
                                    bg=COLORS["success"], fg="white",
                                    padx=20, pady=12, relief=tk.FLAT, cursor="hand2")
        self.export_btn.pack(fill=tk.X, pady=5)

        # Clear button
        self.clear_btn = tk.Button(content_frame, text="🗑️ Clear All Samples", 
                                   command=self.clear_samples,
                                   font=("Segoe UI", 10, "bold"),
                                   bg=COLORS["danger"], fg="white",
                                   padx=20, pady=8, relief=tk.FLAT, cursor="hand2")
        self.clear_btn.pack(fill=tk.X, pady=5)

        # Separator
        ttk.Separator(content_frame, orient='horizontal').pack(fill=tk.X, pady=15)

        # Status display
        status_frame = tk.Frame(content_frame, bg=COLORS["gray_50"], relief=tk.FLAT, bd=1)
        status_frame.pack(fill=tk.X, pady=5)

        self.sample_count_label = tk.Label(status_frame, text="Samples: 0/5", 
                                          font=("Segoe UI", 10),
                                          bg=COLORS["gray_50"], fg=COLORS["gray_600"])
        self.sample_count_label.pack(anchor=tk.W, padx=10, pady=5)

        # Info text
        info_text = f"⚠️ Need exactly 5 face samples to export as {MODEL_EXTENSION}"
        tk.Label(content_frame, text=info_text, 
                font=("Segoe UI", 9),
                bg=COLORS["warning_light"], fg=COLORS["warning"],
                relief=tk.FLAT, bd=1, pady=8).pack(fill=tk.X, pady=10)

        # RIGHT PANEL - Preview
        right_panel = tk.Frame(main_frame, bg=COLORS["white"], relief=tk.RAISED, bd=1)
        right_panel.pack(side=tk.RIGHT, fill=tk.BOTH, expand=True)

        # Preview header
        preview_header = tk.Frame(right_panel, bg=COLORS["primary_light"], height=40)
        preview_header.pack(fill=tk.X, side=tk.TOP)
        preview_header.pack_propagate(False)
        tk.Label(preview_header, text="🖼️ Face Sample Previews", 
                font=("Segoe UI", 12, "bold"),
                bg=COLORS["primary_light"], fg=COLORS["primary_dark"]).pack(side=tk.LEFT, padx=15, pady=8)

        # Grid for 5 sample previews
        preview_container = tk.Frame(right_panel, bg=COLORS["white"])
        preview_container.pack(fill=tk.BOTH, expand=True, padx=20, pady=20)

        self.preview_canvases = []
        preview_grid = tk.Frame(preview_container, bg=COLORS["white"])
        preview_grid.pack(fill=tk.BOTH, expand=True)

        for i in range(5):
            row = i // 3
            col = i % 3
            
            # Frame for each sample
            sample_frame = tk.Frame(preview_grid, bg=COLORS["white"], relief=tk.FLAT, bd=1)
            sample_frame.grid(row=row, column=col, padx=15, pady=15, sticky="nsew")
            
            # Canvas for image
            canvas = tk.Canvas(sample_frame, bg=COLORS["gray_100"], width=180, height=180,
                              relief=tk.RAISED, bd=2, highlightthickness=2,
                              highlightcolor=COLORS["gray_300"])
            canvas.pack(pady=(5, 2))
            canvas.create_text(90, 90, text=f"Sample {i+1}\n(Empty)", 
                              font=("Segoe UI", 11), fill=COLORS["gray_400"], justify=tk.CENTER)
            
            # Status label
            status_label = tk.Label(sample_frame, text="❌ Empty", 
                                   font=("Segoe UI", 9, "bold"),
                                   bg=COLORS["white"], fg=COLORS["gray_400"])
            status_label.pack(pady=2)
            
            self.preview_canvases.append({
                "canvas": canvas,
                "status": status_label,
                "image": None
            })

        # Configure grid weights
        for i in range(2):
            preview_grid.grid_rowconfigure(i, weight=1)
        for i in range(3):
            preview_grid.grid_columnconfigure(i, weight=1)

        # Bottom info bar
        info_frame = tk.Frame(self.root, bg=COLORS["gray_100"], height=40)
        info_frame.pack(fill=tk.X, side=tk.BOTTOM)
        info_frame.pack_propagate(False)

        self.info_label = tk.Label(info_frame, text=f"Enter RFID (max 8 chars) and Name, then import 5 face images to export as {MODEL_EXTENSION}.", 
                                  font=("Segoe UI", 10),
                                  bg=COLORS["gray_100"], fg=COLORS["gray_600"])
        self.info_label.pack(side=tk.LEFT, padx=20, pady=10)

        # Progress bar
        self.progress = ttk.Progressbar(info_frame, mode='determinate', length=200)
        self.progress.pack(side=tk.RIGHT, padx=20, pady=10)

        # Bind keyboard shortcuts
        self.root.bind("<Control-o>", lambda e: self.import_images())
        self.root.bind("<Control-c>", lambda e: self.capture_from_camera())
        self.root.bind("<Control-e>", lambda e: self.export_tapin())
        self.root.bind("<Control-Delete>", lambda e: self.clear_samples())
        
        # Bind window close event
        self.root.protocol("WM_DELETE_WINDOW", self.on_closing)

    def limit_rfid_length(self, event):
        """Limit RFID entry to max characters"""
        current = self.rfid_entry.get()
        if len(current) > RFID_MAX_LENGTH:
            self.rfid_entry.delete(RFID_MAX_LENGTH, tk.END)

    def update_status(self):
        """Update status labels"""
        sample_count = len(self.sample_images)
        
        self.sample_count_label.config(text=f"Samples: {sample_count}/5")
        
        # Update canvas status
        for i, preview in enumerate(self.preview_canvases):
            if i < len(self.sample_images):
                preview["status"].config(text="✅ Loaded", fg=COLORS["success"])
                preview["canvas"].config(highlightcolor=COLORS["success"])
            else:
                preview["status"].config(text="❌ Empty", fg=COLORS["gray_400"])
                preview["canvas"].config(highlightcolor=COLORS["gray_300"])

        # Update status indicator
        if sample_count == REQUIRED_SAMPLES:
            self.status_indicator.config(text="● Ready", fg=COLORS["success_light"])
        else:
            self.status_indicator.config(text="● Waiting", fg=COLORS["warning_light"])

    def update_preview(self, index, face_image):
        """Update a preview canvas with a face image"""
        canvas_data = self.preview_canvases[index]
        canvas = canvas_data["canvas"]
        
        # Convert face to PIL image
        img = Image.fromarray(face_image)
        img = img.resize((180, 180), Image.Resampling.LANCZOS)
        img_tk = ImageTk.PhotoImage(img)
        
        canvas.delete("all")
        canvas.create_image(90, 90, anchor=tk.CENTER, image=img_tk)
        canvas.image = img_tk

    def clear_previews(self):
        """Clear all preview canvases"""
        self.sample_images = []
        for i, canvas_data in enumerate(self.preview_canvases):
            canvas = canvas_data["canvas"]
            canvas.delete("all")
            canvas.create_text(90, 90, text=f"Sample {i+1}\n(Empty)", 
                              font=("Segoe UI", 11), fill=COLORS["gray_400"], justify=tk.CENTER)
            canvas_data["image"] = None
        
        self.update_status()
        self.info_label.config(text="Samples cleared. Import 5 new images.")

    def import_images(self):
        """Import exactly 5 images from files"""
        # Check if RFID and Name are entered
        rfid = self.rfid_entry.get().strip()
        name = self.name_entry.get().strip()
        
        if not rfid or rfid == f"Enter RFID number (max {RFID_MAX_LENGTH} chars)..." or rfid == "Enter RFID number...":
            messagebox.showwarning("Missing RFID", f"Please enter an RFID number (max {RFID_MAX_LENGTH} chars).")
            return
        
        if len(rfid) > RFID_MAX_LENGTH:
            messagebox.showwarning("RFID Too Long", f"RFID must be {RFID_MAX_LENGTH} characters or less.")
            return
        
        if not name or name == "Enter employee name...":
            messagebox.showwarning("Missing Name", "Please enter the employee name first.")
            return

        # Ask user to select images
        file_paths = filedialog.askopenfilenames(
            title=f"Select up to 5 Face Images for {name}",
            filetypes=[("Image files", "*.jpg *.jpeg *.png *.bmp")]
        )

        if not file_paths:
            return

        # Limit to 5 images
        if len(file_paths) > REQUIRED_SAMPLES:
            if not messagebox.askyesno("Too Many Images", 
                                       f"You selected {len(file_paths)} images.\n"
                                       f"Only the first {REQUIRED_SAMPLES} will be used.\n"
                                       "Continue?"):
                return
            file_paths = file_paths[:REQUIRED_SAMPLES]

        # Clear existing samples
        self.clear_previews()
        
        # Process images
        face_count = 0
        for file_path in file_paths:
            try:
                img = cv2.imread(file_path)
                if img is None:
                    continue

                # Detect faces
                gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
                faces = self.detect_faces(gray)

                if len(faces) == 0:
                    print(f"No faces detected in {os.path.basename(file_path)}")
                    continue

                # Take the first face
                x, y, w, h = faces[0]
                face = gray[y:y+h, x:x+w]
                face = cv2.resize(face, (100, 100))
                
                # Store the face
                self.sample_images.append(face)
                self.update_preview(face_count, face)
                face_count += 1

                # Update progress
                progress = int((face_count / REQUIRED_SAMPLES) * 100)
                self.progress['value'] = progress
                self.root.update()

            except Exception as e:
                print(f"Error processing {file_path}: {e}")

        self.update_status()
        
        if face_count < REQUIRED_SAMPLES:
            messagebox.showwarning("Incomplete", 
                                  f"Only {face_count} faces were detected.\n"
                                  f"Need {REQUIRED_SAMPLES} images.\n"
                                  "Please add more images or try different photos.")
            self.info_label.config(text=f"⚠️ Only {face_count}/{REQUIRED_SAMPLES} faces detected")
        else:
            self.info_label.config(text=f"✅ {face_count} face samples loaded for {name}")
            self.progress['value'] = 100
            messagebox.showinfo("Import Complete", 
                               f"Successfully loaded {face_count} face samples for\n"
                               f"{name} (RFID: {rfid})")

    def capture_from_camera(self):
        """Capture 5 images from camera (simple capture - no position guidance)"""
        # Check if RFID and Name are entered
        rfid = self.rfid_entry.get().strip()
        name = self.name_entry.get().strip()
        
        if not rfid or rfid == f"Enter RFID number (max {RFID_MAX_LENGTH} chars)..." or rfid == "Enter RFID number...":
            messagebox.showwarning("Missing RFID", f"Please enter an RFID number (max {RFID_MAX_LENGTH} chars).")
            return
        
        if len(rfid) > RFID_MAX_LENGTH:
            messagebox.showwarning("RFID Too Long", f"RFID must be {RFID_MAX_LENGTH} characters or less.")
            return
        
        if not name or name == "Enter employee name...":
            messagebox.showwarning("Missing Name", "Please enter the employee name first.")
            return

        # Open camera capture window
        capture_window = tk.Toplevel(self.root)
        capture_window.title("Capture 5 Face Images")
        capture_window.geometry("700x650")
        capture_window.configure(bg=COLORS["gray_50"])
        capture_window.transient(self.root)
        capture_window.grab_set()
        capture_window.resizable(False, False)

        # Main container
        main_container = tk.Frame(capture_window, bg=COLORS["gray_50"])
        main_container.pack(fill=tk.BOTH, expand=True, padx=20, pady=20)

        # Camera preview frame
        preview_frame = tk.Frame(main_container, bg=COLORS["white"], relief=tk.RAISED, bd=2)
        preview_frame.pack(fill=tk.BOTH, expand=True)

        # Camera preview canvas with fixed size
        preview_canvas = tk.Canvas(preview_frame, bg=COLORS["gray_100"], width=640, height=440)
        preview_canvas.pack(padx=10, pady=10)

        # Status bar frame
        status_frame = tk.Frame(main_container, bg=COLORS["gray_50"])
        status_frame.pack(fill=tk.X, pady=5)

        # Status label
        status_label = tk.Label(status_frame, text="Position your face and press 'Capture'", 
                               font=("Segoe UI", 11),
                               bg=COLORS["gray_50"], fg=COLORS["gray_600"])
        status_label.pack(side=tk.LEFT, padx=5)

        # Counter
        counter_label = tk.Label(status_frame, text="📸 0/5", 
                                font=("Segoe UI", 13, "bold"),
                                bg=COLORS["gray_50"], fg=COLORS["primary"])
        counter_label.pack(side=tk.RIGHT, padx=5)

        # Mini previews frame
        mini_frame = tk.Frame(main_container, bg=COLORS["gray_50"])
        mini_frame.pack(fill=tk.X, pady=5)
        
        mini_canvases = []
        for i in range(5):
            canvas = tk.Canvas(mini_frame, bg=COLORS["gray_200"], width=70, height=70,
                              relief=tk.RAISED, bd=2)
            canvas.pack(side=tk.LEFT, padx=6)
            canvas.create_text(35, 35, text=f"{i+1}", font=("Segoe UI", 9), fill=COLORS["gray_500"])
            mini_canvases.append(canvas)

        # Button frame
        btn_frame = tk.Frame(main_container, bg=COLORS["gray_50"])
        btn_frame.pack(fill=tk.X, pady=10)

        captured_images = []
        camera = None
        is_capturing = False

        def start_camera():
            nonlocal camera
            try:
                camera = cv2.VideoCapture(0)
                if not camera.isOpened():
                    messagebox.showerror("Camera Error", "Could not access camera.")
                    capture_window.destroy()
                    return
                # Set camera resolution
                camera.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
                camera.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
                update_preview()
            except Exception as e:
                messagebox.showerror("Camera Error", f"Could not access camera: {e}")
                capture_window.destroy()

        def update_preview():
            if camera is not None and camera.isOpened():
                ret, frame = camera.read()
                if ret:
                    # Mirror the frame
                    frame = cv2.flip(frame, 1)
                    
                    # Draw face detection
                    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
                    faces = self.detect_faces(gray)
                    
                    for (x, y, w, h) in faces:
                        cv2.rectangle(frame, (x, y), (x+w, y+h), (37, 99, 235), 2)
                        cv2.putText(frame, "Face Detected", (x, y-10), 
                                   cv2.FONT_HERSHEY_SIMPLEX, 0.6, (37, 99, 235), 2)
                        break  # Only draw first face

                    # If no face detected, show message
                    if len(faces) == 0:
                        cv2.putText(frame, "No Face Detected", (10, 30), 
                                   cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 255), 2)

                    # Resize to fit canvas
                    frame_resized = cv2.resize(frame, (640, 440))
                    
                    # Convert to RGB for display
                    rgb_frame = cv2.cvtColor(frame_resized, cv2.COLOR_BGR2RGB)
                    img = Image.fromarray(rgb_frame)
                    img_tk = ImageTk.PhotoImage(img)
                    
                    preview_canvas.delete("all")
                    preview_canvas.create_image(0, 0, anchor=tk.NW, image=img_tk)
                    preview_canvas.image = img_tk

                    # Update face detection status
                    if len(faces) > 0:
                        status_label.config(text="✅ Face Detected - Press Capture", fg=COLORS["success"])
                    else:
                        status_label.config(text="⚠️ No Face Detected - Please position your face", fg=COLORS["danger"])

                capture_window.after(50, update_preview)

        def capture_image():
            nonlocal captured_images, is_capturing
            if is_capturing:
                return
            if camera is not None and camera.isOpened():
                is_capturing = True
                ret, frame = camera.read()
                if ret:
                    # Detect face
                    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
                    faces = self.detect_faces(gray)
                    
                    if len(faces) == 0:
                        messagebox.showwarning("No Face", "No face detected. Please position your face clearly.")
                        is_capturing = False
                        return
                    
                    # Take the first face
                    x, y, w, h = faces[0]
                    face = gray[y:y+h, x:x+w]
                    face = cv2.resize(face, (100, 100))
                    captured_images.append(face)
                    
                    # Update counter
                    counter_label.config(text=f"📸 {len(captured_images)}/5")
                    status_label.config(text=f"✅ Captured {len(captured_images)}/5", fg=COLORS["success"])
                    
                    # Show in mini canvas
                    img = Image.fromarray(face)
                    img = img.resize((70, 70), Image.Resampling.LANCZOS)
                    img_tk = ImageTk.PhotoImage(img)
                    
                    idx = len(captured_images) - 1
                    mini_canvases[idx].delete("all")
                    mini_canvases[idx].create_image(35, 35, anchor=tk.CENTER, image=img_tk)
                    mini_canvases[idx].image = img_tk
                    
                    if len(captured_images) >= REQUIRED_SAMPLES:
                        status_label.config(text="✅ All 5 images captured!", fg=COLORS["success"])
                        capture_btn.config(state=tk.DISABLED)
                        finish_btn.config(state=tk.NORMAL)
                        
                        # Flash effect
                        preview_canvas.config(bg=COLORS["success_light"])
                        capture_window.after(500, lambda: preview_canvas.config(bg=COLORS["gray_100"]))
                else:
                    messagebox.showerror("Error", "Failed to capture image.")
                is_capturing = False

        def finish_capture():
            nonlocal camera
            if len(captured_images) == REQUIRED_SAMPLES:
                # Clear existing samples
                self.clear_previews()
                
                # Store captured images
                for i, face in enumerate(captured_images):
                    self.sample_images.append(face)
                    self.update_preview(i, face)
                
                if camera is not None:
                    camera.release()
                capture_window.destroy()
                
                self.update_status()
                self.info_label.config(text=f"✅ Captured 5 images for {name}")
                self.progress['value'] = 100
                messagebox.showinfo("Capture Complete", 
                                   f"Successfully captured 5 face images for\n"
                                   f"{name} (RFID: {rfid})")
            else:
                messagebox.showwarning("Incomplete", 
                                      f"Only captured {len(captured_images)}/5 images.\n"
                                      "Please capture all 5 images.")

        def on_close():
            nonlocal camera
            if camera is not None:
                camera.release()
            capture_window.destroy()

        # Buttons
        capture_btn = tk.Button(btn_frame, text="📸 Capture Face", 
                               command=capture_image,
                               font=("Segoe UI", 12, "bold"),
                               bg=COLORS["primary"], fg="white",
                               padx=25, pady=10, relief=tk.RAISED, cursor="hand2",
                               width=14, bd=2)
        capture_btn.pack(side=tk.LEFT, padx=5)

        finish_btn = tk.Button(btn_frame, text="✅ Finish (Save 5)", 
                              command=finish_capture,
                              font=("Segoe UI", 12, "bold"),
                              bg=COLORS["success"], fg="white",
                              padx=25, pady=10, relief=tk.RAISED, cursor="hand2",
                              state=tk.DISABLED, width=14, bd=2)
        finish_btn.pack(side=tk.LEFT, padx=5)

        cancel_btn = tk.Button(btn_frame, text="❌ Cancel", 
                              command=on_close,
                              font=("Segoe UI", 12, "bold"),
                              bg=COLORS["danger"], fg="white",
                              padx=25, pady=10, relief=tk.RAISED, cursor="hand2",
                              width=14, bd=2)
        cancel_btn.pack(side=tk.LEFT, padx=5)

        capture_window.protocol("WM_DELETE_WINDOW", on_close)
        start_camera()

    def export_tapin(self):
        """Export as .tapin file"""
        # Check if RFID and Name are entered
        rfid = self.rfid_entry.get().strip()
        name = self.name_entry.get().strip()
        
        if not rfid or rfid == f"Enter RFID number (max {RFID_MAX_LENGTH} chars)..." or rfid == "Enter RFID number...":
            messagebox.showwarning("Missing RFID", f"Please enter an RFID number (max {RFID_MAX_LENGTH} chars).")
            return
        
        if len(rfid) > RFID_MAX_LENGTH:
            messagebox.showwarning("RFID Too Long", f"RFID must be {RFID_MAX_LENGTH} characters or less.")
            return
        
        if not name or name == "Enter employee name...":
            messagebox.showwarning("Missing Name", "Please enter the employee name first.")
            return

        # Check if we have exactly 5 samples
        if len(self.sample_images) < REQUIRED_SAMPLES:
            messagebox.showwarning("Insufficient Samples", 
                                  f"Need {REQUIRED_SAMPLES} samples, but have {len(self.sample_images)}.\n"
                                  "Please import all 5 images.")
            return

        self.info_label.config(text="Training model...")
        self.progress['value'] = 0
        self.root.update()

        try:
            # Prepare training data
            faces = []
            labels = []
            
            for i, face in enumerate(self.sample_images):
                faces.append(cv2.resize(face, (100, 100)))
                labels.append(0)  # All faces belong to the same person
            
            self.progress['value'] = 30
            self.root.update()
            
            # Train the recognizer
            self.recognizer = cv2.face.LBPHFaceRecognizer_create()
            self.recognizer.train(faces, np.array(labels))
            
            self.progress['value'] = 60
            self.root.update()
            
            # Build unified model
            model_data = {
                "meta": {
                    "version": "1.0",
                    "created_date": datetime.now().isoformat(),
                    "rfid": rfid,
                    "total_samples": len(faces),
                    "employee_info": {
                        "name": name,
                        "rfid": rfid,
                        "created": datetime.now().isoformat()
                    }
                },
                "employee_info": {
                    "name": name,
                    "rfid": rfid,
                    "created": datetime.now().isoformat()
                }
            }
            
            # Store face recognizer data
            temp_file = os.path.join(MODELS_DIR, "temp_model.yml")
            self.recognizer.save(temp_file)
            with open(temp_file, 'rb') as f:
                model_data["face_recognizer"] = f.read()
            os.remove(temp_file)
            
            self.progress['value'] = 80
            self.root.update()
            
            # Export as .tapin file with RFID as filename
            filename = f"{rfid}{MODEL_EXTENSION}"
            filepath = os.path.join(MODELS_DIR, filename)
            
            # Save the model
            with open(filepath, 'wb') as f:
                pickle.dump(model_data, f)
            
            self.progress['value'] = 100
            self.root.update()
            
            # Update status
            self.info_label.config(text=f"✅ Model exported as {filename}")
            self.status_indicator.config(text="● Exported!", fg=COLORS["success_light"])
            
            messagebox.showinfo("Export Complete", 
                               f"✅ Model successfully exported!\n\n"
                               f"📁 File: {filename}\n"
                               f"📍 Location: {MODELS_DIR}\n"
                               f"👤 Employee: {name}\n"
                               f"🔑 RFID: {rfid}\n\n"
                               f"This file can now be used with the attendance system.")
            
            # Ask if user wants to clear and start over
            if messagebox.askyesno("Start Over", 
                                  "Do you want to clear the samples and start a new model?"):
                self.clear_previews()
                self.rfid_entry.delete(0, tk.END)
                self.rfid_entry.insert(0, f"Enter RFID number (max {RFID_MAX_LENGTH} chars)...")
                self.name_entry.delete(0, tk.END)
                self.name_entry.insert(0, "Enter employee name...")
                self.info_label.config(text="Ready for next employee")
                self.progress['value'] = 0
                self.status_indicator.config(text="● Ready", fg=COLORS["success_light"])
            
        except Exception as e:
            self.info_label.config(text=f"❌ Error: {e}")
            messagebox.showerror("Export Error", f"Error exporting model:\n{e}")
            self.progress['value'] = 0

    def clear_samples(self):
        """Clear all sample previews"""
        if self.sample_images:
            if messagebox.askyesno("Clear Samples", 
                                  "This will clear all loaded face samples.\n"
                                  "Are you sure?"):
                self.clear_previews()
                self.progress['value'] = 0
                self.info_label.config(text="Samples cleared. Import 5 new images.")
                self.status_indicator.config(text="● Ready", fg=COLORS["success_light"])

    def on_closing(self):
        """Clean up and close the application"""
        if self.is_closing:
            return
        
        self.is_closing = True
        
        try:
            self.root.quit()
            self.root.destroy()
        except Exception as e:
            print(f"Error during closing: {e}")
            sys.exit(0)


def main():
    """Main entry point"""
    root = tk.Tk()
    app = FaceModelTrainer(root)
    root.mainloop()


if __name__ == "__main__":
    main()