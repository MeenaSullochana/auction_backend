/**
 * Upsert rich dummy data for demos: live/upcoming/completed auctions,
 * bids, winners, contacts, and bidder01 assignment.
 * Safe to re-run — skips creating duplicates keyed by unique codes/emails.
 *
 * Usage: npm run seed:demo
 */
import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import { connectDb } from "./db.js";
import {
  Admin, Auction, Bid, Category, Contact, Product, SiteSetting, DEFAULT_SITE, User, Winner,
} from "./models.js";

dotenv.config();
await connectDb();

function istStamp(offsetMs = 0) {
  const d = new Date(Date.now() + offsetMs);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (t) => parts.find((p) => p.type === t)?.value || "00";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}:${get("second")}`;
}

const adminPass = bcrypt.hashSync("admin123", 10);
const userPass = bcrypt.hashSync("user1234", 10);

if (!(await SiteSetting.findOne({ key: "site" }))) {
  await SiteSetting.create(DEFAULT_SITE);
}

if (!(await Admin.findOne({ username: "admin" }))) {
  await Admin.create({
    name: "Super Admin",
    username: "admin",
    email: "admin@auction.test",
    password: adminPass,
  });
}

let bidder = await User.findOne({ username: "bidder01" });
if (!bidder) {
  bidder = await User.create({
    kind: "vendor",
    unique_id: "VN-DEMO-000001",
    firstname: "Demo",
    lastname: "Bidder",
    name: "Demo Bidder",
    username: "bidder01",
    email: "bidder@auction.test",
    mobile: "+919800000001",
    contact_no: "+919800000001",
    password: userPass,
    country: "India",
    country_code: "IN",
    mobile_code: "+91",
    firm_name: "Demo Scrap Traders",
    address: "12 Industrial Estate, Guindy, Chennai",
    contact_person: "Demo Bidder",
    gst_no: "33AAAAA0000A1Z5",
    pan_no: "AAAAA0000A",
    validation_status: "Validated",
    status: 1,
    approve: 1,
    user_code: "U9F21",
  });
} else {
  Object.assign(bidder, {
    kind: "vendor",
    firm_name: bidder.firm_name || "Demo Scrap Traders",
    address: bidder.address || "12 Industrial Estate, Guindy, Chennai",
    contact_person: bidder.contact_person || "Demo Bidder",
    contact_no: bidder.contact_no || bidder.mobile || "+919800000001",
    gst_no: bidder.gst_no || "33AAAAA0000A1Z5",
    pan_no: bidder.pan_no || "AAAAA0000A",
    validation_status: bidder.validation_status || "Validated",
    approve: 1,
    status: 1,
  });
  await bidder.save();
}

let bidder2 = await User.findOne({ username: "bidder02" });
if (!bidder2) {
  bidder2 = await User.create({
    kind: "vendor",
    unique_id: "VN-DEMO-000002",
    firstname: "Second",
    lastname: "Bidder",
    name: "Second Bidder",
    username: "bidder02",
    email: "bidder2@auction.test",
    mobile: "+919800000002",
    contact_no: "+919800000002",
    password: userPass,
    country: "India",
    firm_name: "Coastal Recyclers Pvt Ltd",
    address: "44 Ambattur Industrial Park, Chennai",
    contact_person: "Second Bidder",
    gst_no: "33BBBBB0000B1Z5",
    pan_no: "BBBBB0000B",
    validation_status: "Validated",
    status: 1,
    approve: 1,
    user_code: "U9F22",
  });
}

for (const name of ["Plant & Machinery", "Vehicles", "Scrap & Spares", "E-waste"]) {
  if (!(await Category.findOne({ name }))) {
    await Category.create({ name, icon: "las la-tags", status: 1 });
  }
}
const cat = await Category.findOne({ name: "E-waste" }) || await Category.findOne();

const liveStart = istStamp(-2 * 60 * 60 * 1000);
const liveEnd = istStamp(5 * 24 * 60 * 60 * 1000);
const upStart = istStamp(2 * 24 * 60 * 60 * 1000);
const upEnd = istStamp(9 * 24 * 60 * 60 * 1000);
const doneStart = istStamp(-10 * 24 * 60 * 60 * 1000);
const doneEnd = istStamp(-2 * 24 * 60 * 60 * 1000);

async function ensureAuction(key, payload) {
  let a = await Auction.findOne({ name: key });
  if (!a) {
    a = await Auction.create({
      name: key,
      unique_id: payload.unique_id,
      icon: "las la-gavel",
      status: 1,
      ...payload,
    });
  } else {
    Object.assign(a, payload);
    await a.save();
  }
  return a;
}

const live = await ensureAuction("Demo Live Disposal — Guindy", {
  unique_id: "AU-DEMO-LIVE01",
  started_at: liveStart,
  expired_at: liveEnd,
  assign_user: JSON.stringify([bidder.id, bidder2.id]),
  auction_type: "Open Auction",
  auction_category: "E-waste",
  firm: "Demo Scrap Traders",
  firm_kind: "Company",
  division: "Large Appliance",
  item_type: "Product",
  inv_type: "Good",
  goods_location: "Guindy Yard, Chennai",
  gst_mode: "exclusive",
});

const upcoming = await ensureAuction("Demo Upcoming Spare Parts", {
  unique_id: "AU-DEMO-UPC01",
  started_at: upStart,
  expired_at: upEnd,
  assign_user: JSON.stringify([bidder.id]),
  auction_type: "Open Auction",
  auction_category: "Liquidation",
  firm: "Coastal Recyclers Pvt Ltd",
  firm_kind: "Company",
  division: "Mobile",
  goods_location: "Ambattur Yard",
  gst_mode: "inclusive",
});

const completed = await ensureAuction("Demo Completed Plant Sale", {
  unique_id: "AU-DEMO-DONE01",
  started_at: doneStart,
  expired_at: doneEnd,
  assign_user: JSON.stringify([bidder.id, bidder2.id]),
  auction_type: "Open Auction",
  auction_category: "E-waste",
  firm: "Demo Scrap Traders",
  firm_kind: "Company",
  division: "Hardware & Electrical",
  goods_location: "Chennai Yard",
  gst_mode: "exclusive",
});

async function ensureProduct(code, auction, extra) {
  let p = await Product.findOne({ code });
  if (!p) {
    p = await Product.create({
      admin_id: 1,
      category_id: cat.id,
      auction_id: auction.id,
      code,
      status: 1,
      started_at: auction.started_at,
      expired_at: auction.expired_at,
      ...extra,
    });
  } else {
    Object.assign(p, {
      auction_id: auction.id,
      started_at: auction.started_at,
      expired_at: auction.expired_at,
      status: 1,
      ...extra,
    });
    await p.save();
  }
  return p;
}

const pLive1 = await ensureProduct("DEMO-LIVE-CNC", live, {
  name: "CNC Lathe Machine",
  price: 125000,
  min_bid_amount: 1000,
  quantity: 1,
  condition: "Used - Good",
  location: "Guindy Yard",
});
const pLive2 = await ensureProduct("DEMO-LIVE-PRESS", live, {
  name: "Hydraulic Press 50T",
  price: 80000,
  min_bid_amount: 500,
  quantity: 1,
  condition: "Working",
  location: "Guindy Yard",
});
await ensureProduct("DEMO-UPC-MOTOR", upcoming, {
  name: "Induction Motor Lot (10 pcs)",
  price: 45000,
  min_bid_amount: 500,
  quantity: 10,
  condition: "Mixed",
  location: "Ambattur Yard",
});
const pDone = await ensureProduct("DEMO-DONE-PANEL", completed, {
  name: "Electrical Panel Board",
  price: 35000,
  min_bid_amount: 500,
  quantity: 1,
  condition: "Used",
  location: "Chennai Yard",
});

async function ensureBid(productId, userId, amount) {
  let bid = await Bid.findOne({ product_id: productId, user_id: userId });
  if (!bid) {
    bid = await Bid.create({ product_id: productId, user_id: userId, amount, agent_amount: 0 });
  } else {
    bid.amount = amount;
    await bid.save();
  }
  return bid;
}

const bidLive = await ensureBid(pLive1.id, bidder.id, 128000);
await ensureBid(pLive1.id, bidder2.id, 126000);
await ensureBid(pLive2.id, bidder.id, 82000);
const bidDone = await ensureBid(pDone.id, bidder.id, 42000);
await ensureBid(pDone.id, bidder2.id, 40000);

if (!(await Winner.findOne({ product_id: pDone.id }))) {
  await Winner.create({ product_id: pDone.id, user_id: bidder.id, bid_id: bidDone.id });
}

if (!(await Contact.findOne({ email: "enquiry.demo@auction.test" }))) {
  await Contact.create({
    type: "enquiry",
    firm_name: "Demo Scrap Traders",
    address: "12 Industrial Estate, Guindy, Chennai",
    contact_person: "Demo Bidder",
    contact_no: "+919800000001",
    name: "Demo Bidder",
    email: "enquiry.demo@auction.test",
    subject: "Vendor enquiry — Demo Scrap Traders",
    message: "Please share enrolment documents and registration fee.",
    mail_sent: true,
    mail_note: "Demo enquiry seed",
  });
}

// Ensure bidder01 can see every active auction (demo convenience for existing rows like Hhheh)
const allActive = await Auction.find({ status: 1 });
for (const a of allActive) {
  let ids = [];
  try {
    ids = JSON.parse(a.assign_user || "[]").map(Number);
  } catch {
    ids = [];
  }
  if (!ids.includes(Number(bidder.id))) {
    ids.push(Number(bidder.id));
    a.assign_user = JSON.stringify(ids);
    await a.save();
  }
}

console.log("Demo seed complete.");
console.log("Admin:  admin / admin123");
console.log("Bidder: bidder01 / user1234  (assigned to Demo Live + Upcoming)");
console.log("Bidder: bidder02 / user1234");
console.log(`Live auction: ${live.name} (${live.unique_id}) open ${live.started_at} → ${live.expired_at}`);
console.log(`Sample bid on ${pLive1.code}: ₹${bidLive.amount}`);
process.exit(0);
