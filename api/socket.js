const { Server } = require("socket.io");
const app = require("../index");
const server = require("http").createServer(app);

const io = new Server(server, {
  cors: {
    origin: [
      "https://next-chat-app-client.vercel.app",
      "http://localhost:3000",
    ],
    methods: ["GET", "POST"],
    credentials: true,
  },
});

const connectedUsers = new Set();

io.on("connection", (socket) => {
  console.log("New client connected");

  socket.on("join", (username) => {
    console.log(`${username} joined the chat`);
    socket.username = username;
    connectedUsers.add(username);
    io.emit("updateUserStatus", Array.from(connectedUsers));
    socket.join(username);
  });

  socket.on("privateMessage", async ({ from, to, text }) => {
    try {
      const timestamp = new Date();
      const message = new Message({ from, to, text, timestamp });
      await message.save();
      console.log("Message saved:", message);

      socket.to(from).emit("privateMessage", { ...message._doc, timestamp });
      io.to(to).emit("privateMessage", { ...message._doc, timestamp });
    } catch (error) {
      console.error("Error saving message:", error);
    }
  });

  socket.on("markAsSeen", async ({ from, to }) => {
    try {
      await Message.updateMany(
        { from: from, to: to, seen: false },
        { $set: { seen: true } }
      );
      io.to(from).emit("messagesSeen", { from, to });
      io.to(to).emit("messagesSeen", { from, to });
    } catch (error) {
      console.error("Error marking messages as seen:", error);
    }
  });

  socket.on("disconnect", () => {
    console.log(`${socket.username} disconnected`);
    connectedUsers.delete(socket.username);
    io.emit("updateUserStatus", Array.from(connectedUsers));
  });
});

module.exports = (req, res) => {
  if (!res.socket.server.io) {
    res.socket.server.io = io;
  }
  res.end();
};
