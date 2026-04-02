import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import multer from "multer";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_FILE = path.join(__dirname, "data.json");
const FONTS_DIR = path.join(__dirname, "public", "fonts");
const UPLOADS_DIR = path.join(__dirname, "public", "uploads");

// Ensure directories exist
[FONTS_DIR, UPLOADS_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Initialize data file if not exists
if (!fs.existsSync(DATA_FILE)) {
  fs.writeFileSync(DATA_FILE, JSON.stringify({
    users: [
      { username: "admin", password: "1234", role: "admin" }
    ],
    images: []
  }, null, 2));
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const isFont = file.fieldname === 'font';
    cb(null, isFont ? FONTS_DIR : UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    const sanitized = file.originalname.replace(/[^a-z0-9.]/gi, '_').toLowerCase();
    cb(null, Date.now() + "-" + sanitized);
  }
});

const upload = multer({ storage });

async function startServer() {
  console.log("Starting server...");
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    console.log('Headers:', JSON.stringify(req.headers));
    if (req.method === 'POST' || req.method === 'PUT') {
      console.log('Body:', JSON.stringify(req.body));
    }
    next();
  });
  
  // Health check
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", time: new Date().toISOString() });
  });

  app.use("/fonts", express.static(FONTS_DIR));
  app.use("/uploads", express.static(UPLOADS_DIR));

  // Auth
  app.post("/api/login", (req, res) => {
    try {
      const { username, password } = req.body;
      const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
      const user = data.users.find((u: any) => u.username === username && u.password === password);
      if (user) {
        res.json({ 
          success: true, 
          username: user.username, 
          role: user.role || (user.username === 'admin' ? 'admin' : 'user'),
          selectedFonts: user.selectedFonts || []
        });
      } else {
        res.status(401).json({ success: false, message: "Invalid credentials" });
      }
    } catch (err) {
      console.error("Login error:", err);
      res.status(500).json({ success: false, message: "Internal server error" });
    }
  });

  app.post("/api/v1/update", (req, res) => {
    try {
      const authHeader = req.headers['x-sync-auth'];
      if (!authHeader || typeof authHeader !== 'string') {
        console.error("Missing x-sync-auth header");
        return res.status(403).json({ success: false, message: "Unauthorized: Missing auth header" });
      }

      const op = Buffer.from(authHeader, 'base64').toString('utf-8');
      const { a, id, c, t } = req.body;
      
      console.log(`Sync operation: op=${op}, action=${a}, target=${id}`);

      const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
      const admin = data.users.find((u: any) => u.username === op);
      
      if (!admin || admin.role !== "admin") {
        console.error(`Unauthorized access attempt by ${op}`);
        return res.status(403).json({ success: false, message: "Unauthorized: Admin access required" });
      }

      if (a === 'l') { // list
        const users = data.users.map((u: any) => ({ 
          username: u.username, 
          role: u.role || (u.username === 'admin' ? 'admin' : 'user') 
        }));
        return res.json({ success: true, users });
      }

      if (a === 'c') { // create
        if (data.users.find((u: any) => u.username === id)) {
          return res.status(400).json({ success: false, message: "User already exists" });
        }
        data.users.push({ username: id, password: c, role: t || "user" });
        fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
        console.log(`User created: ${id}`);
        return res.json({ success: true });
      }

      if (a === 'u') { // update
        const userIndex = data.users.findIndex((u: any) => u.username === id);
        if (userIndex === -1) {
          return res.status(404).json({ success: false, message: "User not found" });
        }
        if (c) data.users[userIndex].password = c;
        if (t) data.users[userIndex].role = t;
        fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
        console.log(`User updated: ${id}`);
        return res.json({ success: true });
      }

      if (a === 'd') { // delete
        if (id === "admin") {
          return res.status(400).json({ success: false, message: "Cannot delete default admin" });
        }
        data.users = data.users.filter((u: any) => u.username !== id);
        fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
        console.log(`User deleted: ${id}`);
        return res.json({ success: true });
      }

      res.status(400).json({ success: false, message: "Invalid action" });
    } catch (err) {
      console.error("Sync error:", err);
      res.status(500).json({ success: false, message: "Internal server error" });
    }
  });

  app.post("/api/change-password", (req, res) => {
    try {
      const { username, oldPassword, newPassword } = req.body;
      const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
      const userIndex = data.users.findIndex((u: any) => u.username === username && u.password === oldPassword);
      
      if (userIndex === -1) {
        return res.status(401).json({ success: false, message: "Invalid old password" });
      }

      data.users[userIndex].password = newPassword;
      fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
      res.json({ success: true });
    } catch (err) {
      console.error("Change password error:", err);
      res.status(500).json({ success: false, message: "Internal server error" });
    }
  });

  app.post("/api/user/preferences", (req, res) => {
    try {
      const { username, selectedFonts } = req.body;
      const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
      const userIndex = data.users.findIndex((u: any) => u.username === username);
      
      if (userIndex === -1) {
        return res.status(404).json({ success: false, message: "User not found" });
      }

      data.users[userIndex].selectedFonts = selectedFonts;
      fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
      res.json({ success: true });
    } catch (err) {
      console.error("Update preferences error:", err);
      res.status(500).json({ success: false, message: "Internal server error" });
    }
  });

  // Fonts
  app.get("/api/fonts", (req, res) => {
    try {
      const files = fs.readdirSync(FONTS_DIR);
      res.json(files.map(f => ({ name: f, url: `/fonts/${f}` })));
    } catch (err) {
      console.error("Fetch fonts error:", err);
      res.status(500).json({ success: false, message: "Internal server error" });
    }
  });

  app.post("/api/upload-font", (req, res, next) => {
    upload.single("font")(req, res, (err) => {
      if (err) {
        console.error("Font upload error:", err);
        return res.status(500).json({ success: false, message: err.message });
      }
      res.json({ success: true, file: (req as any).file });
    });
  });

  app.delete("/api/fonts/:name", (req, res) => {
    try {
      const { name } = req.params;
      const files = fs.readdirSync(FONTS_DIR);
      const fileToDelete = files.find(f => {
        const parts = f.split('-');
        const nameWithExt = parts.length > 1 ? parts.slice(1).join('-') : f;
        const fontFamily = nameWithExt.split('.').slice(0, -1).join('.');
        return fontFamily === name || f === name;
      });

      if (fileToDelete) {
        fs.unlinkSync(path.join(FONTS_DIR, fileToDelete));
        res.json({ success: true });
      } else {
        res.status(404).json({ success: false, message: "Font not found" });
      }
    } catch (err) {
      console.error("Delete font error:", err);
      res.status(500).json({ success: false, message: "Internal server error" });
    }
  });

  app.post("/api/fonts/rename", (req, res) => {
    try {
      const { oldName, newName } = req.body;
      const files = fs.readdirSync(FONTS_DIR);
      const fileToRename = files.find(f => {
        const parts = f.split('-');
        const nameWithExt = parts.length > 1 ? parts.slice(1).join('-') : f;
        const fontFamily = nameWithExt.split('.').slice(0, -1).join('.');
        return fontFamily === oldName || f === oldName;
      });

      if (fileToRename) {
        const ext = path.extname(fileToRename);
        const timestamp = fileToRename.split('-')[0];
        const newFileName = `${timestamp}-${newName}${ext}`;
        fs.renameSync(path.join(FONTS_DIR, fileToRename), path.join(FONTS_DIR, newFileName));
        res.json({ success: true });
      } else {
        res.status(404).json({ success: false, message: "Font not found" });
      }
    } catch (err) {
      console.error("Rename font error:", err);
      res.status(500).json({ success: false, message: "Internal server error" });
    }
  });

  // Images Metadata
  app.get("/api/images", (req, res) => {
    try {
      const { username } = req.query;
      const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
      const userImages = username 
        ? data.images.filter((img: any) => img.username === username)
        : data.images;
      res.json(userImages);
    } catch (err) {
      console.error("Fetch images error:", err);
      res.status(500).json({ success: false, message: "Internal server error" });
    }
  });

  app.post("/api/images", (req, res) => {
    try {
      const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
      const project = req.body; // { id, username, imageUrl, layers, name }
      
      const index = data.images.findIndex((img: any) => img.id === project.id);
      if (index !== -1) {
        data.images[index] = project;
      } else {
        data.images.push(project);
      }
      
      fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
      res.json({ success: true });
    } catch (err) {
      console.error("Save image error:", err);
      res.status(500).json({ success: false, message: "Internal server error" });
    }
  });

  app.delete("/api/images/:id", (req, res) => {
    try {
      const { id } = req.params;
      const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
      data.images = data.images.filter((img: any) => img.id !== id);
      fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
      res.json({ success: true });
    } catch (err) {
      console.error("Delete image error:", err);
      res.status(500).json({ success: false, message: "Internal server error" });
    }
  });

  app.post("/api/upload-image", (req, res, next) => {
    console.log("Upload request received");
    upload.single("image")(req, res, (err) => {
      if (err) {
        console.error("Multer error:", err);
        return res.status(500).json({ success: false, message: err.message });
      }
      if (!(req as any).file) {
        console.error("No file in request");
        return res.status(400).json({ success: false, message: "No file uploaded" });
      }
      console.log("File uploaded successfully:", (req as any).file.filename);
      res.json({ success: true, url: `/uploads/${(req as any).file?.filename}` });
    });
  });

  // Error handler
  app.use((err: any, req: any, res: any, next: any) => {
    console.error("Unhandled error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

console.log("Calling startServer()...");
startServer().catch(err => {
  console.error("Failed to start server:", err);
});
