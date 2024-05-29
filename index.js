const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const dotenv = require("dotenv");
const http = require("http");
const { Server } = require("socket.io");

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5001;
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.CORS_ORIGIN,
    methods: ["GET", "POST", "DELETE"],
    credentials: true,
  },
});

// Connect to MongoDB
mongoose
  .connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => {
    console.log("Connected to MongoDB Atlas");
    server.listen(PORT, () => {
      console.log(`Server is running on http://localhost:${PORT}`);
    });
  })
  .catch((err) => console.error("Error connecting to MongoDB Atlas:", err));

app.use(
  cors({
    origin: process.env.CORS_ORIGIN,
    methods: ["GET", "POST", "DELETE"],
    credentials: true,
  })
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const chatUserSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
});

const messageSchema = new mongoose.Schema({
  from: String,
  to: String,
  text: String,
  timestamp: { type: Date, default: Date.now },
  seen: { type: Boolean, default: false },
});

const ChatUser = mongoose.model("ChatUser", chatUserSchema);
const Message = mongoose.model("Message", messageSchema);

app.post("/saveUsername", async (req, res) => {
  const { username } = req.body;

  if (!username) {
    return res.status(400).json({ error: "Username is required" });
  }

  try {
    const existingUser = await ChatUser.findOne({ username });

    if (existingUser) {
      return res
        .status(200)
        .json({ message: "Username already exists, proceeding to chat" });
    }

    const newUser = new ChatUser({ username });
    await newUser.save();
    res.status(200).json({ message: "Username saved successfully" });
  } catch (error) {
    console.error("Error saving username:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/chatUsers", async (req, res) => {
  try {
    const users = await ChatUser.find({});
    res.status(200).json(users);
  } catch (error) {
    console.error("Error fetching users:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/chatUsers/:username", async (req, res) => {
  const { username } = req.params;
  try {
    const user = await ChatUser.findOne({ username });
    if (user) {
      res.status(200).json(user);
    } else {
      res.status(404).json({ error: "User not found" });
    }
  } catch (error) {
    console.error("Error fetching user:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// New route to fetch messages between two users
app.get("/messages/:from/:to", async (req, res) => {
  const { from, to } = req.params;
  try {
    const messages = await Message.find({
      $or: [
        { from: from, to: to },
        { from: to, to: from },
      ],
    }).sort({ timestamp: 1 });
    res.status(200).json(messages);
  } catch (error) {
    console.error("Error fetching messages:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.delete("/messages/:id", async (req, res) => {
  const { id } = req.params;
  console.log("Received delete request for message ID:", id);
  try {
    const message = await Message.findByIdAndDelete(id);
    if (!message) {
      console.log("Message not found for ID:", id);
      return res.status(404).json({ error: "Message not found" });
    }
    res.status(200).json({ message: "Message deleted successfully" });
  } catch (error) {
    console.error("Error deleting message:", error);
    res.status(500).json({ error: "Internal server error" });
  }
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

app.get("/", (req, res) => {
  res.send("Hello");
});
