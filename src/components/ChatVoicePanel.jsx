// src/components/ChatVoicePanel.jsx
import { useState, useEffect, useRef } from "react";
import { socket } from "../services/socket";
import "./ChatVoicePanel.css";

// ── SVG Icons ────────────────────────────────────────────────
const MicOnIcon  = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 1a4 4 0 0 1 4 4v6a4 4 0 0 1-8 0V5a4 4 0 0 1 4-4zm6 9a1 1 0 0 1 2 0 8 8 0 0 1-7 7.93V20h2a1 1 0 0 1 0 2H9a1 1 0 0 1 0-2h2v-2.07A8 8 0 0 1 4 10a1 1 0 0 1 2 0 6 6 0 0 0 12 0z"/></svg>;
const MicOffIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M2.71 3.71a1 1 0 0 1 1.41-1.41l17 17a1 1 0 0 1-1.41 1.41L17 18A8 8 0 0 1 4 10a1 1 0 0 1 2 0 6 6 0 0 0 8.64 5.39l-1.47-1.47A4 4 0 0 1 8 11V5a4 4 0 0 1 6.93-2.76l-1.44-1.44A6 6 0 0 0 6 10a1 1 0 0 1-2 0 8 8 0 0 1 1-3.87L2.71 3.71zM12 1a4 4 0 0 1 4 4v4.59l-6-6V5a4 4 0 0 1 2-3.46zM16 10a4 4 0 0 1-4 4 3.96 3.96 0 0 1-.78-.08l-1.49-1.49A4 4 0 0 1 11 13.93V20h2a1 1 0 0 1 0 2H9a1 1 0 0 1 0-2h2v-2.07A8 8 0 0 1 4 10a1 1 0 0 1 2 0 6 6 0 0 0 10 4.58V10z"/></svg>;
const SpeakerOn  = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/></svg>;
const SpeakerOff = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/></svg>;
const SendIcon   = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>;

function ChatVoicePanel({ roomId, username }) {
  // ── Chat state ──────────────────────────────────────────────
  const [messages, setMessages]   = useState([]);
  const [input, setInput]         = useState("");
  const [showChat, setShowChat]   = useState(true);
  const [theme, setTheme]         = useState(localStorage.getItem("chatTheme") || "dark");
  const [isTyping, setIsTyping]   = useState(false);

  // ── Voice state ─────────────────────────────────────────────
  const [isMicOn, setIsMicOn]     = useState(false);
  const [speaking, setSpeaking]   = useState(false);   // Am I speaking?
  const [voiceUsers, setVoiceUsers] = useState([]);    // Other users in voice

  // ── Refs ────────────────────────────────────────────────────
  const messagesEndRef      = useRef(null);
  const localStreamRef      = useRef(null);
  const peerConnectionsRef  = useRef({});   // socketId → RTCPeerConnection
  const remoteAudiosRef     = useRef({});   // socketId → Audio element
  const speakFrameRef       = useRef(null); // requestAnimationFrame handle
  const typingTimerRef      = useRef(null);

  // ── Persist theme ───────────────────────────────────────────
  useEffect(() => {
    localStorage.setItem("chatTheme", theme);
  }, [theme]);

  // ── Auto scroll to bottom on new message ───────────────────
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ── Auto-join voice on mount, cleanup on unmount ────────────
  useEffect(() => {
    joinVoice();
    return () => leaveVoice();
  }, []);

  // ── Socket listeners ────────────────────────────────────────
  useEffect(() => {
    // Incoming chat message from server
    const handleChat = (msg) => {
      // ✅ FIX: Don't add own messages (we add them instantly on send)
      if (msg.username === username) return;
      setMessages(prev => [...prev, msg]);
      setIsTyping(false);
    };

    // Someone is typing
    const handleTyping = ({ username: who }) => {
      if (who === username) return;
      setIsTyping(true);
      clearTimeout(typingTimerRef.current);
      typingTimerRef.current = setTimeout(() => setIsTyping(false), 2000);
    };

    // Server sends current room users when we join voice
    const handleRoomUsers = (users) => {
      setVoiceUsers(
        users
          .filter(u => u.username !== username)
          .map(u => ({ ...u, speaking: false, volume: 1.0 }))
      );
    };

    // Another user joined the voice channel — initiate WebRTC to them
    const handleVoiceUserJoined = async ({ socketId, username: remoteUser }) => {
      setVoiceUsers(prev => {
        if (prev.find(u => u.socketId === socketId)) return prev;
        return [...prev, { socketId, username: remoteUser, speaking: false, volume: 1.0 }];
      });
      // We are the initiator since they just joined
      await createPeerConnection(socketId, true);
    };

    // A user left voice
    const handleVoiceUserLeft = ({ socketId }) => {
      setVoiceUsers(prev => prev.filter(u => u.socketId !== socketId));
      peerConnectionsRef.current[socketId]?.close();
      delete peerConnectionsRef.current[socketId];
      if (remoteAudiosRef.current[socketId]) {
        remoteAudiosRef.current[socketId].srcObject = null;
        delete remoteAudiosRef.current[socketId];
      }
    };

    // WebRTC signal: offer / answer / ICE candidate
    const handleVoiceSignal = async ({ signal, from }) => {
      // Create peer connection if we don't have one yet (they initiated)
      if (!peerConnectionsRef.current[from]) {
        await createPeerConnection(from, false);
      }
      const pc = peerConnectionsRef.current[from];
      if (!pc) return;

      try {
        if (signal.type === "offer") {
          await pc.setRemoteDescription(new RTCSessionDescription(signal));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          socket.emit("voice-signal", { roomId, signal: answer, to: from, fromUsername: username });

        } else if (signal.type === "answer") {
          await pc.setRemoteDescription(new RTCSessionDescription(signal));

        } else if (signal.candidate) {
          // ICE candidate
          await pc.addIceCandidate(new RTCIceCandidate(signal));
        }
      } catch (err) {
        console.warn("Voice signal error:", err);
      }
    };

    // Speaking indicator from another user
    const handleUserSpeaking = ({ socketId, isSpeaking }) => {
      setVoiceUsers(prev =>
        prev.map(u => u.socketId === socketId ? { ...u, speaking: isSpeaking } : u)
      );
    };

    socket.on("chat-message",     handleChat);
    socket.on("typing",           handleTyping);
    socket.on("room-users",       handleRoomUsers);
    socket.on("voice-user-joined",handleVoiceUserJoined);
    socket.on("voice-user-left",  handleVoiceUserLeft);
    socket.on("voice-signal",     handleVoiceSignal);
    socket.on("user-speaking",    handleUserSpeaking);

    return () => {
      socket.off("chat-message",      handleChat);
      socket.off("typing",            handleTyping);
      socket.off("room-users",        handleRoomUsers);
      socket.off("voice-user-joined", handleVoiceUserJoined);
      socket.off("voice-user-left",   handleVoiceUserLeft);
      socket.off("voice-signal",      handleVoiceSignal);
      socket.off("user-speaking",     handleUserSpeaking);
    };
  }, [username, roomId]);

  // ── Voice: join voice channel ───────────────────────────────
  async function joinVoice() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      localStreamRef.current = stream;
      setIsMicOn(true);
      detectSpeaking(stream);
      socket.emit("voice-join", { roomId, username });
    } catch (err) {
      console.warn("Mic unavailable:", err.message);
    }
  }

  // ── Voice: leave voice channel ──────────────────────────────
  function leaveVoice() {
    localStreamRef.current?.getTracks().forEach(t => t.stop());
    localStreamRef.current = null;
    if (speakFrameRef.current) cancelAnimationFrame(speakFrameRef.current);
    Object.values(peerConnectionsRef.current).forEach(pc => pc.close());
    peerConnectionsRef.current = {};
    Object.values(remoteAudiosRef.current).forEach(a => { a.srcObject = null; });
    remoteAudiosRef.current = {};
    socket.emit("voice-leave", { roomId });
    setIsMicOn(false);
    setSpeaking(false);
  }

  // ── Voice: mute/unmute toggle ───────────────────────────────
  function toggleMic() {
    if (!localStreamRef.current) { joinVoice(); return; }
    const track = localStreamRef.current.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setIsMicOn(track.enabled);
    if (!track.enabled) socket.emit("speaking", { roomId, isSpeaking: false });
  }

  // ── Voice: volume slider for a remote user ──────────────────
  function setUserVolume(socketId, volume) {
    if (remoteAudiosRef.current[socketId]) {
      remoteAudiosRef.current[socketId].volume = volume;
    }
    setVoiceUsers(prev =>
      prev.map(u => u.socketId === socketId ? { ...u, volume } : u)
    );
  }

  // ── WebRTC: create peer connection ──────────────────────────
  async function createPeerConnection(remoteSocketId, isInitiator) {
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
      ],
    });
    peerConnectionsRef.current[remoteSocketId] = pc;

    // Add local audio tracks to the connection
    localStreamRef.current?.getTracks().forEach(track => {
      pc.addTrack(track, localStreamRef.current);
    });

    // When remote audio arrives, play it
    pc.ontrack = (event) => {
      const audio = new Audio();
      audio.srcObject = event.streams[0];
      audio.autoplay = true;
      audio.volume = voiceUsers.find(u => u.socketId === remoteSocketId)?.volume ?? 1.0;
      remoteAudiosRef.current[remoteSocketId] = audio;
    };

    // Relay ICE candidates through server
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit("voice-signal", {
          roomId,
          signal: event.candidate,
          to: remoteSocketId,
          fromUsername: username,
        });
      }
    };

    // If we are the initiator, create and send the offer
    if (isInitiator) {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit("voice-signal", {
        roomId,
        signal: offer,
        to: remoteSocketId,
        fromUsername: username,
      });
    }

    return pc;
  }

  // ── Speaking detection using Web Audio API ──────────────────
  function detectSpeaking(stream) {
    try {
      const ctx      = new AudioContext();
      const source   = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);

      const data = new Uint8Array(analyser.frequencyBinCount);
      let lastState = false;

      function check() {
        analyser.getByteFrequencyData(data);
        const avg = data.reduce((a, b) => a + b, 0) / data.length;
        const talking = avg > 20;
        if (talking !== lastState) {
          lastState = talking;
          setSpeaking(talking);
          socket.emit("speaking", { roomId, isSpeaking: talking });
        }
        speakFrameRef.current = requestAnimationFrame(check);
      }
      check();
    } catch (err) {
      console.warn("Speaking detection failed:", err);
    }
  }

  // ── Chat: send message ──────────────────────────────────────
  function sendMessage() {
    if (!input.trim()) return;
    const msg = {
      username,
      message: input.trim(),
      time: new Date().toISOString(),
    };
    // Add own message immediately (server echoes back but we skip it in handleChat)
    setMessages(prev => [...prev, msg]);
    socket.emit("chat-message", { roomId, username, message: input.trim() });
    setInput("");
  }

  function handleInput(e) {
    setInput(e.target.value);
    socket.emit("typing", { roomId, username });
  }

  function handleKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  const formatTime = (iso) => {
    try { return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); }
    catch { return ""; }
  };

  const getInitials = (name) => name?.slice(0, 2).toUpperCase() || "??";

  return (
    <div className={`panel ${theme}`}>

      {/* ── Top bar ── */}
      <div className="panel-top">
        <span className="panel-title">🎮 Room Panel</span>
        <button className="theme-btn" onClick={() => setTheme(t => t === "dark" ? "light" : "dark")}>
          {theme === "dark" ? "☀️ Light" : "🌙 Dark"}
        </button>
      </div>

      {/* ══ VOICE SECTION ══ */}
      <div className="voice-section">

        {/* My avatar */}
        <div className="voice-user-col">
          <div className={`voice-avatar ${speaking ? "speaking" : ""} ${!isMicOn ? "muted" : ""}`}>
            {getInitials(username)}
            <span className="mic-icon">{isMicOn ? <MicOnIcon /> : <MicOffIcon />}</span>
          </div>
          <span className="voice-name">{username} (you)</span>
          <button className={`mic-toggle ${isMicOn ? "on" : "off"}`} onClick={toggleMic}>
            {isMicOn ? <MicOnIcon /> : <MicOffIcon />}
            {isMicOn ? " Live" : " Muted"}
          </button>
        </div>

        {/* Other voice users */}
        {voiceUsers.map(u => (
          <div key={u.socketId} className="voice-user-col">
            <div className={`voice-avatar ${u.speaking ? "speaking" : ""}`}>
              {getInitials(u.username)}
            </div>
            <span className="voice-name">{u.username}</span>
            <div className="vol-control">
              <span className="vol-icon">{u.volume > 0 ? <SpeakerOn /> : <SpeakerOff />}</span>
              <input
                type="range" min="0" max="1" step="0.1"
                value={u.volume}
                className="vol-slider"
                onChange={e => setUserVolume(u.socketId, parseFloat(e.target.value))}
              />
            </div>
          </div>
        ))}

        {voiceUsers.length === 0 && (
          <div className="waiting-voice">Waiting for others to join voice...</div>
        )}
      </div>

      {/* ══ CHAT SECTION ══ */}
      <div className="chat-section">
        <div className="chat-header" onClick={() => setShowChat(p => !p)}>
          <span>💬 Chat</span>
          <span className="chat-chevron">{showChat ? "▲" : "▼"}</span>
        </div>

        {showChat && (
          <>
            <div className="messages">
              {messages.length === 0 && <p className="no-messages">No messages yet 👋</p>}
              {messages.map((msg, i) => (
                <div key={i} className={`message ${msg.username === username ? "mine" : "theirs"}`}>
                  {msg.username !== username && (
                    <span className="msg-sender">{msg.username}</span>
                  )}
                  <span className="msg-text">{msg.message}</span>
                  <span className="msg-time">{formatTime(msg.time)}</span>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            {isTyping && (
              <div className="typing">
                <span className="typing-dots"><span/><span/><span/></span>
                someone is typing...
              </div>
            )}

            <div className="chat-input-row">
              <input
                type="text"
                placeholder="Type a message..."
                value={input}
                onChange={handleInput}
                onKeyDown={handleKeyDown}
                className="chat-input"
                maxLength={500}
              />
              <button className="send-btn" onClick={sendMessage}><SendIcon /></button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default ChatVoicePanel;