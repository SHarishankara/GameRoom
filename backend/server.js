// server.js
// ─────────────────────────────────────────────────────────────
// Entry point for the backend.
// Sets up Express (REST API) + Socket.IO (real-time) on a single
// HTTP server so both share the same port — required for Render.
// ─────────────────────────────────────────────────────────────

require("dotenv").config(); // Load .env variables (MONGO_URI, JWT_SECRET, CLIENT_URL, PORT)

const express = require("express");
const http    = require("http");
const { Server } = require("socket.io");
const cors    = require("cors");

const connectDB              = require("./config/db");
const authRoutes             = require("./routes/auth");
const gameRoutes             = require("./routes/game");
const registerSocketHandlers = require("./socket/chess");

// ── Express app ────────────────────────────────────────────
const app = express();

// Socket.IO requires a raw Node HTTP server — it can't attach to Express directly
const httpServer = http.createServer(app);

// ── CORS — allowed origins ─────────────────────────────────
// FIX: Previously only one origin was allowed, which broke local dev
// when deployed. Now we allow both the production frontend URL
// (CLIENT_URL from .env) AND localhost for development.
const allowedOrigins = [
  process.env.CLIENT_URL,   // e.g. https://your-app.vercel.app (set in Render env vars)
  "http://localhost:5173",  // Vite dev server
  "http://localhost:3000",  // Create React App dev server (just in case)
].filter(Boolean); // Remove undefined if CLIENT_URL isn't set

const corsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin header (Postman, curl, mobile apps)
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`CORS blocked: ${origin}`));
    }
  },
  credentials: true, // Allow cookies/auth headers
};

// ── Socket.IO setup ────────────────────────────────────────
// Must use the same CORS config as Express so browser WebSocket
// handshake isn't blocked.
const io = new Server(httpServer, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"],
    credentials: true,
  },
});

// ── Middleware ─────────────────────────────────────────────
app.use(cors(corsOptions));   // Apply CORS to all REST routes
app.use(express.json());      // Parse JSON request bodies

// ── Database ───────────────────────────────────────────────
connectDB(); // Connect to MongoDB Atlas (uses MONGO_URI from .env)

// ── REST Routes ────────────────────────────────────────────
app.use("/api/auth", authRoutes);  // /api/auth/register, /api/auth/login, /api/auth/me
app.use("/api/game", gameRoutes);  // /api/game/create-room, /api/game/room/:id, /api/game/history

// Health check — useful for Render to confirm the server started
app.get("/", (req, res) => res.json({ status: "Game Platform API is running 🚀" }));

// ── Socket.IO handlers ─────────────────────────────────────
// All real-time game events (join-room, move, chat, voice, resign)
// are registered inside this function.
registerSocketHandlers(io);

// ── Start server ───────────────────────────────────────────
// Render injects PORT automatically. Falls back to 5000 locally.
const PORT = process.env.PORT || 5000;
httpServer.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});