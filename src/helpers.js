import jwt from "jsonwebtoken";
import crypto from "crypto";
import { Bid, Category, Auction } from "./models.js";

export const JWT_SECRET = process.env.JWT_SECRET || "change-this-auction-house-secret";

export function parseAssign(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(Number);
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(Number) : [];
  } catch {
    return [];
  }
}

export function assignedTo(auction, userId) {
  return parseAssign(auction.assign_user).includes(Number(userId));
}

/**
 * Auction open/close times are entered in India (IST, UTC+5:30) as
 * "YYYY-MM-DD HH:mm:ss" without a timezone. Parse them as IST so Live /
 * Upcoming works the same on local Windows and UTC hosts (e.g. Render).
 */
export function parseAuctionDate(value) {
  if (value == null || value === "") return NaN;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  const s = String(value).trim();
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(s)) {
    const t = new Date(s).getTime();
    return t;
  }
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (m) {
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    const h = Number(m[4]);
    const mi = Number(m[5]);
    const sec = Number(m[6] || 0);
    // IST = UTC+5:30 → convert to UTC epoch
    return Date.UTC(y, mo - 1, d, h - 5, mi - 30, sec);
  }
  return new Date(s).getTime();
}

export function isLive(row) {
  if (!row || Number(row.status) !== 1) return false;
  const n = Date.now();
  const start = parseAuctionDate(row.started_at);
  const end = parseAuctionDate(row.expired_at);
  if (Number.isNaN(start) || Number.isNaN(end)) return false;
  return start <= n && end > n;
}

export function isUpcoming(row) {
  if (!row || Number(row.status) !== 1) return false;
  const start = parseAuctionDate(row.started_at);
  if (Number.isNaN(start)) return false;
  return start > Date.now();
}

export function isExpired(row) {
  const end = parseAuctionDate(row.expired_at);
  if (Number.isNaN(end)) return false;
  return end <= Date.now();
}

export function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });
}

export function authRequired(role) {
  return (req, res, next) => {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) return res.status(401).json({ message: "Unauthenticated" });
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      if (role && decoded.role !== role) {
        return res.status(403).json({ message: "Forbidden" });
      }
      req.auth = decoded;
      next();
    } catch {
      return res.status(401).json({ message: "Unauthenticated" });
    }
  };
}

export function publicUser(user) {
  if (!user) return null;
  const obj = typeof user.toJSON === "function" ? user.toJSON() : { ...user };
  delete obj.password;
  return obj;
}

export function randomCode(len = 6) {
  return crypto.randomBytes(len).toString("hex").slice(0, len).toUpperCase();
}

export function trxId() {
  return crypto.randomBytes(10).toString("hex").toUpperCase();
}

export async function maxBid(productId) {
  const row = await Bid.findOne({ product_id: Number(productId) }).sort({ amount: -1 }).lean();
  return row?.amount || 0;
}

export async function bidCount(productId) {
  return Bid.countDocuments({ product_id: Number(productId) });
}

export async function enrichProduct(product, viewer) {
  const p = product.toJSON ? product.toJSON() : product;
  const category = p.category_id ? await Category.findOne({ id: p.category_id }).lean() : null;
  const auction = p.auction_id ? await Auction.findOne({ id: p.auction_id }).lean() : null;
  const current = await maxBid(p.id);
  return {
    ...p,
    category,
    auction,
    current_bid: current,
    bidder_count: await bidCount(p.id),
    next_min: current > 0 ? current + Number(p.min_bid_amount) : Number(p.price) + Number(p.min_bid_amount),
    is_live: isLive(p),
    viewer_code: viewer?.user_code || null,
  };
}

export async function topBidders(productId, viewer) {
  const rows = await Bid.find({ product_id: Number(productId) }).sort({ amount: -1 }).limit(3).lean();
  const { User } = await import("./models.js");
  const out = [];
  for (let i = 0; i < rows.length; i++) {
    const u = await User.findOne({ id: rows[i].user_id }).lean();
    out.push({
      ...rows[i],
      username: u?.username,
      user_code: u?.user_code,
      display_name:
        viewer && viewer.user_code && u?.user_code === viewer.user_code ? viewer.username : u?.user_code || "Bidder",
      position: i === 0 ? "h1" : i === 1 ? "h2" : "h3",
    });
  }
  return out;
}

export function wrap(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}
