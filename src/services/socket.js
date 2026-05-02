// src/services/socket.js
// ─────────────────────────────────────────────────────────────
// Single socket instance. Sends JWT in auth handshake (fix #1).
// Server verifies token and derives username — client can't spoof.
// ─────────────────────────────────────────────────────────────
import { io } from "socket.io-client";

const URL = import.meta.env.VITE_SOCKET_URL || "http://localhost:5000";

// Internal socket instance — managed here, not exported directly
let _socket = null;

function buildSocket() {
  const token = localStorage.getItem("token") || "";
  return io(URL, {
    autoConnect:          false,
    reconnection:         true,
    reconnectionAttempts: 10,
    reconnectionDelay:    1500,
    // ✅ fix #1: JWT sent on handshake — server verifies it
    auth: { token },
  });
}

// ── connectSocket ──────────────────────────────────────────────
// Call once after login. Creates a fresh socket with the current
// token (important — token may not exist when module first loads).
export function connectSocket() {
  if (_socket?.connected) return; // already connected — nothing to do
  if (_socket) { _socket.disconnect(); _socket = null; } // stale — rebuild
  _socket = buildSocket();
  _socket.connect();
}

// ── disconnectSocket ───────────────────────────────────────────
export function disconnectSocket() {
  _socket?.disconnect();
  _socket = null;
}

// ── socket ────────────────────────────────────────────────────
// Proxy so `import { socket }` always forwards to the live instance.
// This means components never hold a stale reference.
export const socket = new Proxy({}, {
  get(_, prop) {
    // Auto-init if not yet created (e.g. first import before login)
    if (!_socket) _socket = buildSocket();
    const val = _socket[prop];
    // Bind methods so `this` context is correct
    return typeof val === "function" ? val.bind(_socket) : val;
  },
  set(_, prop, value) {
    if (_socket) _socket[prop] = value;
    return true;
  },
});