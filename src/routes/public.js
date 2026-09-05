import { Router } from "express";
import { Auction, Contact, HeroSlide, getSiteSettings } from "../models.js";
import { isLive, isUpcoming, wrap } from "../helpers.js";

const router = Router();

const DEFAULT_SLIDES = [
  {
    image: "/media/hero-yard.jpg",
    kicker: "Live industrial lots",
    title: "Sell or buy with a recorded close",
    text: "Chennai floor lots with transparent bidding.",
    button_label: "View auctions",
    button_link: "/auction",
  },
  {
    image: "/media/hero-fleet.jpg",
    kicker: "Fleet & commercial vehicles",
    title: "Disposal that moves",
    text: "Vehicles and assets cleared through open auction.",
    button_label: "Disposal",
    button_link: "/disposal-auction",
  },
  {
    image: "/media/hero-floor.jpg",
    kicker: "The Chennai floor",
    title: "Procurement with control",
    text: "Source material and surplus with clear terms.",
    button_label: "Procurement",
    button_link: "/procurement-auction",
  },
];

router.get("/settings", wrap(async (_req, res) => {
  res.json({ settings: await getSiteSettings() });
}));

router.get("/slides", wrap(async (_req, res) => {
  const rows = await HeroSlide.find({ status: 1 }).sort({ sort_order: 1, id: 1 }).lean();
  if (!rows.length) return res.json({ slides: DEFAULT_SLIDES });
  res.json({
    slides: rows.map((s) => ({
      image: s.image?.startsWith("http") || s.image?.startsWith("/") ? s.image : `/uploads/${s.image}`,
      kicker: s.kicker || "",
      title: s.title || "",
      text: s.text || "",
      button_label: s.button_label || "Explore",
      button_link: s.button_link || "/auction",
    })),
  });
}));

router.get("/auctions", wrap(async (_req, res) => {
  const all = await Auction.find({ status: 1 }).sort({ id: -1 }).lean();
  res.json({
    live: all.filter(isLive),
    upcoming: all.filter(isUpcoming),
  });
}));

router.post("/contact", wrap(async (req, res) => {
  const b = req.body || {};
  const firm_name = String(b.firm_name || "").trim();
  const address = String(b.address || "").trim();
  const contact_person = String(b.contact_person || b.name || "").trim();
  const contact_no = String(b.contact_no || "").trim();
  const email = String(b.email || "").trim();
  const message = String(b.message || "").trim();

  if (!firm_name || !address || !contact_person || !contact_no || !email) {
    return res.status(422).json({ message: "Firm name, address, contact person, contact no and email are required" });
  }

  const settings = await getSiteSettings();
  const mailBody = (settings.vendorEnrolmentMail || "")
    .replace(/\{firm\}/gi, firm_name)
    .replace(/\{name\}/gi, contact_person);

  await Contact.create({
    type: "enquiry",
    firm_name,
    address,
    contact_person,
    contact_no,
    name: contact_person,
    email,
    subject: b.subject || `Vendor enquiry — ${firm_name}`,
    message: message || "Vendor enrolment enquiry",
    mail_sent: true,
    mail_note: `Common enrolment mail prepared for ${email} (admin: ${settings.adminNotifyEmail || "auction@gmail.com"}):\n\n${mailBody}`,
  });

  res.json({
    message: "Enquiry received. Enrolment documents, terms & registration fee details will be shared by email.",
    mail_preview: mailBody,
  });
}));

export default router;
