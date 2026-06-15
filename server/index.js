const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');


const app = express();
app.use(cors());


const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

// rooms: { roomId -> { senderId, receiverId|null } }
const rooms = {};

function makeRoomId() {
  return uuidv4().replace(/-/g, '').slice(0, 8).toUpperCase();
}

io.on('connection', (socket) => {

  // ── SENDER creates a room ──────────────────────────────
  socket.on('create-room', () => {
    const roomId = makeRoomId();
    rooms[roomId] = { senderId: socket.id, receiverId: null };
    socket.join(roomId);
    socket.emit('room-created', { roomId });
    console.log(`Room created: ${roomId} by ${socket.id}`);
  });

  // ── RECEIVER joins a room ──────────────────────────────
  socket.on('join-room', ({ roomId }) => {
    const room = rooms[roomId];
    if (!room) {
      socket.emit('join-error', { message: 'Room not found. Check the code and try again.' });
      return;
    }
if (room.receiverId) {
  const receiverSocket = io.sockets.sockets.get(room.receiverId);

  if (receiverSocket?.connected) {
    socket.emit("join-error", { message: "Room is already full." });
    return;
  }

  // old receiver disconnected, so clear stale receiver
  room.receiverId = null;
}
    room.receiverId = socket.id;
    socket.join(roomId);
    // Tell sender someone joined
    io.to(room.senderId).emit('receiver-joined', { roomId });
    socket.emit('join-success', { roomId });
    console.log(`Receiver ${socket.id} joined room ${roomId}`);
  });

  // ── WebRTC signaling relay ─────────────────────────────
  socket.on('offer', ({ roomId, offer }) => {
    const room = rooms[roomId];
    if (room?.receiverId) {
      io.to(room.receiverId).emit('offer', { offer });
    }
  });

  socket.on('answer', ({ roomId, answer }) => {
    const room = rooms[roomId];
    if (room?.senderId) {
      io.to(room.senderId).emit('answer', { answer });
    }
  });

  socket.on('ice-candidate', ({ roomId, candidate }) => {
    const room = rooms[roomId];
    if (!room) return;
    // Relay to the other peer
    const targetId = room.senderId === socket.id ? room.receiverId : room.senderId;
    if (targetId) io.to(targetId).emit('ice-candidate', { candidate });
  });

  // ── Transfer done signal ───────────────────────────────
  socket.on('transfer-done', ({ roomId }) => {
    const room = rooms[roomId];
    if (room?.senderId) {
      io.to(room.senderId).emit('transfer-done');
    }
  });

  // ── Disconnect: notify the other peer ─────────────────
  socket.on('disconnect', () => {
    for (const [roomId, room] of Object.entries(rooms)) {
      if (room.senderId === socket.id) {
        if (room.receiverId) io.to(room.receiverId).emit('peer-disconnected');
        delete rooms[roomId];
        console.log(`Room ${roomId} closed — sender left`);
      } else if (room.receiverId === socket.id) {
        if (room.senderId) io.to(room.senderId).emit('peer-disconnected');
        room.receiverId = null;
        console.log(`Room ${roomId} — receiver left`);
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));