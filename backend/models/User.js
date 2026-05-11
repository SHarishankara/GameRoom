const mongoose = require("mongoose");
const bcrypt   = require("bcryptjs");

const UserSchema = new mongoose.Schema(
  {
    username: {
      type: String, required: [true, "Username is required"],
      unique: true, trim: true, minlength: 3, maxlength: 20,
    },
    email: {
      type: String, required: [true, "Email is required"],
      unique: true, lowercase: true, trim: true,
    },
    // password optional — Google OAuth users won't have one
    password: { type: String, minlength: 6 },

    avatar:      { type: String, default: "" },
    gamesPlayed: { type: Number, default: 0 },
    wins:        { type: Number, default: 0 },
    losses:      { type: Number, default: 0 },

    // ── Feature 4: ELO ───────────────────────────────────────
    eloRating: { type: Number, default: 1200 },

    // ── Feature 3: Google OAuth ──────────────────────────────
    // null for password users, Google sub ID for OAuth users
    googleId: { type: String, default: null },

    // ── Friends list (needed by matchmaking + future features)
    // Stores userId refs. Simple array — not a sub-doc to keep it cheap.
    friends:        [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    // Incoming friend requests waiting for acceptance
    friendRequests: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  },
  { timestamps: true }
);

// Hash password only if it exists and was changed
UserSchema.pre("save", async function (next) {
  if (!this.password || !this.isModified("password")) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

UserSchema.methods.comparePassword = async function (candidate) {
  if (!this.password) return false; // Google user has no password
  return bcrypt.compare(candidate, this.password);
};

module.exports = mongoose.model("User", UserSchema);