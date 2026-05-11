// server.js — adds matchmaking + friends route + passport for OAuth
// All original code is PRESERVED. New lines are marked with "// NEW"
require("dotenv").config();

const express    = require("express");
const http       = require("http");
const { Server } = require("socket.io");
const cors       = require("cors");
const rateLimit  = require("express-rate-limit");
const jwt        = require("jsonwebtoken");

const connectDB              = require("./config/db");
const authRoutes             = require("./routes/auth");
const gameRoutes             = require("./routes/game");
const friendRoutes           = require("./routes/friends");                 // NEW
const registerSocketHandlers = require("./socket/chess");
// const { registerMatchmakingWithIo } = require("./socket/matchmaking");     // NEW // matchmaking feature

const app        = express();
const httpServer = http.createServer(app);

// ── CORS (unchanged) ─────────────────────────────────────────
const allowedOrigins = [
  process.env.CLIENT_URL,
  "http://localhost:5173",
  "http://localhost:3000",
].filter(Boolean);

const corsOptions = {
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes(origin)) cb(null, true);
    else cb(new Error(`CORS blocked: ${origin}`));
  },
  credentials: true,
};

// ── Socket.IO (unchanged) ────────────────────────────────────
const io = new Server(httpServer, {
  cors: { origin: allowedOrigins, methods: ["GET", "POST"], credentials: true },
});

// ── Track one socket per userId (unchanged) ──────────────────
const connectedUsers = new Map();

// ── Socket JWT middleware (unchanged) ─────────────────────────
io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error("unauthorized: no token"));
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const User    = require("./models/User");
    const user    = await User.findById(decoded.id).select("username").lean();
    if (!user) return next(new Error("unauthorized: user not found"));
    socket.user = { id: decoded.id, username: user.username };

    const existingSocketId = connectedUsers.get(decoded.id.toString());
    if (existingSocketId && existingSocketId !== socket.id) {
      const old = io.sockets.sockets.get(existingSocketId);
      if (old) {
        old.emit("error", { message: "Signed in from another tab. Disconnecting this session." });
        old.disconnect(true);
      }
    }
    connectedUsers.set(decoded.id.toString(), socket.id);
    next();
  } catch (e) {
    next(new Error("unauthorized: invalid token"));
  }
});

io.on("connection", (socket) => {
  socket.on("disconnect", () => {
    const userId = socket.user?.id?.toString();
    if (userId && connectedUsers.get(userId) === socket.id) connectedUsers.delete(userId);
  });
});

// ── Middleware (unchanged) ────────────────────────────────────
app.use(cors(corsOptions));
app.options("*", cors(corsOptions));
app.use(express.json());

// ── Rate limiting (unchanged) ─────────────────────────────────
app.use("/api/auth", rateLimit({ windowMs: 15*60*1000, max: 20, message: { message: "Too many requests" }, standardHeaders: true, legacyHeaders: false }));
app.use("/api",      rateLimit({ windowMs: 15*60*1000, max: 200, standardHeaders: true, legacyHeaders: false }));

// ── Database (unchanged) ──────────────────────────────────────
connectDB();

// ── REST Routes ───────────────────────────────────────────────
app.use("/api/auth",    authRoutes);
app.use("/api/game",    gameRoutes);
app.use("/api/friends", friendRoutes);                                      // NEW
app.get("/", (req, res) => res.json({ status: "Game Platform API running 🚀" }));

// ── Socket handlers ───────────────────────────────────────────
registerSocketHandlers(io);
// registerMatchmakingWithIo(io);   // matchmaking feature                                           // NEW

// ── Start ─────────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;
httpServer.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));