// src/components/ChatVoicePanel.jsx
import { useState, useEffect, useRef } from "react";
import { socket } from "../services/socket";
import "./ChatVoicePanel.css";

// ── SVG Icons ─────────────────────────────────────────────────
const MicOn  = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 1a4 4 0 0 1 4 4v6a4 4 0 0 1-8 0V5a4 4 0 0 1 4-4zm6 9a1 1 0 0 1 2 0 8 8 0 0 1-7 7.93V20h2a1 1 0 0 1 0 2H9a1 1 0 0 1 0-2h2v-2.07A8 8 0 0 1 4 10a1 1 0 0 1 2 0 6 6 0 0 0 12 0z"/></svg>;
const MicOff = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M2.71 3.71a1 1 0 0 1 1.41-1.41l17 17a1 1 0 0 1-1.41 1.41L17 18A8 8 0 0 1 4 10a1 1 0 0 1 2 0 6 6 0 0 0 8.64 5.39l-1.47-1.47A4 4 0 0 1 8 11V5a4 4 0 0 1 6.93-2.76l-1.44-1.44A6 6 0 0 0 6 10a1 1 0 0 1-2 0 8 8 0 0 1 1-3.87L2.71 3.71zM12 1a4 4 0 0 1 4 4v4.59l-6-6V5a4 4 0 0 1 2-3.46z"/></svg>;
const Send   = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>;
const VolOn  = () => <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/></svg>;
const VolOff = () => <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/></svg>;

// ═══════════════════════════════════════════════════════════════
// ✅ FIX 1: Module-level message store — lives OUTSIDE React.
// Closing/reopening the panel unmounts/remounts the component,
// wiping useState. Storing messages here persists them forever.
// ═══════════════════════════════════════════════════════════════
const _msgStore = {}; // { [roomId]: Message[] }

function getHistory(roomId) {
  if (!_msgStore[roomId]) _msgStore[roomId] = [];
  return _msgStore[roomId];
}

function saveMessage(roomId, msg) {
  if (!_msgStore[roomId]) _msgStore[roomId] = [];
  // Deduplicate: same sender + same timestamp = same message
  const isDup = _msgStore[roomId].some(
    m => m.username === msg.username && m.time === msg.time
  );
  if (!isDup) _msgStore[roomId].push(msg);
}

// ── Helper: format ISO time → "HH:MM" ─────────────────────────
const fmtTime = (iso) => {
  try { return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); }
  catch { return ""; }
};

// ── Helper: name initials for avatar ──────────────────────────
const initials = (name) => (name || "?").slice(0, 2).toUpperCase();

// ═══════════════════════════════════════════════════════════════
// ChatVoicePanel
// ═══════════════════════════════════════════════════════════════
function ChatVoicePanel({ roomId, username }) {

  // ── Chat ───────────────────────────────────────────────────
  // ✅ FIX 3: Init from module store → notified messages show on first open
  const [messages, setMessages]   = useState(() => [...getHistory(roomId)]);
  const [input, setInput]         = useState("");
  const [isTyping, setIsTyping]   = useState(false);
  const [theme, setTheme]         = useState(
    () => localStorage.getItem("chatTheme") || "dark"
  );

  // ── Voice ──────────────────────────────────────────────────
  const [isMicOn, setIsMicOn]       = useState(false);
  const [mySpeaking, setMySpeaking] = useState(false);
  const [voiceUsers, setVoiceUsers] = useState([]); // other users in voice

  // ── Tab: "chat" | "voice" ──────────────────────────────────
  const [tab, setTab] = useState("chat");

  // ── Refs ───────────────────────────────────────────────────
  const bottomRef      = useRef(null); // auto-scroll anchor
  const localStreamRef = useRef(null); // my microphone MediaStream
  const peersRef       = useRef({});   // { [socketId]: RTCPeerConnection }
  const audiosRef      = useRef({});   // { [socketId]: HTMLAudioElement }
  const speakFrameRef  = useRef(null); // rAF handle for speaking detection
  const typingTimer    = useRef(null); // timeout to clear typing indicator
  const vuRef          = useRef([]);   // mirror of voiceUsers for use inside closures

  // Keep vuRef in sync so WebRTC callbacks always see latest volumes
  useEffect(() => { vuRef.current = voiceUsers; }, [voiceUsers]);

  // Persist theme preference
  useEffect(() => { localStorage.setItem("chatTheme", theme); }, [theme]);

  // Auto-scroll to newest message
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Join voice channel on mount, leave on unmount
  useEffect(() => {
    joinVoice();
    return () => leaveVoice();
  }, []);

  // ── Socket listeners ───────────────────────────────────────
  useEffect(() => {

    // Incoming chat message from someone else
    const onChat = (msg) => {
      if (msg.username === username) return; // own messages added instantly on send
      saveMessage(roomId, msg);
      // ✅ FIX 2: spread a new array so React detects the change
      setMessages([...getHistory(roomId)]);
    };

    // Typing indicator from someone else
    const onTyping = ({ username: who }) => {
      if (who === username) return;
      setIsTyping(true);
      clearTimeout(typingTimer.current);
      typingTimer.current = setTimeout(() => setIsTyping(false), 2000);
    };

    // Server sends current room users when we join voice
    const onRoomUsers = (users) => {
      setVoiceUsers(
        users
          .filter(u => u.username !== username)
          .map(u => ({ ...u, speaking: false, volume: 1.0, muted: false }))
      );
    };

    // Another user joined the voice channel — create peer as initiator
    const onVoiceJoined = async ({ socketId, username: who }) => {
      setVoiceUsers(prev => {
        if (prev.find(u => u.socketId === socketId)) return prev;
        return [...prev, { socketId, username: who, speaking: false, volume: 1.0, muted: false }];
      });
      await createPeer(socketId, true);
    };

    // A user left voice — clean up peer + audio
    const onVoiceLeft = ({ socketId }) => {
      setVoiceUsers(prev => prev.filter(u => u.socketId !== socketId));
      peersRef.current[socketId]?.close();
      delete peersRef.current[socketId];
      if (audiosRef.current[socketId]) {
        audiosRef.current[socketId].srcObject = null;
        delete audiosRef.current[socketId];
      }
    };

    // WebRTC signaling: relay offer/answer/ICE
    const onSignal = async ({ signal, from }) => {
      if (!peersRef.current[from]) await createPeer(from, false);
      const pc = peersRef.current[from];
      if (!pc) return;
      try {
        if (signal.type === "offer") {
          await pc.setRemoteDescription(new RTCSessionDescription(signal));
          const ans = await pc.createAnswer();
          await pc.setLocalDescription(ans);
          socket.emit("voice-signal", { roomId, signal: ans, to: from });
        } else if (signal.type === "answer") {
          await pc.setRemoteDescription(new RTCSessionDescription(signal));
        } else if (signal.candidate) {
          await pc.addIceCandidate(new RTCIceCandidate(signal));
        }
      } catch (e) { console.warn("WebRTC signal error:", e); }
    };

    // Speaking indicator from another user
    const onSpeaking = ({ socketId, isSpeaking }) => {
      setVoiceUsers(prev =>
        prev.map(u => u.socketId === socketId ? { ...u, speaking: isSpeaking } : u)
      );
    };

    socket.on("chat-message",      onChat);
    socket.on("typing",            onTyping);
    socket.on("room-users",        onRoomUsers);
    socket.on("voice-user-joined", onVoiceJoined);
    socket.on("voice-user-left",   onVoiceLeft);
    socket.on("voice-signal",      onSignal);
    socket.on("user-speaking",     onSpeaking);

    return () => {
      socket.off("chat-message",      onChat);
      socket.off("typing",            onTyping);
      socket.off("room-users",        onRoomUsers);
      socket.off("voice-user-joined", onVoiceJoined);
      socket.off("voice-user-left",   onVoiceLeft);
      socket.off("voice-signal",      onSignal);
      socket.off("user-speaking",     onSpeaking);
    };
  }, [username, roomId]);

  // ── Voice: request mic and join channel ───────────────────
  async function joinVoice() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      localStreamRef.current = stream;
      setIsMicOn(true);
      detectSpeaking(stream);
      socket.emit("voice-join", { roomId });
    } catch (e) {
      console.warn("Mic unavailable:", e.message);
    }
  }

  // ── Voice: stop mic and leave channel ─────────────────────
  function leaveVoice() {
    localStreamRef.current?.getTracks().forEach(t => t.stop());
    localStreamRef.current = null;
    if (speakFrameRef.current) cancelAnimationFrame(speakFrameRef.current);
    Object.values(peersRef.current).forEach(pc => pc.close());
    peersRef.current = {};
    Object.values(audiosRef.current).forEach(a => { a.srcObject = null; });
    audiosRef.current = {};
    socket.emit("voice-leave", { roomId });
    setIsMicOn(false);
    setMySpeaking(false);
  }

  // ── Voice: toggle mute/unmute my mic ─────────────────────
  function toggleMic() {
    if (!localStreamRef.current) { joinVoice(); return; }
    const track = localStreamRef.current.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setIsMicOn(track.enabled);
    if (!track.enabled) socket.emit("speaking", { roomId, isSpeaking: false });
  }

  // ── Voice: adjust volume for a specific remote user ───────
  function setVolume(socketId, vol) {
    if (audiosRef.current[socketId]) audiosRef.current[socketId].volume = vol;
    setVoiceUsers(prev =>
      prev.map(u => u.socketId === socketId ? { ...u, volume: vol } : u)
    );
  }

  // ── Voice: locally mute/unmute a specific user ────────────
  function toggleMuteUser(socketId) {
    setVoiceUsers(prev => prev.map(u => {
      if (u.socketId !== socketId) return u;
      const muted = !u.muted;
      if (audiosRef.current[socketId]) audiosRef.current[socketId].muted = muted;
      return { ...u, muted };
    }));
  }

  // ── WebRTC: create peer connection with a remote user ─────
  async function createPeer(remoteId, isInitiator) {
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
      ],
    });
    peersRef.current[remoteId] = pc;

    // Add my local audio tracks to the connection
    localStreamRef.current?.getTracks().forEach(t =>
      pc.addTrack(t, localStreamRef.current)
    );

    // When remote audio arrives, play it
    pc.ontrack = (e) => {
      const audio = new Audio();
      audio.srcObject = e.streams[0];
      audio.autoplay  = true;
      audio.play().catch(() => {});
      const u = vuRef.current.find(u => u.socketId === remoteId);
      audio.volume = u?.volume ?? 1.0;
      audio.muted  = u?.muted  ?? false;
      audiosRef.current[remoteId] = audio;
    };

    // Relay ICE candidates through the server
    pc.onicecandidate = (e) => {
      if (e.candidate)
        socket.emit("voice-signal", {
          roomId, signal: e.candidate, to: remoteId, fromUsername: username,
        });
    };

    // Initiator creates and sends the offer
    if (isInitiator) {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit("voice-signal", {
        roomId, signal: offer, to: remoteId, fromUsername: username,
      });
    }
    return pc;
  }

  // ── WebRTC: detect speaking via Web Audio API ─────────────
  function detectSpeaking(stream) {
    try {
      const ctx      = new AudioContext();
      const src      = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      src.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      let lastState = false;
      function tick() {
        analyser.getByteFrequencyData(data);
        const avg = data.reduce((a, b) => a + b, 0) / data.length;
        const talking = avg > 20;
        if (talking !== lastState) {
          lastState = talking;
          setMySpeaking(talking);
          socket.emit("speaking", { roomId, isSpeaking: talking });
        }
        speakFrameRef.current = requestAnimationFrame(tick);
      }
      tick();
    } catch (e) { console.warn("Speaking detection failed:", e); }
  }

  // ── Chat: send a message ──────────────────────────────────
  function sendMessage() {
    if (!input.trim()) return;
    const msg = {
      username,
      message: input.trim(),
      time: new Date().toISOString(),
    };
    // Save locally immediately — don't wait for server echo
    saveMessage(roomId, msg);
    setMessages([...getHistory(roomId)]);
    socket.emit("chat-message", { roomId, message: input.trim() });
    setInput("");
  }

  function handleKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  }

  function handleInputChange(e) {
    setInput(e.target.value);
    socket.emit("typing", { roomId }); // notify others
  }

  return (
    <div className={`cvp ${theme}`}>

      {/* ── Header: tab switcher + theme toggle ── */}
      <div className="cvp-header">
        <div className="cvp-tabs">
          <button
            className={`cvp-tab${tab === "chat"  ? " on" : ""}`}
            onClick={() => setTab("chat")}
          >💬 Chat</button>
          <button
            className={`cvp-tab${tab === "voice" ? " on" : ""}`}
            onClick={() => setTab("voice")}
          >🎙 Voice</button>
        </div>
        <button
          className="cvp-theme-btn"
          onClick={() => setTheme(t => t === "dark" ? "light" : "dark")}
        >
          {theme === "dark" ? "☀️" : "🌙"}
        </button>
      </div>

      {/* ══ VOICE TAB — PUBG style ══ */}
      {tab === "voice" && (
        <div className="cvp-voice">

          {/* My own row */}
          <div className="cvp-me-row">
            <div className={`cvp-av${mySpeaking ? " speaking" : ""}${!isMicOn ? " muted" : ""}`}>
              {initials(username)}
            </div>
            <div className="cvp-vinfo">
              <span className="cvp-vname">
                {username} <span className="cvp-you">YOU</span>
              </span>
              <span className="cvp-vstatus">{isMicOn ? "🟢 Live" : "🔴 Muted"}</span>
            </div>
            {/* My mute button */}
            <button
              className={`cvp-mic${isMicOn ? " on" : " off"}`}
              onClick={toggleMic}
              title={isMicOn ? "Mute mic" : "Unmute mic"}
            >
              {isMicOn ? <MicOn /> : <MicOff />}
            </button>
          </div>

          <div className="cvp-section-label">IN CHANNEL</div>

          {voiceUsers.length === 0 && (
            <p className="cvp-empty">No one else in voice</p>
          )}

          {/* Remote users — PUBG style with volume sliders */}
          {voiceUsers.map(u => (
            <div key={u.socketId} className={`cvp-user-row${u.speaking ? " speaking" : ""}`}>
              <div className={`cvp-av sm${u.speaking ? " speaking" : ""}${u.muted ? " muted" : ""}`}>
                {initials(u.username)}
              </div>
              <div className="cvp-vinfo">
                <span className="cvp-vname">{u.username}</span>
                {/* Always-visible volume slider */}
                <div className="cvp-vol-row">
                  <span className="cvp-vol-icon"><VolOn /></span>
                  <input
                    type="range"
                    min="0" max="1" step="0.05"
                    value={u.muted ? 0 : u.volume}
                    className="cvp-vol"
                    onChange={e => { if (!u.muted) setVolume(u.socketId, parseFloat(e.target.value)); }}
                  />
                  <span className="cvp-vol-num">
                    {u.muted ? "0" : Math.round(u.volume * 100)}
                  </span>
                </div>
              </div>
              {/* Per-user mute toggle */}
              <button
                className={`cvp-mute-user${u.muted ? " muted" : ""}`}
                onClick={() => toggleMuteUser(u.socketId)}
                title={u.muted ? "Unmute" : "Mute"}
              >
                {u.muted ? <VolOff /> : <VolOn />}
              </button>
            </div>
          ))}
        </div>
      )}

      {/* ══ CHAT TAB — WhatsApp quality ══ */}
      {tab === "chat" && (
        <div className="cvp-chat">
          <div className="cvp-msgs">
            {messages.length === 0 && (
              <p className="cvp-empty">No messages yet 👋<br/>Say hello!</p>
            )}

            {messages.map((msg, i) => {
              const mine = msg.username === username;
              return (
                <div key={`${msg.username}-${msg.time}-${i}`} className={`cvp-msg${mine ? " mine" : " theirs"}`}>
                  {/* Show sender name for others' messages */}
                  {!mine && <span className="cvp-sender">{msg.username}</span>}
                  <div className="cvp-bubble">{msg.message}</div>
                  <span className="cvp-time">{fmtTime(msg.time)}</span>
                </div>
              );
            })}

            {/* Typing indicator */}
            {isTyping && (
              <div className="cvp-typing">
                <span className="cvp-dots"><span/><span/><span/></span>
                typing…
              </div>
            )}

            {/* Scroll anchor */}
            <div ref={bottomRef} />
          </div>

          {/* Input row */}
          <div className="cvp-input-row">
            <input
              className="cvp-input"
              type="text"
              placeholder="Message…"
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              maxLength={500}
              autoComplete="off"
            />
            <button className="cvp-send" onClick={sendMessage}>
              <Send />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default ChatVoicePanel;