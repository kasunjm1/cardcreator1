import "dotenv/config";
import express from "express";
import path from "path";
import fs from "fs";
import multer from "multer";
import pg from "pg";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const { Pool } = pg;
const app = express();

// Force bypass for self-signed certificates globally
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

// Use /tmp for writable storage on Vercel (fallback if DB not used)
const IS_VERCEL = process.env.VERCEL === "1";
const STORAGE_BASE = IS_VERCEL ? "/tmp" : process.cwd();
const DATA_FILE = path.resolve(STORAGE_BASE, "data.json");

const PROJECT_FONTS_DIR = [
  path.join(process.cwd(), "api", "font"),
  path.join(__dirname, "font"),
  path.join(process.cwd(), "font"),
  "/var/task/api/font",
  "/var/task/font"
].find(dir => fs.existsSync(dir)) || path.join(process.cwd(), "api", "font");

const WRITABLE_FONTS_DIR = path.resolve(STORAGE_BASE, "public", "fonts");
const UPLOADS_DIR = path.resolve(STORAGE_BASE, "public", "uploads");

// Supabase setup
const supabaseUrl = process.env.SUPABASE_URL || "";
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || "";
const supabase = (supabaseUrl && supabaseAnonKey) ? createClient(supabaseUrl, supabaseAnonKey) : null;
const FONTS_BUCKET = "fonts";

console.log(`__dirname: ${__dirname}`);
console.log(`process.cwd(): ${process.cwd()}`);
console.log(`Resolved PROJECT_FONTS_DIR: ${PROJECT_FONTS_DIR} (exists: ${fs.existsSync(PROJECT_FONTS_DIR)})`);
if (fs.existsSync(PROJECT_FONTS_DIR)) {
  console.log(`Files in PROJECT_FONTS_DIR: ${fs.readdirSync(PROJECT_FONTS_DIR).join(", ")}`);
}

// Database setup
const HAS_POSTGRES = !!process.env.DATABASE_URL;
const HAS_SUPABASE = !!process.env.SUPABASE_URL && !!process.env.SUPABASE_ANON_KEY;

if (HAS_POSTGRES) {
  const sanitizedUrl = process.env.DATABASE_URL!.replace(/:[^:@/]+@/, ':****@');
  console.log(`Postgres Database URL found: ${sanitizedUrl}`);
} else if (HAS_SUPABASE) {
  console.log("Supabase configured for database fallback");
} else {
  console.log("No remote database configured, falling back to data.json");
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
  if (isDbInitialized) return;
  
  if (HAS_POSTGRES) {
    let client;
    try {
      console.log("Initializing Postgres database...");
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
      console.log("Postgres database initialized successfully.");
    } catch (err) {
      dbInitError = err instanceof Error ? err.message : String(err);
      console.error("Postgres initialization error:", err);
    } finally {
      if (client) client.release();
    }
  } else if (HAS_SUPABASE) {
    try {
      console.log("Initializing Supabase database (checking tables)...");
      // In Supabase, we assume tables are created via SQL editor or we can try to check/create them
      // For now, we'll just mark as initialized and handle errors during queries
      isDbInitialized = true;
      dbInitError = null;
    } catch (err) {
      dbInitError = err instanceof Error ? err.message : String(err);
      console.error("Supabase initialization error:", err);
    }
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

const storage = multer.memoryStorage();
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

// Explicit font serving route for Vercel
app.get("/fonts/:name", (req, res) => {
  const { name } = req.params;
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  const projectPath = path.join(PROJECT_FONTS_DIR, name);
  const writablePath = path.join(WRITABLE_FONTS_DIR, name);
  const fallbackPath = path.join(process.cwd(), "api", "font", name);
  
  if (fs.existsSync(projectPath)) {
    return res.sendFile(projectPath);
  }
  if (fs.existsSync(writablePath)) {
    return res.sendFile(writablePath);
  }
  if (fs.existsSync(fallbackPath)) {
    return res.sendFile(fallbackPath);
  }
  res.status(404).send("Font not found");
});

// Auth
app.post("/api/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    console.log(`Login attempt for user: ${username}`);
    
    if (HAS_POSTGRES) {
      console.log("Using Postgres for login");
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
      }
    } else if (HAS_SUPABASE) {
      console.log("Using Supabase for login");
      const { data, error } = await supabase
        .from('users')
        .select('username, role, selected_fonts')
        .eq('username', username)
        .eq('password', password)
        .single();
      
      if (data) {
        console.log(`Login successful for user: ${username} (Supabase)`);
        return res.json({ 
          success: true, 
          username: data.username, 
          role: data.role,
          selectedFonts: data.selected_fonts || []
        });
      }
      if (error && error.code !== 'PGRST116') {
        console.error("Supabase login error:", error);
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

app.get("/api/debug-fs", (req, res) => {
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  const debugInfo = {
    __dirname,
    cwd: process.cwd(),
    PROJECT_FONTS_DIR,
    WRITABLE_FONTS_DIR,
    projectFontsExist: fs.existsSync(PROJECT_FONTS_DIR),
    projectFonts: fs.existsSync(PROJECT_FONTS_DIR) ? fs.readdirSync(PROJECT_FONTS_DIR) : [],
    writableFontsExist: fs.existsSync(WRITABLE_FONTS_DIR),
    writableFonts: fs.existsSync(WRITABLE_FONTS_DIR) ? fs.readdirSync(WRITABLE_FONTS_DIR) : [],
    apiFontDir: path.join(process.cwd(), "api", "font"),
    apiFontDirExists: fs.existsSync(path.join(process.cwd(), "api", "font")),
    apiFontDirFiles: fs.existsSync(path.join(process.cwd(), "api", "font")) ? fs.readdirSync(path.join(process.cwd(), "api", "font")) : []
  };
  res.json(debugInfo);
});

// Fonts
app.get("/api/fonts", async (req, res) => {
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  try {
    // 1. Get local project fonts (pre-installed)
    const projectFiles = fs.existsSync(PROJECT_FONTS_DIR) ? fs.readdirSync(PROJECT_FONTS_DIR) : [];
    const projectFonts = projectFiles.map(f => ({ name: f, url: `/fonts/${f}` }));

    // 2. Get Supabase fonts
    let supabaseFonts: any[] = [];
    if (supabase) {
      const { data, error } = await supabase.storage.from(FONTS_BUCKET).list();
      if (error) {
        console.error("Supabase storage list error:", error);
      } else if (data) {
        supabaseFonts = data.map((f: any) => {
          const { data: { publicUrl } } = supabase.storage.from(FONTS_BUCKET).getPublicUrl(f.name);
          return { name: f.name, url: publicUrl };
        });
      }
    }

    // 3. Get local writable fonts (legacy/fallback)
    const writableFiles = fs.existsSync(WRITABLE_FONTS_DIR) ? fs.readdirSync(WRITABLE_FONTS_DIR) : [];
    const writableFonts = writableFiles.map(f => ({ name: f, url: `/fonts/${f}` }));

    const allFonts = [...projectFonts, ...supabaseFonts, ...writableFonts];
    
    // De-duplicate by name
    const uniqueFonts = Array.from(new Map(allFonts.map(f => [f.name, f])).values());

    console.log(`Found ${projectFonts.length} project fonts and ${supabaseFonts.length} Supabase fonts. Total unique: ${uniqueFonts.length}`);
    res.json(uniqueFonts);
  } catch (err) {
    console.error("Fetch fonts error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

app.post("/api/upload-font", upload.single("font"), async (req, res) => {
  try {
    const file = req.file;
    if (!file) {
      return res.status(400).json({ success: false, message: "No file uploaded" });
    }

    if (!supabase) {
      return res.status(500).json({ success: false, message: "Supabase not configured. Please add SUPABASE_URL and SUPABASE_ANON_KEY to your environment variables." });
    }

    const sanitized = file.originalname.replace(/[^a-z0-9.]/gi, '_').toLowerCase();
    const fileName = `${Date.now()}-${sanitized}`;

    const { data, error } = await supabase.storage
      .from(FONTS_BUCKET)
      .upload(fileName, file.buffer, {
        contentType: file.mimetype,
        upsert: true
      });

    if (error) {
      console.error("Supabase upload error:", error);
      return res.status(500).json({ success: false, message: error.message });
    }

    const { data: { publicUrl } } = supabase.storage.from(FONTS_BUCKET).getPublicUrl(fileName);

    res.json({ success: true, url: publicUrl, name: fileName });
  } catch (err) {
    console.error("Upload font error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

app.delete("/api/fonts/:name", async (req, res) => {
  try {
    const { name } = req.params;

    // 1. Try deleting from Supabase
    if (supabase) {
      // We need to find the full filename if 'name' is just the family name
      const { data: files } = await supabase.storage.from(FONTS_BUCKET).list();
      const fileToDelete = files?.find((f: any) => f.name === name || f.name.startsWith(name));
      
      if (fileToDelete) {
        const { error } = await supabase.storage.from(FONTS_BUCKET).remove([fileToDelete.name]);
        if (!error) return res.json({ success: true });
        console.error("Supabase delete error:", error);
      }
    }

    // 2. Fallback to local filesystem
    const projectFiles = fs.existsSync(PROJECT_FONTS_DIR) ? fs.readdirSync(PROJECT_FONTS_DIR) : [];
    const writableFiles = fs.existsSync(WRITABLE_FONTS_DIR) ? fs.readdirSync(WRITABLE_FONTS_DIR) : [];
    
    let localFileToDelete = writableFiles.find(f => {
      const fontFamily = f.split('.').slice(0, -1).join('.');
      return fontFamily === name || f === name;
    });

    if (localFileToDelete) {
      fs.unlinkSync(path.join(WRITABLE_FONTS_DIR, localFileToDelete));
      return res.json({ success: true });
    }

    localFileToDelete = projectFiles.find(f => {
      const fontFamily = f.split('.').slice(0, -1).join('.');
      return fontFamily === name || f === name;
    });

    if (localFileToDelete) {
      try {
        fs.unlinkSync(path.join(PROJECT_FONTS_DIR, localFileToDelete));
        return res.json({ success: true });
      } catch (e) {
        console.warn("Could not delete project font (likely read-only):", e);
      }
    }

    res.status(404).json({ success: false, message: "Font not found" });
  } catch (err) {
    console.error("Delete font error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

app.post("/api/fonts/rename", async (req, res) => {
  try {
    const { oldName, newName } = req.body;

    // 1. Try renaming in Supabase (Copy + Delete)
    if (supabase) {
      const { data: files } = await supabase.storage.from(FONTS_BUCKET).list();
      const fileToRename = files?.find((f: any) => f.name === oldName || f.name.startsWith(oldName));
      
      if (fileToRename) {
        const ext = path.extname(fileToRename.name);
        const timestamp = fileToRename.name.split('-')[0];
        const newFileName = `${timestamp}-${newName}${ext}`;
        
        const { error: copyError } = await supabase.storage
          .from(FONTS_BUCKET)
          .copy(fileToRename.name, newFileName);
          
        if (!copyError) {
          await supabase.storage.from(FONTS_BUCKET).remove([fileToRename.name]);
          return res.json({ success: true });
        }
        console.error("Supabase rename (copy) error:", copyError);
      }
    }

    // 2. Fallback to local filesystem
    const projectFiles = fs.existsSync(PROJECT_FONTS_DIR) ? fs.readdirSync(PROJECT_FONTS_DIR) : [];
    const writableFiles = fs.existsSync(WRITABLE_FONTS_DIR) ? fs.readdirSync(WRITABLE_FONTS_DIR) : [];
    
    let localFileToRename = writableFiles.find(f => {
      const fontFamily = f.split('.').slice(0, -1).join('.');
      return fontFamily === oldName || f === oldName;
    });

    if (localFileToRename) {
      const ext = path.extname(localFileToRename);
      const timestamp = localFileToRename.split('-')[0];
      const newFileName = `${timestamp}-${newName}${ext}`;
      fs.renameSync(path.join(WRITABLE_FONTS_DIR, localFileToRename), path.join(WRITABLE_FONTS_DIR, newFileName));
      return res.json({ success: true });
    }

    localFileToRename = projectFiles.find(f => {
      const fontFamily = f.split('.').slice(0, -1).join('.');
      return fontFamily === oldName || f === oldName;
    });

    if (localFileToRename) {
      const ext = path.extname(localFileToRename);
      const timestamp = localFileToRename.split('-')[0];
      const newFileName = `${timestamp}-${newName}${ext}`;
      try {
        fs.renameSync(path.join(PROJECT_FONTS_DIR, localFileToRename), path.join(PROJECT_FONTS_DIR, newFileName));
        return res.json({ success: true });
      } catch (e) {
        console.warn("Could not rename project font (likely read-only):", e);
      }
    }

    res.status(404).json({ success: false, message: "Font not found" });
  } catch (err) {
    console.error("Rename font error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// Images Metadata
app.get("/api/images", async (req, res) => {
  try {
    const { username } = req.query;
    
    if (HAS_POSTGRES) {
      await initDb();
      let query = "SELECT id, username, image_url as \"imageUrl\", layers, name, created_at as \"createdAt\" FROM font_app_images";
      const params = [];
      
      if (username) {
        query += " WHERE username = $1";
        params.push(username);
      }
      
      const result = await pool.query(query, params);
      return res.json(result.rows);
    } else if (HAS_SUPABASE) {
      let query = supabase.from('font_app_images').select('id, username, image_url, layers, name, created_at');
      if (username) {
        query = query.eq('username', username);
      }
      const { data, error } = await query;
      if (error) throw error;
      return res.json(data.map(img => ({
        ...img,
        imageUrl: img.image_url,
        createdAt: img.created_at
      })));
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
    
    if (HAS_POSTGRES) {
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
    } else if (HAS_SUPABASE) {
      const { error } = await supabase
        .from('font_app_images')
        .upsert({
          id: project.id,
          username: project.username,
          image_url: project.imageUrl,
          layers: project.layers,
          name: project.name
        });
      if (error) throw error;
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
