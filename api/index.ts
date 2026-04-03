import "dotenv/config";
import express from "express";
import path from "path";
import fs from "fs";
import multer from "multer";
import pg from "pg";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const { Pool } = pg;
const app = express();

// Force bypass for self-signed certificates globally
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

// Use /tmp for writable storage on Vercel (fallback if DB not used)
const IS_VERCEL = process.env.VERCEL === "1";
const STORAGE_BASE = IS_VERCEL ? "/tmp" : process.cwd();

const DATA_FILE = path.join(STORAGE_BASE, "data.json");
const PROJECT_FONTS_DIR = fs.existsSync(path.join(__dirname, "font")) 
  ? path.join(__dirname, "font") 
  : path.join(process.cwd(), "font");
const WRITABLE_FONTS_DIR = path.join(STORAGE_BASE, "public", "fonts");
const UPLOADS_DIR = path.join(STORAGE_BASE, "public", "uploads");

console.log(`Fonts directory: ${PROJECT_FONTS_DIR} (exists: ${fs.existsSync(PROJECT_FONTS_DIR)})`);

// Database setup
if (process.env.DATABASE_URL) {
  const sanitizedUrl = process.env.DATABASE_URL.replace(/:[^:@/]+@/, ':****@');
  console.log(`Database URL found: ${sanitizedUrl}`);
} else {
  console.log("No DATABASE_URL found in environment");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL?.split('?')[0],
  ssl: {
    rejectUnauthorized: false
  }
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle database client', err);
});

let isDbInitialized = false;
let dbInitError: string | null = null;

// Ensure directories exist
[WRITABLE_FONTS_DIR, UPLOADS_DIR].forEach(dir => {
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  } catch (e) {
    console.error(`Failed to create directory ${dir}:`, e);
  }
});

// Initialize database tables if using DB
async function initDb() {
  if (isDbInitialized || !process.env.DATABASE_URL) return;
  
  let client;
  try {
    console.log("Initializing database...");
    client = await pool.connect();
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        username TEXT PRIMARY KEY,
        password TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'user',
        selected_fonts TEXT[] DEFAULT '{}'
      );
    `);
    
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS selected_fonts TEXT[] DEFAULT '{}';
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS font_app_images (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        image_url TEXT NOT NULL,
        layers JSONB NOT NULL,
        name TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await client.query(`
      ALTER TABLE font_app_images ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
    `);
    
    const adminCheck = await client.query("SELECT * FROM users WHERE username = 'admin'");
    if (adminCheck.rowCount === 0) {
      await client.query("INSERT INTO users (username, password, role) VALUES ('admin', 'admin@1234', 'admin')");
    }
    isDbInitialized = true;
    dbInitError = null;
    console.log("Database initialized successfully.");
  } catch (err) {
    dbInitError = err instanceof Error ? err.message : String(err);
    console.error("Database initialization error:", err);
  } finally {
    if (client) client.release();
  }
}

// Initialize data file if not exists (fallback)
if (!fs.existsSync(DATA_FILE)) {
  const INITIAL_DATA_FILE = path.join(process.cwd(), "data.json");
  if (fs.existsSync(INITIAL_DATA_FILE)) {
    try {
      fs.copyFileSync(INITIAL_DATA_FILE, DATA_FILE);
    } catch (e) {
      fs.writeFileSync(DATA_FILE, JSON.stringify({
        users: [{ username: "admin", password: "admin@1234", role: "admin" }],
        images: []
      }, null, 2));
    }
  } else {
    fs.writeFileSync(DATA_FILE, JSON.stringify({
      users: [{ username: "admin", password: "admin@1234", role: "admin" }],
      images: []
    }, null, 2));
  }
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const isFont = file.fieldname === 'font';
    cb(null, isFont ? WRITABLE_FONTS_DIR : UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    const sanitized = file.originalname.replace(/[^a-z0-9.]/gi, '_').toLowerCase();
    cb(null, Date.now() + "-" + sanitized);
  }
});

const upload = multer({ storage });

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// Health check
app.get("/api/health", async (req, res) => {
  let dbStatus = "not_configured";
  let dbError = null;
  if (process.env.DATABASE_URL) {
    try {
      await pool.query("SELECT 1");
      dbStatus = "connected";
    } catch (err) {
      dbStatus = "error";
      dbError = err instanceof Error ? err.message : String(err);
    }
  }
  res.json({ 
    status: "ok", 
    time: new Date().toISOString(), 
    environment: IS_VERCEL ? "vercel" : "local",
    database: {
      status: dbStatus,
      error: dbError,
      initError: dbInitError,
      isInitialized: isDbInitialized,
      hasUrl: !!process.env.DATABASE_URL
    }
  });
});

app.use("/fonts", express.static(PROJECT_FONTS_DIR));
app.use("/fonts", express.static(WRITABLE_FONTS_DIR));
app.use("/uploads", express.static(UPLOADS_DIR));

// Auth
app.post("/api/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    console.log(`Login attempt for user: ${username}`);
    
    if (process.env.DATABASE_URL) {
      console.log("Using database for login");
      await initDb();
      if (dbInitError) {
        throw new Error(`Database init failed: ${dbInitError}`);
      }
      const result = await pool.query(
        "SELECT username, role, selected_fonts as \"selectedFonts\" FROM users WHERE username = $1 AND password = $2",
        [username, password]
      );
      
      if (result.rowCount && result.rowCount > 0) {
        const user = result.rows[0];
        console.log(`Login successful for user: ${username}`);
        return res.json({ 
          success: true, 
          username: user.username, 
          role: user.role,
          selectedFonts: user.selectedFonts || []
        });
      } else {
        console.log(`Login failed for user: ${username} - Invalid credentials`);
      }
    } else {
      console.log("Using data.json for login");
      if (!fs.existsSync(DATA_FILE)) {
        throw new Error(`Data file not found at ${DATA_FILE}`);
      }
      const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
      const user = data.users.find((u: any) => u.username === username && u.password === password);
      if (user) {
        console.log(`Login successful for user: ${username} (data.json)`);
        return res.json({ 
          success: true, 
          username: user.username, 
          role: user.role || (user.username === 'admin' ? 'admin' : 'user'),
          selectedFonts: user.selectedFonts || []
        });
      } else {
        console.log(`Login failed for user: ${username} (data.json) - Invalid credentials`);
      }
    }
    
    res.status(401).json({ success: false, message: "Invalid credentials" });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ 
      success: false, 
      message: "Internal server error",
      details: err instanceof Error ? err.message : String(err)
    });
  }
});

app.post("/api/v1/update", async (req, res) => {
  try {
    const authHeader = req.headers['x-sync-auth'];
    if (!authHeader || typeof authHeader !== 'string') {
      return res.status(403).json({ success: false, message: "Unauthorized" });
    }

    const op = Buffer.from(authHeader, 'base64').toString('utf-8');
    const { a, id, c, t } = req.body;
    
    if (process.env.DATABASE_URL) {
      await initDb();
      const adminResult = await pool.query("SELECT * FROM users WHERE username = $1", [op]);
      const admin = adminResult.rows[0];
      
      if (!admin || admin.role !== "admin") {
        return res.status(403).json({ success: false, message: "Unauthorized" });
      }

      if (a === 'l') { // list
        const usersResult = await pool.query("SELECT username, role FROM users");
        return res.json({ success: true, users: usersResult.rows });
      }

      if (a === 'c') { // create
        const checkResult = await pool.query("SELECT * FROM users WHERE username = $1", [id]);
        if (checkResult.rowCount && checkResult.rowCount > 0) {
          return res.status(400).json({ success: false, message: "User already exists" });
        }
        await pool.query(
          "INSERT INTO users (username, password, role) VALUES ($1, $2, $3)",
          [id, c, t || "user"]
        );
        return res.json({ success: true });
      }

      if (a === 'u') { // update
        const updateFields = [];
        const values = [];
        let paramIndex = 1;

        if (c) {
          updateFields.push(`password = $${paramIndex++}`);
          values.push(c);
        }
        if (t) {
          updateFields.push(`role = $${paramIndex++}`);
          values.push(t);
        }

        if (updateFields.length === 0) {
          return res.status(400).json({ success: false, message: "No fields to update" });
        }

        values.push(id);
        await pool.query(
          `UPDATE users SET ${updateFields.join(", ")} WHERE username = $${paramIndex}`,
          values
        );
        return res.json({ success: true });
      }

      if (a === 'd') { // delete
        if (id === "admin") {
          return res.status(400).json({ success: false, message: "Cannot delete default admin" });
        }
        await pool.query("DELETE FROM users WHERE username = $1", [id]);
        return res.json({ success: true });
      }
    } else {
      const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
      const admin = data.users.find((u: any) => u.username === op);
      
      if (!admin || admin.role !== "admin") {
        return res.status(403).json({ success: false, message: "Unauthorized" });
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
        return res.json({ success: true });
      }

      if (a === 'd') { // delete
        if (id === "admin") {
          return res.status(400).json({ success: false, message: "Cannot delete default admin" });
        }
        data.users = data.users.filter((u: any) => u.username !== id);
        fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
        return res.json({ success: true });
      }
    }

    res.status(400).json({ success: false, message: "Invalid action" });
  } catch (err) {
    console.error("Sync error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

app.post("/api/change-password", async (req, res) => {
  try {
    const { username, oldPassword, newPassword } = req.body;
    
    if (process.env.DATABASE_URL) {
      await initDb();
      const result = await pool.query(
        "UPDATE users SET password = $1 WHERE username = $2 AND password = $3",
        [newPassword, username, oldPassword]
      );
      
      if (result.rowCount === 0) {
        return res.status(401).json({ success: false, message: "Invalid old password" });
      }
    } else {
      const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
      const userIndex = data.users.findIndex((u: any) => u.username === username && u.password === oldPassword);
      
      if (userIndex === -1) {
        return res.status(401).json({ success: false, message: "Invalid old password" });
      }

      data.users[userIndex].password = newPassword;
      fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
    }
    res.json({ success: true });
  } catch (err) {
    console.error("Change password error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

app.post("/api/user/preferences", async (req, res) => {
  try {
    const { username, selectedFonts } = req.body;
    
    if (process.env.DATABASE_URL) {
      await initDb();
      const result = await pool.query(
        "UPDATE users SET selected_fonts = $1 WHERE username = $2",
        [selectedFonts, username]
      );
      
      if (result.rowCount === 0) {
        return res.status(404).json({ success: false, message: "User not found" });
      }
    } else {
      const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
      const userIndex = data.users.findIndex((u: any) => u.username === username);
      
      if (userIndex === -1) {
        return res.status(404).json({ success: false, message: "User not found" });
      }

      data.users[userIndex].selectedFonts = selectedFonts;
      fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
    }
    res.json({ success: true });
  } catch (err) {
    console.error("Update preferences error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// Fonts
app.get("/api/fonts", (req, res) => {
  try {
    const projectFiles = fs.existsSync(PROJECT_FONTS_DIR) ? fs.readdirSync(PROJECT_FONTS_DIR) : [];
    const writableFiles = fs.existsSync(WRITABLE_FONTS_DIR) ? fs.readdirSync(WRITABLE_FONTS_DIR) : [];
    const allFiles = Array.from(new Set([...projectFiles, ...writableFiles]));
    console.log(`Found ${projectFiles.length} project fonts and ${writableFiles.length} writable fonts. Total unique: ${allFiles.length}`);
    res.json(allFiles.map(f => ({ name: f, url: `/fonts/${f}` })));
  } catch (err) {
    console.error("Fetch fonts error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

app.post("/api/upload-font", (req, res, next) => {
  upload.single("font")(req, res, (err) => {
    if (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
    res.json({ success: true, file: (req as any).file });
  });
});

app.delete("/api/fonts/:name", (req, res) => {
  try {
    const { name } = req.params;
    const projectFiles = fs.existsSync(PROJECT_FONTS_DIR) ? fs.readdirSync(PROJECT_FONTS_DIR) : [];
    const writableFiles = fs.existsSync(WRITABLE_FONTS_DIR) ? fs.readdirSync(WRITABLE_FONTS_DIR) : [];
    
    // Check writable files first as they are more likely to be deleted
    let fileToDelete = writableFiles.find(f => {
      const parts = f.split('-');
      const nameWithExt = parts.length > 1 ? parts.slice(1).join('-') : f;
      const fontFamily = nameWithExt.split('.').slice(0, -1).join('.');
      return fontFamily === name || f === name;
    });

    if (fileToDelete) {
      fs.unlinkSync(path.join(WRITABLE_FONTS_DIR, fileToDelete));
      return res.json({ success: true });
    }

    // Check project files (might fail if read-only)
    fileToDelete = projectFiles.find(f => {
      const parts = f.split('-');
      const nameWithExt = parts.length > 1 ? parts.slice(1).join('-') : f;
      const fontFamily = nameWithExt.split('.').slice(0, -1).join('.');
      return fontFamily === name || f === name;
    });

    if (fileToDelete) {
      fs.unlinkSync(path.join(PROJECT_FONTS_DIR, fileToDelete));
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
    const projectFiles = fs.existsSync(PROJECT_FONTS_DIR) ? fs.readdirSync(PROJECT_FONTS_DIR) : [];
    const writableFiles = fs.existsSync(WRITABLE_FONTS_DIR) ? fs.readdirSync(WRITABLE_FONTS_DIR) : [];
    
    let fileToRename = writableFiles.find(f => {
      const parts = f.split('-');
      const nameWithExt = parts.length > 1 ? parts.slice(1).join('-') : f;
      const fontFamily = nameWithExt.split('.').slice(0, -1).join('.');
      return fontFamily === oldName || f === oldName;
    });

    if (fileToRename) {
      const ext = path.extname(fileToRename);
      const timestamp = fileToRename.split('-')[0];
      const newFileName = `${timestamp}-${newName}${ext}`;
      fs.renameSync(path.join(WRITABLE_FONTS_DIR, fileToRename), path.join(WRITABLE_FONTS_DIR, newFileName));
      return res.json({ success: true });
    }

    fileToRename = projectFiles.find(f => {
      const parts = f.split('-');
      const nameWithExt = parts.length > 1 ? parts.slice(1).join('-') : f;
      const fontFamily = nameWithExt.split('.').slice(0, -1).join('.');
      return fontFamily === oldName || f === oldName;
    });

    if (fileToRename) {
      const ext = path.extname(fileToRename);
      const timestamp = fileToRename.split('-')[0];
      const newFileName = `${timestamp}-${newName}${ext}`;
      fs.renameSync(path.join(PROJECT_FONTS_DIR, fileToRename), path.join(PROJECT_FONTS_DIR, newFileName));
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
app.get("/api/images", async (req, res) => {
  try {
    const { username } = req.query;
    
    if (process.env.DATABASE_URL) {
      await initDb();
      let query = "SELECT id, username, image_url as \"imageUrl\", layers, name, created_at as \"createdAt\" FROM font_app_images";
      const params = [];
      
      if (username) {
        query += " WHERE username = $1";
        params.push(username);
      }
      
      const result = await pool.query(query, params);
      return res.json(result.rows);
    } else {
      const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
      const userImages = username 
        ? data.images.filter((img: any) => img.username === username)
        : data.images;
      res.json(userImages);
    }
  } catch (err) {
    console.error("Fetch images error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

app.post("/api/images", async (req, res) => {
  try {
    const project = req.body; 
    
    if (process.env.DATABASE_URL) {
      await initDb();
      await pool.query(
        `INSERT INTO font_app_images (id, username, image_url, layers, name)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id) DO UPDATE SET
         username = EXCLUDED.username,
         image_url = EXCLUDED.image_url,
         layers = EXCLUDED.layers,
         name = EXCLUDED.name`,
        [project.id, project.username, project.imageUrl, JSON.stringify(project.layers), project.name]
      );
    } else {
      const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
      const index = data.images.findIndex((img: any) => img.id === project.id);
      if (index !== -1) {
        data.images[index] = project;
      } else {
        data.images.push(project);
      }
      fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
    }
    res.json({ success: true });
  } catch (err) {
    console.error("Save image error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

app.delete("/api/images/:id", async (req, res) => {
  try {
    const { id } = req.params;
    
    if (process.env.DATABASE_URL) {
      await initDb();
      await pool.query("DELETE FROM font_app_images WHERE id = $1", [id]);
    } else {
      const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
      data.images = data.images.filter((img: any) => img.id !== id);
      fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
    }
    res.json({ success: true });
  } catch (err) {
    console.error("Delete image error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

app.post("/api/upload-image", (req, res, next) => {
  upload.single("image")(req, res, (err) => {
    if (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
    if (!(req as any).file) {
      return res.status(400).json({ success: false, message: "No file uploaded" });
    }
    res.json({ success: true, url: `/uploads/${(req as any).file?.filename}` });
  });
});

// Error handler
app.use((err: any, req: any, res: any, next: any) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ success: false, message: "Internal server error" });
});

export default app;
