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

  // ── NEW BELOW — added for new features ───────────────────

  // ── GET /api/game/leaderboard ────────────────────────────
  // Feature 4: Returns top 20 players sorted by ELO rating.
  // Public endpoint — no token needed.
  leaderboard: async () => {
    const res = await fetch(`${BASE_URL}/game/leaderboard`);
    return res.json();
  },

  // ── GET /api/game/profile/:username ──────────────────────
  // Feature 4: Public profile — username, ELO, wins, losses.
  profile: async (username) => {
    const res = await fetch(`${BASE_URL}/game/profile/${username}`);
    return res.json();
  },

  // ── GET /api/game/queue-size ─────────────────────────────
  // Feature 5: Returns how many players are currently searching.
  // Commented out — uncomment when matchmaking is enabled.
  // queueSize: async () => {
  //   const res = await fetch(`${BASE_URL}/game/queue-size`);
  //   return res.json();
  // },

  // ── GET /api/friends ─────────────────────────────────────
  // Friends: Returns the logged-in user's friends list with ELO.
  getFriends: async (token) => {
    const res = await fetch(`${BASE_URL}/friends`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return res.json();
  },

  // ── GET /api/friends/requests ────────────────────────────
  // Friends: Returns incoming friend requests waiting for acceptance.
  getFriendRequests: async (token) => {
    const res = await fetch(`${BASE_URL}/friends/requests`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return res.json();
  },

  // ── POST /api/friends/request/:userId ────────────────────
  // Friends: Send a friend request to another user by their ID.
  sendFriendRequest: async (token, userId) => {
    const res = await fetch(`${BASE_URL}/friends/request/${userId}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    return res.json();
  },

  // ── POST /api/friends/accept/:userId ─────────────────────
  // Friends: Accept an incoming friend request.
  acceptFriend: async (token, userId) => {
    const res = await fetch(`${BASE_URL}/friends/accept/${userId}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    return res.json();
  },

  // ── POST /api/friends/remove/:userId ─────────────────────
  // Friends: Remove an existing friend (both sides unfriended).
  removeFriend: async (token, userId) => {
    const res = await fetch(`${BASE_URL}/friends/remove/${userId}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    return res.json();
  },
};