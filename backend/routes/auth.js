// routes/auth.js — Feature 3: adds Google OAuth
// All original email/password routes are UNCHANGED.
// New: GET /api/auth/google          — redirect to Google
//      GET /api/auth/google/callback — Google redirects back here
// Requires: npm install passport passport-google-oauth20
// Requires: GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env

const express  = require("express");
const router   = express.Router();
const jwt      = require("jsonwebtoken");
const User     = require("../models/User");
const { protect } = require("../middleware/auth");

// ── Helper: generate JWT (unchanged) ─────────────────────────
const generateToken = (userId) =>
  jwt.sign({ id: userId }, process.env.JWT_SECRET, { expiresIn: "7d" });

// ── POST /api/auth/register (unchanged) ──────────────────────
router.post("/register", async (req, res) => {
  try {
    const { username, email, password } = req.body;
    if (!username || !email || !password)
      return res.status(400).json({ message: "All fields are required" });

    const existing = await User.findOne({ $or: [{ email }, { username }] });
    if (existing)
      return res.status(400).json({ message: "Username or email already taken" });

    const user = await User.create({ username, email, password });
    res.status(201).json({
      message: "Account created successfully!",
      token: generateToken(user._id),
      user: { id: user._id, username: user.username, email: user.email, eloRating: user.eloRating },
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// ── POST /api/auth/login (unchanged) ─────────────────────────
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ message: "Email and password are required" });

    const user = await User.findOne({ email });
    if (!user) return res.status(401).json({ message: "Invalid email or password" });

    const isMatch = await user.comparePassword(password);
    if (!isMatch) return res.status(401).json({ message: "Invalid email or password" });

    res.json({
      message: "Logged in successfully!",
      token: generateToken(user._id),
      user: { id: user._id, username: user.username, email: user.email, eloRating: user.eloRating },
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// ── GET /api/auth/me (unchanged) ─────────────────────────────
router.get("/me", protect, (req, res) => res.json({ user: req.user }));

// ══════════════════════════════════════════════════════════════
// Feature 3: Google OAuth
// Only active if GOOGLE_CLIENT_ID is set in .env
// ══════════════════════════════════════════════════════════════
if (process.env.GOOGLE_CLIENT_ID) {
  let passport, GoogleStrategy;
  try {
    passport       = require("passport");
    GoogleStrategy = require("passport-google-oauth20").Strategy;
  } catch {
    console.warn("⚠️  passport / passport-google-oauth20 not installed. Run: npm install passport passport-google-oauth20");
  }

  if (passport && GoogleStrategy) {
    passport.use(new GoogleStrategy(
      {
        clientID:     process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL:  `${process.env.SERVER_URL || "http://localhost:5000"}/api/auth/google/callback`,
      },
      async (accessToken, refreshToken, profile, done) => {
        try {
          const email = profile.emails?.[0]?.value;

          // Feature 3 edge case: account with this email already exists via password
          let user = await User.findOne({ email });
          if (user && !user.googleId) {
            // Merge: link Google to existing account
            user.googleId = profile.id;
            await user.save();
            return done(null, user);
          }

          // First Google login: create account
          if (!user) {
            // Generate a unique username from Google display name
            let baseUsername = profile.displayName.replace(/\s+/g, "").slice(0, 18);
            let username     = baseUsername;
            let attempt      = 0;
            while (await User.findOne({ username })) {
              username = `${baseUsername}${++attempt}`;
            }
            user = await User.create({
              username,
              email,
              googleId: profile.id,
              avatar:   profile.photos?.[0]?.value || "",
              // No password field — comparePassword handles this
            });
          }
          done(null, user);
        } catch (err) { done(err); }
      }
    ));

    // Initialize passport middleware (call this in server.js: app.use(passport.initialize()))
    router.use(passport.initialize());

    // ── GET /api/auth/google ──────────────────────────────────
    router.get("/google",
      passport.authenticate("google", { scope: ["profile", "email"], session: false })
    );

    // ── GET /api/auth/google/callback ─────────────────────────
    // Google redirects here after login. We issue a JWT and
    // redirect to frontend with token in URL fragment.
    router.get("/google/callback",
      passport.authenticate("google", { session: false, failureRedirect: `${process.env.CLIENT_URL}/auth?error=google` }),
      (req, res) => {
        const token = generateToken(req.user._id);
        const user  = JSON.stringify({ id: req.user._id, username: req.user.username, email: req.user.email, eloRating: req.user.eloRating });
        // Redirect to frontend — it reads token from URL and saves to localStorage
        // Feature 6: if redirect stored in session, use that
        const redirect = req.session?.redirectAfterLogin || "/";
        res.redirect(`${process.env.CLIENT_URL}/auth/callback?token=${token}&user=${encodeURIComponent(user)}&redirect=${encodeURIComponent(redirect)}`);
      }
    );
  }
}

module.exports = router;