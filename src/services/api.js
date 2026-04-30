// src/services/api.js
// ─────────────────────────────────────────────────────────────
// Centralised API helper. All fetch() calls to the backend
// live here so the rest of the app never has hardcoded URLs.
//
// VITE_API_URL is set in your .env file:
//   Local dev  → http://localhost:5000
//   Production → https://your-backend.onrender.com
// ─────────────────────────────────────────────────────────────

const BASE_URL = `${import.meta.env.VITE_API_URL || "http://localhost:5000"}/api`;

export const api = {

  // ── POST /api/auth/register ──────────────────────────────
  // Create a new account. Returns { token, user } on success.
  register: async (userData) => {
    const res = await fetch(`${BASE_URL}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(userData),
    });
    return res.json();
  },

  // ── POST /api/auth/login ─────────────────────────────────
  // Log in with email + password. Returns { token, user }.
  login: async (userData) => {
    const res = await fetch(`${BASE_URL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(userData),
    });
    return res.json();
  },

  // ── POST /api/game/create-room ───────────────────────────
  // Creates a new chess room. The logged-in user becomes White.
  // Requires the JWT token in the Authorization header.
  // Returns { roomId, shareLink }.
  createRoom: async (token) => {
    const res = await fetch(`${BASE_URL}/game/create-room`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
    });
    return res.json();
  },

  // ── GET /api/game/room/:roomId ───────────────────────────
  // Fetch room info before joining — used by JoinPage to check
  // if the room exists and hasn't already finished.
  getRoom: async (roomId) => {
    const res = await fetch(`${BASE_URL}/game/room/${roomId}`);
    return res.json();
  },

  // ── GET /api/auth/me ─────────────────────────────────────
  // Returns the currently logged-in user's profile.
  // Useful for refreshing user data after page reload.
  me: async (token) => {
    const res = await fetch(`${BASE_URL}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return res.json();
  },

  // ── GET /api/game/history ────────────────────────────────
  // Returns the last 20 finished games for the logged-in user.
  gameHistory: async (token) => {
    const res = await fetch(`${BASE_URL}/game/history`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return res.json();
  },
};