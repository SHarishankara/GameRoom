// routes/friends.js — Friends system (dependency for matchmaking mutual tab)
// POST /api/friends/request/:userId   — send a friend request
// POST /api/friends/accept/:userId    — accept a request
// POST /api/friends/remove/:userId    — unfriend
// GET  /api/friends                   — list your friends with ELO
// GET  /api/friends/requests          — incoming requests

const express = require("express");
const router  = express.Router();
const User    = require("../models/User");
const { protect } = require("../middleware/auth");

// ── Send friend request ───────────────────────────────────────
router.post("/request/:targetId", protect, async (req, res) => {
  try {
    const me     = req.user._id.toString();
    const target = req.params.targetId;

    if (me === target)
      return res.status(400).json({ message: "Can't add yourself" });

    const targetUser = await User.findById(target);
    if (!targetUser) return res.status(404).json({ message: "User not found" });

    // Already friends?
    if (targetUser.friends.map(String).includes(me))
      return res.status(400).json({ message: "Already friends" });

    // Already requested?
    if (targetUser.friendRequests.map(String).includes(me))
      return res.status(400).json({ message: "Request already sent" });

    await User.findByIdAndUpdate(target, { $push: { friendRequests: me } });
    res.json({ message: "Friend request sent" });
  } catch (err) {
    res.status(500).json({ message: "Server error", error: err.message });
  }
});

// ── Accept friend request ─────────────────────────────────────
router.post("/accept/:requesterId", protect, async (req, res) => {
  try {
    const me        = req.user._id.toString();
    const requester = req.params.requesterId;

    const myUser = await User.findById(me);
    if (!myUser.friendRequests.map(String).includes(requester))
      return res.status(400).json({ message: "No request from this user" });

    // Add to both friends lists + remove from requests — atomic-ish
    await Promise.all([
      User.findByIdAndUpdate(me,        { $push: { friends: requester }, $pull: { friendRequests: requester } }),
      User.findByIdAndUpdate(requester, { $push: { friends: me } }),
    ]);
    res.json({ message: "Friend added!" });
  } catch (err) {
    res.status(500).json({ message: "Server error", error: err.message });
  }
});

// ── Remove friend ─────────────────────────────────────────────
router.post("/remove/:friendId", protect, async (req, res) => {
  try {
    const me     = req.user._id.toString();
    const friend = req.params.friendId;
    await Promise.all([
      User.findByIdAndUpdate(me,     { $pull: { friends: friend } }),
      User.findByIdAndUpdate(friend, { $pull: { friends: me     } }),
    ]);
    res.json({ message: "Unfriended" });
  } catch (err) {
    res.status(500).json({ message: "Server error", error: err.message });
  }
});

// ── Get my friends list ───────────────────────────────────────
router.get("/", protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
      .populate("friends", "username eloRating wins losses gamesPlayed avatar")
      .lean();
    res.json({ friends: user.friends });
  } catch (err) {
    res.status(500).json({ message: "Server error", error: err.message });
  }
});

// ── Get incoming friend requests ──────────────────────────────
router.get("/requests", protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
      .populate("friendRequests", "username eloRating avatar")
      .lean();
    res.json({ requests: user.friendRequests });
  } catch (err) {
    res.status(500).json({ message: "Server error", error: err.message });
  }
});

module.exports = router;
