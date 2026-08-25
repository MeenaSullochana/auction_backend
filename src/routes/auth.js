import { Router } from "express";
import bcrypt from "bcryptjs";
import { User, PasswordReset } from "../models.js";
import { authRequired, publicUser, randomCode, signToken, wrap } from "../helpers.js";

const router = Router();

router.post("/register", wrap(async (req, res) => {
  const { firstname, lastname, email, mobile, password, password_confirmation, username, country, country_code, mobile_code } =
    req.body;
  if (!firstname || !lastname || !email || !mobile || !password || !username) {
    return res.status(422).json({ message: "All required fields must be filled" });
  }
  if (username.length < 6 || !/^[a-zA-Z0-9]+$/.test(username)) {
    return res.status(422).json({ message: "Username must be at least 6 alphanumeric characters" });
  }
  if (password.length < 6) {
    return res.status(422).json({ message: "Password must be at least 6 characters" });
  }
  if (password !== password_confirmation) {
    return res.status(422).json({ message: "Password confirmation does not match" });
  }
  const fullMobile = `${mobile_code || ""}${mobile}`;
  if (await User.findOne({ email: String(email).toLowerCase() })) {
    return res.status(422).json({ message: "The email has already been taken" });
  }
  if (await User.findOne({ username })) {
    return res.status(422).json({ message: "The username has already been taken" });
  }
  if (await User.findOne({ mobile: fullMobile })) {
    return res.status(422).json({ message: "The mobile number already exists" });
  }

  await User.create({
    firstname,
    lastname,
    username: username.trim(),
    email: String(email).toLowerCase().trim(),
    mobile: fullMobile,
    password: bcrypt.hashSync(password, 10),
    country: country || "India",
    country_code: country_code || "IN",
    mobile_code: mobile_code || "+91",
    status: 1,
    approve: 0,
  });

  return res.json({
    message: "You are registered with us successfully!!the approval process might take 24 hours. Please Try to login after 24 hours",
  });
}));

router.post("/check-user", wrap(async (req, res) => {
  const exist = { data: null, type: null };
  if (req.body.email) {
    exist.data = await User.findOne({ email: req.body.email }).select("id");
    exist.type = "email";
  }
  if (req.body.mobile) {
    exist.data = await User.findOne({ mobile: req.body.mobile }).select("id");
    exist.type = "mobile";
  }
  if (req.body.username) {
    exist.data = await User.findOne({ username: req.body.username }).select("id");
    exist.type = "username";
  }
  res.json(exist);
}));

router.post("/login", wrap(async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(422).json({ message: "Username and password are required" });
  }
  const user = await User.findOne({ $or: [{ username }, { email: username }] });
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ message: "These credentials do not match our records." });
  }
  if (Number(user.status) === 0) {
    return res.status(403).json({ message: "Your account has been deactivated." });
  }
  if (Number(user.approve) === 0) {
    return res.status(403).json({ message: "Your account is pending for approval." });
  }
  const token = signToken({ id: user.id, role: "user", username: user.username });
  res.json({ token, user: publicUser(user) });
}));

router.post("/password/email", wrap(async (req, res) => {
  const { email } = req.body;
  const user = await User.findOne({ email });
  if (!user) return res.status(422).json({ message: "Email not found" });
  const token = randomCode(6);
  await PasswordReset.deleteMany({ email });
  await PasswordReset.create({ email, token });
  res.json({ message: "Password reset code sent", code: token });
}));

router.post("/password/verify-code", wrap(async (req, res) => {
  const row = await PasswordReset.findOne({ email: req.body.email, token: req.body.code });
  if (!row) return res.status(422).json({ message: "Invalid verification code" });
  res.json({ message: "Code verified", token: row.token });
}));

router.post("/password/reset", wrap(async (req, res) => {
  const { email, token, password, password_confirmation } = req.body;
  if (password !== password_confirmation) {
    return res.status(422).json({ message: "Password confirmation does not match" });
  }
  const row = await PasswordReset.findOne({ email, token });
  if (!row) return res.status(422).json({ message: "Invalid token" });
  await User.updateOne({ email }, { password: bcrypt.hashSync(password, 10) });
  await PasswordReset.deleteMany({ email });
  res.json({ message: "Password changed successfully" });
}));

router.get("/me", authRequired("user"), wrap(async (req, res) => {
  const user = await User.findOne({ id: req.auth.id });
  res.json({ user: publicUser(user) });
}));

router.post("/change-password", authRequired("user"), wrap(async (req, res) => {
  const { current_password, password, password_confirmation } = req.body;
  const user = await User.findOne({ id: req.auth.id });
  if (!bcrypt.compareSync(current_password || "", user.password)) {
    return res.status(422).json({ message: "The password doesn't match!" });
  }
  if (password !== password_confirmation) {
    return res.status(422).json({ message: "Password confirmation does not match" });
  }
  if (!password || password.length < 6) {
    return res.status(422).json({ message: "Password must be at least 6 characters" });
  }
  user.password = bcrypt.hashSync(password, 10);
  await user.save();
  res.json({ message: "Password changes successfully." });
}));

export default router;
