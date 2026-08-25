import { Router } from "express";
import { Auction, Contact, getSiteSettings } from "../models.js";
import { isLive, isUpcoming, wrap } from "../helpers.js";

const router = Router();

router.get("/settings", wrap(async (_req, res) => {
  res.json({ settings: await getSiteSettings() });
}));

router.get("/auctions", wrap(async (_req, res) => {
  const all = await Auction.find({ status: 1 }).sort({ id: -1 }).lean();
  res.json({
    live: all.filter(isLive),
    upcoming: all.filter(isUpcoming),
  });
}));

router.post("/contact", wrap(async (req, res) => {
  const { name, email, subject, message } = req.body;
  if (!name || !email || !subject || !message) {
    return res.status(422).json({ message: "All fields are required" });
  }
  await Contact.create({ name, email, subject, message });
  res.json({ message: "Thank You For Contacting us" });
}));

export default router;
