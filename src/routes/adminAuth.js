import { Router } from "express";
import bcrypt from "bcryptjs";
import { Admin } from "../models.js";
import { authRequired, publicUser, signToken, wrap } from "../helpers.js";

const router = Router();

router.post("/login", wrap(async (req, res) => {
  const { username, password } = req.body;
  const admin = await Admin.findOne({ $or: [{ username }, { email: username }] });
  if (!admin || !bcrypt.compareSync(password, admin.password)) {
    return res.status(401).json({ message: "These credentials do not match our records." });
  }
  const token = signToken({ id: admin.id, role: "admin", username: admin.username });
  res.json({ token, admin: publicUser(admin) });
}));

router.get("/me", authRequired("admin"), wrap(async (req, res) => {
  const admin = await Admin.findOne({ id: req.auth.id });
  res.json({ admin: publicUser(admin) });
}));

export default router;
