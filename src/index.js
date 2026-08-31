import express from "express";
import cors from "cors";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { Server } from "socket.io";
import dotenv from "dotenv";
import { connectDb } from "./db.js";
import { User } from "./models.js";
import authRoutes from "./routes/auth.js";
import adminAuthRoutes from "./routes/adminAuth.js";
import publicRoutes from "./routes/public.js";
import userRoutes from "./routes/user.js";
import adminRoutes from "./routes/admin.js";
import { authRequired } from "./helpers.js";

dotenv.config();
await connectDb();

const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
const allowedOrigins = new Set([
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  frontendUrl,
]);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: (origin, cb) => cb(null, !origin || allowedOrigins.has(origin)),
    credentials: true,
  },
});
app.set("io", io);

app.use(cors({
  origin: (origin, cb) => cb(null, !origin || allowedOrigins.has(origin)),
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use("/uploads", express.static(path.resolve(__dirname, "../uploads")));

app.use("/api/public", publicRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/admin/auth", adminAuthRoutes);
app.use(
  "/api/user",
  authRequired("user"),
  async (req, res, next) => {
    req.user = await User.findOne({ id: req.auth.id }).lean();
    if (!req.user) return res.status(401).json({ message: "Unauthenticated" });
    next();
  },
  userRoutes
);
app.use("/api/admin", authRequired("admin"), adminRoutes);

app.get("/api/health", (_req, res) => res.json({ ok: true, db: "mongodb" }));

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ message: err.message || "Server error" });
});

io.on("connection", (socket) => {
  socket.on("join-product", (id) => socket.join(`product-${id}`));
});

const port = Number(process.env.PORT || 5000);
server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`Port ${port} is already in use. Stop the other process or change PORT in backend/.env`);
    process.exit(1);
  }
  throw err;
});
server.listen(port, "0.0.0.0", () => {
  console.log(`Auction House API running on http://127.0.0.1:${port}`);
});
