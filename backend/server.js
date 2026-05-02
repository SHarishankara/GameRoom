// server.js
require("dotenv").config();

const express    = require("express");
const http       = require("http");
const { Server } = require("socket.io");
const cors       = require("cors");
const rateLimit  = require("express-rate-limit"); // fix #12
const jwt        = require("jsonwebtoken");

const connectDB              = require("./config/db");
const authRoutes             = require("./routes/auth");
const gameRoutes             = require("./routes/game");
const registerSocketHandlers = require("./socket/chess");

const app        = express();
const httpServer = http.createServer(app);

// ── CORS — only allow known origins (fix #14) ─────────────────
// In production CLIENT_URL must be set in env. Never hardcode.
const allowedOrigins = [
  process.env.CLIENT_URL,       // production frontend
  "http://localhost:5173",       // Vite dev
  "http://localhost:3000",
].filter(Boolean);

const corsOptions = {
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes(origin)) cb(null, true);
    else cb(new Error(`CORS blocked: ${origin}`));
  },
  credentials: true,
};

// ── Socket.IO ─────────────────────────────────────────────────
const io = new Server(httpServer, {
  cors: { origin: allowedOrigins, methods: ["GET", "POST"], credentials: true },
});

// ── Socket JWT middleware (fix #1) ────────────────────────────
// Authenticate every socket connection with the JWT token.
// Attaches socket.user = { id, username } for use in handlers.
// Client must pass: io(URL, { auth: { token } })
io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error("unauthorized: no token"));

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Fetch username from DB so server always owns identity (fix #6)
    const User = require("./models/User");
    const user = await User.findById(decoded.id).select("username").lean();
    if (!user) return next(new Error("unauthorized: user not found"));

    socket.user = { id: decoded.id, username: user.username };
    next();
  } catch (e) {
    next(new Error("unauthorized: invalid token"));
  }
});

// ── Middleware ────────────────────────────────────────────────
app.use(cors(corsOptions));
app.options("*", cors(corsOptions));
app.use(express.json());

// ── Rate limiting (fix #12) ───────────────────────────────────
// Auth endpoints: 20 requests per 15 minutes per IP
app.use("/api/auth", rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { message: "Too many requests, try again later." },
  standardHeaders: true,
  legacyHeaders: false,
}));

// General API: 200 requests per 15 minutes
app.use("/api", rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
}));

// ── Database ──────────────────────────────────────────────────
connectDB();

// ── REST Routes ───────────────────────────────────────────────
app.use("/api/auth", authRoutes);
app.use("/api/game", gameRoutes);
app.get("/", (req, res) => res.json({ status: "Game Platform API is running 🚀" }));

// ── Socket handlers ───────────────────────────────────────────
registerSocketHandlers(io);

// ── Start ─────────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;
httpServer.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));