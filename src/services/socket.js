// src/services/socket.js
// ─────────────────────────────────────────────────────────────
// Single shared Socket.IO client instance for the entire app.
// We create it once here and import it wherever needed.
// This prevents multiple connections being opened accidentally.
// ─────────────────────────────────────────────────────────────

import { io } from "socket.io-client";

// Use the environment variable in production (set in .env).
// Falls back to localhost for local development.
const URL = import.meta.env.VITE_SOCKET_URL || "http://localhost:5000";

// Create the socket but do NOT connect yet (autoConnect: false).
// We manually call connectSocket() after the user logs in,
// so we don't waste a connection on the auth page.
export const socket = io(URL, {
  autoConnect: false,

  // Automatically try to reconnect if the connection drops.
  reconnection: true,
  reconnectionAttempts: 10, // Give up after 10 failed attempts
  reconnectionDelay: 1000,  // Wait 1 second between each attempt
});

// ── connectSocket ──────────────────────────────────────────
// Call this once after login. The guard prevents calling
// socket.connect() multiple times if connectSocket() is
// accidentally called more than once (e.g. on re-renders).
export const connectSocket = () => {
  if (!socket.connected) socket.connect();
};

// ── disconnectSocket ───────────────────────────────────────
// Call this on logout to cleanly close the connection.
export const disconnectSocket = () => {
  if (socket.connected) socket.disconnect();
};