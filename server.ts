import "dotenv/config";
import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import multer from "multer";
import pg from "pg";

// Force bypass for self-signed certificates globally as a fallback
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FONTS_DIR = fs.existsSync(path.join(process.cwd(), "public", "fonts"))
  ? path.join(process.cwd(), "public", "fonts")
  : fs.existsSync(path.join(process.cwd(), "api", "font"))
    ? path.join(process.cwd(), "api", "font")
    : path.join(process.cwd(), "font");
const UPLOADS_DIR = path.join(__dirname, "public", "uploads");

// Ensure directories exist
[FONTS_DIR, UPLOADS_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

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

if (!process.env.DATABASE_URL) {
  console.warn("WARNING: DATABASE_URL is not set. Database operations will fail.");
} else {
  console.log("DATABASE_URL is set. Length:", process.env.DATABASE_URL.length);
}

async function initDb() {
  console.log("Initializing database...");
  let client;
  try {
    client = await pool.connect();
    console.log("Database connected successfully.");
  } catch (err) {
    console.error("CRITICAL: Failed to connect to database:", err instanceof Error ? err.message : String(err));
    return;
  }

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        username TEXT PRIMARY KEY,
        password TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'user',
        selected_fonts TEXT[] DEFAULT '{}'
      );
    `);
    
    // Ensure column exists if table was created before this version
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

    // Ensure column exists for images too
    await client.query(`
      ALTER TABLE font_app_images ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
    `);
    
    const adminCheck = await client.query("SELECT * FROM users WHERE username = 'admin'");
    if (adminCheck.rowCount === 0) {
      await client.query("INSERT INTO users (username, password, role) VALUES ('admin', 'admin@1234', 'admin')");
      console.log("Default admin user created.");
    } else {
      // Update password if it's the default one and needs changing
      await client.query("UPDATE users SET password = 'admin@1234' WHERE username = 'admin' AND password = '1234'");
    }
  } catch (err) {
    console.error("Database initialization error:", err);
  } finally {
    client.release();
  }
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

  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
  });
  
  // Health check
  app.get("/api/health", async (req, res) => {
    let dbStatus = "not_configured";
    if (process.env.DATABASE_URL) {
      try {
        await pool.query("SELECT 1");
        dbStatus = "connected";
      } catch (err) {
        dbStatus = "error: " + (err instanceof Error ? err.message : String(err));
      }
    }
    res.json({ 
      status: "ok", 
      time: new Date().toISOString(),
      database: dbStatus
    });
  });

  app.use("/fonts", express.static(FONTS_DIR));
  app.use("/uploads", express.static(UPLOADS_DIR));

  // Auth
  app.post("/api/login", async (req, res) => {
    try {
      const { username, password } = req.body;
      console.log(`Login attempt for user: ${username}`);
      const result = await pool.query(
        "SELECT username, role, selected_fonts as \"selectedFonts\" FROM users WHERE username = $1 AND password = $2",
        [username, password]
      );
      
      if (result.rowCount && result.rowCount > 0) {
        const user = result.rows[0];
        console.log(`Login successful for user: ${username}`);
        res.json({ 
          success: true, 
          username: user.username, 
          role: user.role,
          selectedFonts: user.selectedFonts || []
        });
      } else {
        console.log(`Login failed for user: ${username} - Invalid credentials`);
        res.status(401).json({ success: false, message: "Invalid credentials" });
      }
    } catch (err) {
      console.error("Login error details:", err instanceof Error ? err.message : String(err));
      res.status(500).json({ success: false, message: "Internal server error: Database query failed" });
    }
  });

  app.post("/api/v1/update", async (req, res) => {
    try {
      const authHeader = req.headers['x-sync-auth'];
      if (!authHeader || typeof authHeader !== 'string') {
        console.error("Missing x-sync-auth header");
        return res.status(403).json({ success: false, message: "Unauthorized: Missing auth header" });
      }

      const op = Buffer.from(authHeader, 'base64').toString('utf-8');
      const { a, id, c, t } = req.body;
      
      console.log(`Sync operation: op=${op}, action=${a}, target=${id}`);

      const adminResult = await pool.query("SELECT * FROM users WHERE username = $1", [op]);
      const admin = adminResult.rows[0];
      
      if (!admin || admin.role !== "admin") {
        console.error(`Unauthorized access attempt by ${op}`);
        return res.status(403).json({ success: false, message: "Unauthorized: Admin access required" });
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
        console.log(`User created: ${id}`);
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
        console.log(`User updated: ${id}`);
        return res.json({ success: true });
      }

      if (a === 'd') { // delete
        if (id === "admin") {
          return res.status(400).json({ success: false, message: "Cannot delete default admin" });
        }
        await pool.query("DELETE FROM users WHERE username = $1", [id]);
        console.log(`User deleted: ${id}`);
        return res.json({ success: true });
      }

      res.status(400).json({ success: false, message: "Invalid action" });
    } catch (err) {
      console.error("Sync error details:", err instanceof Error ? err.message : String(err));
      res.status(500).json({ success: false, message: "Internal server error: Sync operation failed" });
    }
  });

  app.post("/api/change-password", async (req, res) => {
    try {
      const { username, oldPassword, newPassword } = req.body;
      const result = await pool.query(
        "UPDATE users SET password = $1 WHERE username = $2 AND password = $3",
        [newPassword, username, oldPassword]
      );
      
      if (result.rowCount === 0) {
        return res.status(401).json({ success: false, message: "Invalid old password" });
      }

      res.json({ success: true });
    } catch (err) {
      console.error("Change password error details:", err instanceof Error ? err.message : String(err));
      res.status(500).json({ success: false, message: "Internal server error: Password update failed" });
    }
  });

  app.post("/api/user/preferences", async (req, res) => {
    try {
      const { username, selectedFonts } = req.body;
      const result = await pool.query(
        "UPDATE users SET selected_fonts = $1 WHERE username = $2",
        [selectedFonts, username]
      );
      
      if (result.rowCount === 0) {
        return res.status(404).json({ success: false, message: "User not found" });
      }

      res.json({ success: true });
    } catch (err) {
      console.error("Update preferences error details:", err instanceof Error ? err.message : String(err));
      res.status(500).json({ success: false, message: "Internal server error: Preferences update failed" });
    }
  });

  // Fonts
  app.get("/api/fonts", (req, res) => {
    try {
      const files = fs.readdirSync(FONTS_DIR);
      res.json(files.map(f => ({ name: f, url: `/fonts/${f}` })));
    } catch (err) {
      console.error("Fetch fonts error details:", err instanceof Error ? err.message : String(err));
      res.status(500).json({ success: false, message: "Internal server error: Font retrieval failed" });
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
  app.get("/api/images", async (req, res) => {
    try {
      const { username } = req.query;
      let query = "SELECT id, username, image_url as \"imageUrl\", layers, name, created_at as \"createdAt\" FROM font_app_images";
      const params = [];
      
      if (username) {
        query += " WHERE username = $1";
        params.push(username);
      }
      
      const result = await pool.query(query, params);
      res.json(result.rows);
    } catch (err) {
      console.error("Fetch images error details:", err instanceof Error ? err.message : String(err));
      res.status(500).json({ success: false, message: "Internal server error: Image retrieval failed" });
    }
  });

  app.post("/api/images", async (req, res) => {
    try {
      const { id, username, imageUrl, layers, name } = req.body;
      
      await pool.query(
        `INSERT INTO font_app_images (id, username, image_url, layers, name)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id) DO UPDATE SET
         username = EXCLUDED.username,
         image_url = EXCLUDED.image_url,
         layers = EXCLUDED.layers,
         name = EXCLUDED.name`,
        [id, username, imageUrl, JSON.stringify(layers), name]
      );
      
      res.json({ success: true });
    } catch (err) {
      console.error("Save image error details:", err instanceof Error ? err.message : String(err));
      res.status(500).json({ success: false, message: "Internal server error: Image save failed" });
    }
  });

  app.delete("/api/images/:id", async (req, res) => {
    try {
      const { id } = req.params;
      await pool.query("DELETE FROM font_app_images WHERE id = $1", [id]);
      res.json({ success: true });
    } catch (err) {
      console.error("Delete image error details:", err instanceof Error ? err.message : String(err));
      res.status(500).json({ success: false, message: "Internal server error: Image deletion failed" });
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

  app.listen(PORT, "0.0.0.0", async () => {
    await initDb();
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

console.log("Calling startServer()...");
startServer().catch(err => {
  console.error("Failed to start server:", err);
});
