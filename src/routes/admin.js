import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import XLSX from "xlsx";
import { Auction, Bid, Category, Contact, DEFAULT_SITE, getSiteSettings, Product, SiteSetting, Transaction, User, Winner } from "../models.js";
import { isExpired, isLive, isUpcoming, parseAssign, wrap } from "../helpers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadDir = path.resolve(__dirname, "../../uploads");
fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${file.originalname.replace(/\s+/g, "_")}`),
  }),
});

const router = Router();

function auctionFilter(rows, type) {
  if (type === "live") return rows.filter(isLive);
  if (type === "upcoming") return rows.filter(isUpcoming);
  if (type === "expired") return rows.filter(isExpired);
  if (type === "pending") return rows.filter((a) => Number(a.status) === 0 && !isExpired(a));
  return rows;
}

async function productFilter(type, auctionId) {
  let rows;
  if (type === "AuctionWise" && auctionId) {
    rows = await Product.find({ auction_id: Number(auctionId) }).sort({ id: -1 }).lean();
  } else if (type === "unsold" && auctionId) {
    const products = await Product.find({ auction_id: Number(auctionId) }).sort({ id: -1 }).lean();
    const sold = (await Winner.find({ product_id: { $in: products.map((p) => p.id) } }).lean()).map((w) => w.product_id);
    rows = products.filter((p) => !sold.includes(p.id));
  } else {
    rows = await Product.find().sort({ id: -1 }).lean();
    if (type === "live") rows = rows.filter(isLive);
    if (type === "upcoming") rows = rows.filter(isUpcoming);
    if (type === "expired") rows = rows.filter(isExpired);
    if (type === "pending") rows = rows.filter((p) => Number(p.status) === 0 && !isExpired(p));
  }
  return rows;
}

router.get("/lookups", wrap(async (_req, res) => {
  res.json({
    categories: await Category.find({ status: 1 }).lean(),
    auctions: await Auction.find({ status: 1 }).lean(),
  });
}));

router.get("/product/:id", wrap(async (req, res) => {
  const product = await Product.findOne({ id: Number(req.params.id) }).lean();
  if (!product) return res.status(404).json({ message: "Product not found" });
  res.json({ product });
}));

router.get("/dashboard", wrap(async (_req, res) => {
  const auctions = await Auction.find().lean();
  res.json({
    users: await User.countDocuments(),
    pending: await User.countDocuments({ approve: 0 }),
    auctions: auctions.length,
    products: await Product.countDocuments(),
    bids: await Bid.countDocuments(),
    liveAuctions: auctionFilter(auctions, "live").length,
  });
}));

router.get("/categories", wrap(async (_req, res) => {
  res.json({ categories: await Category.find().sort({ id: -1 }).lean() });
}));

router.post("/categories/:id?", wrap(async (req, res) => {
  const { name, icon, status } = req.body;
  if (!name) return res.status(422).json({ message: "Name is required" });
  if (req.params.id) {
    await Category.updateOne({ id: Number(req.params.id) }, { name, icon: icon || "las la-tags", status: status ? 1 : 0 });
    return res.json({ message: "Category updated successfully" });
  }
  await Category.create({ name, icon: icon || "las la-tags", status: 1 });
  res.json({ message: "Category created successfully" });
}));

router.get("/auctions/:type?", wrap(async (req, res) => {
  const type = req.params.type || "all";
  const rows = await Auction.find().sort({ id: -1 }).lean();
  res.json({ auctions: auctionFilter(rows, type), pageTitle: `${type} Auctions` });
}));

router.post("/auction-assign", wrap(async (req, res) => {
  const { user_id, user_check, auction_id } = req.body;
  const product = await Auction.findOne({ id: Number(auction_id) });
  if (!product) return res.status(404).json({ message: "Auction not found" });
  let current = parseAssign(product.assign_user);
  if (Number(user_check) === 1) {
    if (!current.includes(Number(user_id))) current.push(Number(user_id));
  } else {
    current = current.filter((id) => id !== Number(user_id));
  }
  const user = JSON.stringify(current);
  product.assign_user = user;
  await product.save();
  res.json(user);
}));

router.post("/auctions/:id?", wrap(async (req, res) => {
  const { name, icon, started_at, expired_at, status } = req.body;
  if (!name || !icon) return res.status(422).json({ message: "Name and icon are required" });
  if (req.params.id) {
    const a = await Auction.findOne({ id: Number(req.params.id) });
    if (!a) return res.status(404).json({ message: "Auction not found" });
    Object.assign(a, { name, icon, started_at, expired_at, status: status ? 1 : 0 });
    await a.save();
    return res.json({ message: "auction updated successfully" });
  }
  await Auction.create({ name, icon, started_at, expired_at, status: 1, assign_user: "[]" });
  res.json({ message: "auction created successfully" });
}));

router.get("/products/:type?", wrap(async (req, res) => {
  const type = req.params.type || "all";
  let rows = await productFilter(type, req.query.auction_id);
  const search = req.query.search;
  if (search) rows = rows.filter((p) => String(p.name || "").toLowerCase().includes(String(search).toLowerCase()));
  res.json({ products: rows, pageTitle: `${type} Products` });
}));

router.post("/products/approve", wrap(async (req, res) => {
  await Product.updateOne({ id: Number(req.body.id) }, { status: 1 });
  res.json({ message: "Product Approved Successfully" });
}));

router.post("/products", upload.single("image"), wrap(async (req, res) => {
  const b = req.body;
  if (!b.name || !b.category || !b.auction || b.price == null || b.min_bid_amount == null || !b.code) {
    return res.status(422).json({ message: "Required product fields missing" });
  }
  await Product.create({
    admin_id: req.auth.id,
    category_id: Number(b.category),
    auction_id: Number(b.auction),
    name: b.name,
    image: req.file ? req.file.filename : null,
    price: Number(b.price),
    min_bid_amount: Number(b.min_bid_amount),
    code: b.code,
    condition: b.condition || "",
    location: b.location || "",
    excise_duty: b.excise_duty || "",
    sales_duty: b.sales_duty || "",
    quantity: Number(b.quantity || 0),
    status: 1,
    started_at: b.started_at,
    expired_at: b.expired_at,
  });
  res.json({ message: "Product added successfully" });
}));

router.put("/products/:id", upload.single("image"), wrap(async (req, res) => {
  const product = await Product.findOne({ id: Number(req.params.id) });
  if (!product) return res.status(404).json({ message: "Product not found" });
  const b = req.body;
  Object.assign(product, {
    category_id: Number(b.category),
    auction_id: Number(b.auction),
    name: b.name,
    image: req.file ? req.file.filename : product.image,
    price: Number(b.price),
    min_bid_amount: Number(b.min_bid_amount),
    code: b.code,
    condition: b.condition || "",
    location: b.location || "",
    excise_duty: b.excise_duty || "",
    sales_duty: b.sales_duty || "",
    quantity: Number(b.quantity || 0),
    started_at: b.started_at,
    expired_at: b.expired_at,
  });
  await product.save();
  res.json({ message: "Product updated successfully" });
}));

router.post("/products/import", upload.single("import_file"), wrap(async (req, res) => {
  if (!req.file) return res.status(422).json({ message: "Import file required" });
  const workbook = XLSX.readFile(req.file.path);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet);
  for (const data of rows) {
    await Product.create({
      admin_id: req.auth.id,
      category_id: Number(req.body.category),
      auction_id: Number(req.body.auction),
      name: data.name,
      price: data.price || 0,
      min_bid_amount: data.min_bid_amount || 0,
      code: data.code || "",
      condition: data.condition || "",
      location: data.location || "",
      excise_duty: data.excise_duty || "",
      sales_duty: data.sales_duty || "",
      quantity: data.quantity || 0,
      status: 1,
      started_at: req.body.started_at,
      expired_at: req.body.expired_at,
    });
  }
  res.json({ message: "Product imported successfully" });
}));

router.get("/products/import/sample/excel", wrap(async (_req, res) => {
  const rows = [
    {
      name: "Steel Scrap Lot",
      price: 5000,
      min_bid_amount: 300,
      code: "322424",
      condition: "Used",
      location: "Chennai",
      excise_duty: 3,
      sales_duty: 2,
      quantity: 5,
    },
  ];
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Products");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  res.setHeader("Content-Disposition", "attachment; filename=ProductImportSample.xlsx");
  res.type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.send(buf);
}));

router.get("/products/:id/bids", wrap(async (req, res) => {
  const product = await Product.findOne({ id: Number(req.params.id) }).lean();
  const auction = product ? await Auction.findOne({ id: product.auction_id }).lean() : null;
  const bids = await Bid.findOne({ product_id: Number(req.params.id) }).lean();
  const transactions = await Transaction.find({ product_id: Number(req.params.id) }).sort({ id: -1 }).lean();
  for (const t of transactions) {
    const u = await User.findOne({ id: t.user_id }).lean();
    t.username = u?.username;
    t.product_name = product?.name;
  }
  res.json({ product, auction, bids, transactions });
}));

router.get("/products/:id/bids/excel", wrap(async (req, res) => {
  const transactions = await Transaction.find({ product_id: Number(req.params.id) }).sort({ id: -1 }).lean();
  for (const t of transactions) {
    const u = await User.findOne({ id: t.user_id }).lean();
    t.username = u?.username;
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(transactions), "Bids");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  res.setHeader("Content-Disposition", "attachment; filename=ProductBids.xlsx");
  res.type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet").send(buf);
}));

router.get("/auctions/:auction_id/sold/excel", wrap(async (req, res) => {
  const products = await Product.find({ auction_id: Number(req.params.auction_id) }).lean();
  const winners = await Winner.find({ product_id: { $in: products.map((p) => p.id) } }).lean();
  const rows = [];
  for (const w of winners) {
    const p = products.find((x) => x.id === w.product_id);
    const u = await User.findOne({ id: w.user_id }).lean();
    const b = await Bid.findOne({ id: w.bid_id }).lean();
    rows.push({ ...w, name: p?.name, code: p?.code, username: u?.username, amount: b?.amount });
  }
  const auction = await Auction.findOne({ id: Number(req.params.auction_id) }).lean();
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "Sold");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  res.setHeader("Content-Disposition", `attachment; filename=${auction?.name || "auction"}SoldProduct.xlsx`);
  res.type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet").send(buf);
}));

router.get("/auctions/:auction_id/unsold/excel", wrap(async (req, res) => {
  const products = await Product.find({ auction_id: Number(req.params.auction_id) }).lean();
  const sold = (await Winner.find({ product_id: { $in: products.map((p) => p.id) } }).lean()).map((w) => w.product_id);
  const unsold = products.filter((p) => !sold.includes(p.id));
  const auction = await Auction.findOne({ id: Number(req.params.auction_id) }).lean();
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(unsold), "Unsold");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  res.setHeader("Content-Disposition", `attachment; filename=${auction?.name || "auction"}UnsoldProduct.xlsx`);
  res.type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet").send(buf);
}));

router.get("/winners", wrap(async (_req, res) => {
  const winners = await Winner.find().sort({ id: -1 }).lean();
  const out = [];
  for (const w of winners) {
    const p = await Product.findOne({ id: w.product_id }).lean();
    const u = await User.findOne({ id: w.user_id }).lean();
    const b = await Bid.findOne({ id: w.bid_id }).lean();
    out.push({ ...w, product_name: p?.name, code: p?.code, username: u?.username, amount: b?.amount });
  }
  res.json({ winners: out });
}));

router.post("/products/delivered", (_req, res) => {
  res.json({ message: "Product marked as delivered" });
});

router.get("/user/:id", wrap(async (req, res) => {
  const user = await User.findOne({ id: Number(req.params.id) });
  if (!user) return res.status(404).json({ message: "User not found" });
  const safe = user.toJSON();
  delete safe.password;
  const auctions = await Auction.find().sort({ id: -1 }).lean();
  res.json({ user: safe, auctions });
}));

router.get("/users/:scope?", wrap(async (req, res) => {
  const scope = req.params.scope || "all";
  const filter = {};
  if (scope === "active") Object.assign(filter, { status: 1, approve: 1 });
  if (scope === "banned") filter.status = 0;
  if (scope === "pending") filter.approve = 0;
  let users = await User.find(filter).sort({ id: -1 }).select("-password").lean();
  if (req.query.search) {
    const q = String(req.query.search).toLowerCase();
    users = users.filter(
      (u) =>
        String(u.username).toLowerCase().includes(q) ||
        String(u.email).toLowerCase().includes(q) ||
        String(u.mobile || "").includes(q)
    );
  }
  res.json({ users });
}));

router.put("/users/:id", wrap(async (req, res) => {
  const user = await User.findOne({ id: Number(req.params.id) });
  if (!user) return res.status(404).json({ message: "User not found" });
  const b = req.body;
  Object.assign(user, {
    firstname: b.firstname,
    lastname: b.lastname,
    email: b.email,
    mobile: b.mobile,
    country: b.country,
    address: b.address || "",
    city: b.city || "",
    state: b.state || "",
    zip: b.zip || "",
    approve: b.approve ? 1 : 0,
    status: b.status ? 1 : 0,
  });
  await user.save();
  res.json({ message: "User detail has been updated" });
}));

router.get("/users/:id/bids", wrap(async (req, res) => {
  const bids = await Bid.find({ user_id: Number(req.params.id) }).sort({ id: -1 }).lean();
  for (const b of bids) {
    const p = await Product.findOne({ id: b.product_id }).lean();
    b.product_name = p?.name;
  }
  res.json({ bids });
}));

router.get("/contacts", wrap(async (_req, res) => {
  res.json({ contacts: await Contact.find().sort({ id: -1 }).lean() });
}));

router.get("/settings", wrap(async (_req, res) => {
  res.json({ settings: await getSiteSettings() });
}));

router.put("/settings", wrap(async (req, res) => {
  const allowed = Object.keys(DEFAULT_SITE).filter((k) => k !== "key");
  const patch = {};
  for (const k of allowed) {
    if (req.body[k] !== undefined && req.body[k] !== null) patch[k] = String(req.body[k]).trim();
  }
  const doc = await SiteSetting.findOneAndUpdate(
    { key: "site" },
    { $set: patch },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
  res.json({ message: "Brand settings saved", settings: doc.toJSON() });
}));

export default router;
