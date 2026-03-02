import express from "express";
import { createServer as createViteServer } from "vite";
import session from "express-session";
import cookieParser from "cookie-parser";
import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { v4 as uuidv4 } from "uuid";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const db = new Database("jangkrik.db");

// Initialize Database
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    created_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    title TEXT,
    created_at INTEGER,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    session_id TEXT,
    role TEXT,
    text TEXT,
    image_data TEXT,
    timestamp INTEGER,
    FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
  );
`);

// Migration for existing databases
try { db.exec("ALTER TABLE users ADD COLUMN created_at INTEGER"); } catch (e) {}
try { db.exec("ALTER TABLE messages ADD COLUMN image_data TEXT"); } catch (e) {}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.set('trust proxy', 1);
  app.use(express.json({ limit: '50mb' }));
  app.use(cookieParser());
  app.use(
    session({
      secret: process.env.SESSION_SECRET || "jangkrik-secret",
      resave: false,
      saveUninitialized: true,
      cookie: {
        secure: true,
        sameSite: "none",
        httpOnly: true,
        maxAge: 365 * 24 * 60 * 60 * 1000, // 1 year
      },
    })
  );

  // Middleware to ensure a persistent anonymous user ID
  app.use((req, res, next) => {
    if (!(req.session as any).userId) {
      const newUserId = uuidv4();
      (req.session as any).userId = newUserId;
      db.prepare("INSERT INTO users (id, created_at) VALUES (?, ?)").run(newUserId, Date.now());
    }
    next();
  });

  // Chat Routes
  app.get("/api/sessions", (req, res) => {
    const userId = (req.session as any).userId;
    const sessions = db.prepare("SELECT * FROM sessions WHERE user_id = ? ORDER BY created_at DESC").all(userId);
    const sessionsWithMessages = sessions.map((s: any) => {
      const messages = db.prepare("SELECT * FROM messages WHERE session_id = ? ORDER BY timestamp ASC").all(s.id);
      return {
        id: s.id,
        title: s.title,
        createdAt: s.created_at,
        messages: messages.map((m: any) => ({
          id: m.id,
          role: m.role,
          text: m.text,
          imageData: m.image_data,
          timestamp: m.timestamp
        }))
      };
    });
    res.json(sessionsWithMessages);
  });

  app.post("/api/sessions", (req, res) => {
    const userId = (req.session as any).userId;
    const { id, title, createdAt } = req.body;
    db.prepare("INSERT INTO sessions (id, user_id, title, created_at) VALUES (?, ?, ?, ?)").run(id, userId, title, createdAt);
    res.json({ success: true });
  });

  app.delete("/api/sessions/:id", (req, res) => {
    const userId = (req.session as any).userId;
    const { id } = req.params;
    db.prepare("DELETE FROM sessions WHERE id = ? AND user_id = ?").run(id, userId);
    res.json({ success: true });
  });

  app.post("/api/messages", (req, res) => {
    const userId = (req.session as any).userId;
    const { id, sessionId, role, text, timestamp, sessionTitle, imageData } = req.body;
    
    if (sessionTitle) {
      db.prepare("UPDATE sessions SET title = ? WHERE id = ? AND user_id = ?").run(sessionTitle, sessionId, userId);
    }

    db.prepare("INSERT INTO messages (id, session_id, role, text, timestamp, image_data) VALUES (?, ?, ?, ?, ?, ?)").run(id, sessionId, role, text, timestamp, imageData || null);
    res.json({ success: true });
  });

  app.delete("/api/messages/:id", (req, res) => {
    const userId = (req.session as any).userId;
    const { id } = req.params;
    db.prepare(`
      DELETE FROM messages 
      WHERE id = ? AND session_id IN (SELECT id FROM sessions WHERE user_id = ?)
    `).run(id, userId);
    res.json({ success: true });
  });

  app.delete("/api/sessions/:sessionId/messages", (req, res) => {
    const userId = (req.session as any).userId;
    const { sessionId } = req.params;
    db.prepare("DELETE FROM messages WHERE session_id = ? AND session_id IN (SELECT id FROM sessions WHERE user_id = ?)").run(sessionId, userId);
    res.json({ success: true });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
