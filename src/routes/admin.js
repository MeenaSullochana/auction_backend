import { Router } from "express";
import bcrypt from "bcryptjs";
import multer from "multer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import XLSX from "xlsx";
import { Auction, Bid, Category, Contact, Company, DEFAULT_SITE, getSiteSettings, HeroSlide, Product, SiteSetting, Transaction, User, Vendor, Winner } from "../models.js";
import { isExpired, isLive, isUpcoming, maxBid, parseAssign, topBidders, wrap } from "../helpers.js";

async function nextAuctionUniqueId(dateStr) {
  let d = dateStr ? new Date(String(dateStr).replace(" ", "T")) : new Date();
  if (Number.isNaN(d.getTime())) d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const prefix = `AU-${y}${m}${day}-`;
  for (let attempt = 0; attempt < 40; attempt++) {
    const rand = String(Math.floor(100000 + Math.random() * 900000));
    const id = `${prefix}${rand}`;
    const exists = await Auction.findOne({ unique_id: id }).lean();
    if (!exists) return id;
  }
  return `${prefix}${Date.now().toString().slice(-6)}`;
}

async function reserveUniqueId(preferred, dateStr) {
  if (preferred && typeof preferred === "string") {
    const id = preferred.trim();
    if (/^AU-\d{8}-\d{6}$/.test(id)) {
      const exists = await Auction.findOne({ unique_id: id }).lean();
      if (!exists) return id;
    }
  }
  return nextAuctionUniqueId(dateStr);
}

function auctionStatusLabel(a) {
  if (Number(a.status) === 0) return "Pending";
  if (isLive(a)) return "Live";
  if (isUpcoming(a)) return "Open";
  if (isExpired(a)) return "Completed";
  return "Pending";
}

function sendExcel(res, rows, filename, sheet = "Report") {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheet);
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  res.setHeader("Content-Disposition", `attachment; filename=${filename}`);
  res.type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.send(buf);
}

async function auctionReportRows(filterFn) {
  let rows = await Auction.find().sort({ id: -1 }).lean();
  if (filterFn) rows = rows.filter(filterFn);
  const out = [];
  for (const a of rows) {
    const products = await Product.find({ auction_id: a.id }).lean();
    const winners = await Winner.find({ product_id: { $in: products.map((p) => p.id) } }).lean();
    const bids = await Bid.find({ product_id: { $in: products.map((p) => p.id) } }).lean();
    const revenue = winners.reduce((sum, w) => {
      const b = bids.find((x) => x.id === w.bid_id || (x.product_id === w.product_id && x.user_id === w.user_id));
      return sum + Number(b?.amount || 0);
    }, 0);
    out.push({
      Unique_ID: a.unique_id || `AU-${a.id}`,
      Name: a.name,
      Auction_Type: a.auction_type || "",
      Category: a.auction_category || "",
      Firm: a.firm || "",
      Firm_Kind: a.firm_kind || "",
      Division: a.division || "",
      Type: a.item_type || "",
      Inv_Type: a.inv_type || "",
      Goods_Location: a.goods_location || "",
      GST_Mode: a.gst_mode || "",
      Open: a.started_at,
      Close: a.expired_at,
      Status: auctionStatusLabel(a),
      Products: products.length,
      Winners: winners.length,
      Revenue: revenue,
    });
  }
  return out;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadDir = path.resolve(__dirname, "../../uploads");
fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${file.originalname.replace(/\s+/g, "_")}`),
  }),
});

function mapFiles(files = [], kind = "file") {
  return (files || []).map((f) => ({
    filename: f.filename,
    originalname: f.originalname,
    mimetype: f.mimetype,
    kind: String(f.mimetype || "").startsWith("image/") ? "image" : kind,
  }));
}

async function nextEntityUniqueId(Model, prefix) {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const head = `${prefix}-${y}${m}${day}-`;
  for (let i = 0; i < 40; i++) {
    const id = `${head}${String(Math.floor(100000 + Math.random() * 900000))}`;
    const exists = await Model.findOne({ unique_id: id }).lean();
    if (!exists) return id;
  }
  return `${head}${Date.now().toString().slice(-6)}`;
}

const uploadDocs = upload.fields([
  { name: "documents", maxCount: 20 },
  { name: "images", maxCount: 20 },
  { name: "files", maxCount: 20 },
  { name: "image", maxCount: 1 },
]);

const router = Router();

function auctionFilter(rows, type) {
  if (type === "live") return rows.filter(isLive);
  if (type === "upcoming") return rows.filter(isUpcoming);
  if (type === "expired" || type === "completed") return rows.filter(isExpired);
  if (type === "pending") return rows.filter((a) => Number(a.status) === 0 && !isExpired(a));
  return rows;
}

async function resolveCategoryId(explicit, auction) {
  if (explicit !== undefined && explicit !== null && String(explicit).trim() !== "") {
    return Number(explicit);
  }
  const name = auction?.auction_category || "E-waste";
  let cat = await Category.findOne({ name }).lean();
  if (!cat) {
    cat = await Category.create({ name, icon: "las la-tags", status: 1 });
  }
  return cat.id;
}

async function productFilter(type, auctionId) {
  let rows;
  if (type === "AuctionWise") {
    if (!auctionId) return [];
    rows = await Product.find({ auction_id: Number(auctionId) }).sort({ id: -1 }).lean();
  } else if (type === "unsold") {
    if (!auctionId) return [];
    const products = await Product.find({ auction_id: Number(auctionId) }).sort({ id: -1 }).lean();
    const sold = (await Winner.find({ product_id: { $in: products.map((p) => p.id) } }).lean()).map((w) => w.product_id);
    rows = products.filter((p) => !sold.includes(p.id));
  } else {
    rows = await Product.find().sort({ id: -1 }).lean();
    if (auctionId) rows = rows.filter((p) => Number(p.auction_id) === Number(auctionId));
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
    next_unique_id: await nextAuctionUniqueId(),
  });
}));

router.get("/auctions/next-unique-id", wrap(async (req, res) => {
  const id = await nextAuctionUniqueId(req.query.date || "");
  res.json({ unique_id: id });
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

async function hydrateAuction(a) {
  const updates = {};
  if (!a.unique_id) updates.unique_id = await nextAuctionUniqueId(a.started_at);
  if (!a.auction_type) updates.auction_type = "Open Auction";
  if (!a.auction_category) updates.auction_category = "E-waste";
  if (a.firm == null || a.firm === undefined) updates.firm = a.firm || "";
  if (!a.firm_kind) updates.firm_kind = "Company";
  if (!a.division) updates.division = "Mobile";
  if (!a.item_type) updates.item_type = "Product";
  if (!a.inv_type) updates.inv_type = "Good";
  if (a.goods_location == null) updates.goods_location = "";
  if (!a.gst_mode) updates.gst_mode = "exclusive";
  if (Object.keys(updates).length) {
    await Auction.updateOne({ id: a.id }, { $set: updates });
    return { ...a, ...updates };
  }
  return a;
}

router.get("/auction/:id", wrap(async (req, res) => {
  const a = await Auction.findOne({ id: Number(req.params.id) }).lean();
  if (!a) return res.status(404).json({ message: "Auction not found" });
  res.json({ auction: await hydrateAuction(a) });
}));

/** Admin live bidding room — full auction + H1/H2/H3 per item. */
router.get("/auction/:id/live-room", wrap(async (req, res) => {
  const raw = await Auction.findOne({ id: Number(req.params.id) }).lean();
  if (!raw) return res.status(404).json({ message: "Auction not found" });
  const auction = await hydrateAuction(raw);
  const products = await Product.find({ auction_id: auction.id, status: { $ne: 0 } }).sort({ id: 1 }).lean();
  const productIds = products.map((p) => p.id);
  const assignedIds = parseAssign(auction.assign_user);
  const allBids = productIds.length
    ? await Bid.find({ product_id: { $in: productIds } }).lean()
    : [];
  const activeBidderIds = [...new Set(allBids.map((b) => Number(b.user_id)))];

  const items = [];
  for (const p of products) {
    const tops = await topBidders(p.id, null);
    const winner = await Winner.findOne({ product_id: p.id }).lean();
    const current = await maxBid(p.id);
    const h = (i) => {
      const row = tops[i];
      if (!row) return { value: null, username: null, user_id: null };
      return {
        value: row.amount,
        username: row.username || row.display_name || null,
        user_id: row.user_id,
      };
    };
    items.push({
      id: p.id,
      name: p.name,
      code: p.code,
      quantity: p.quantity,
      price: p.price,
      min_bid_amount: p.min_bid_amount,
      current_bid: current,
      price_label: current > 0 ? current : p.price,
      h1: h(0),
      h2: h(1),
      h3: h(2),
      sold: !!winner,
      winner_user_id: winner?.user_id || null,
      status_label: winner ? "Sold" : "Unsold",
      is_live: isLive(p) || isLive(auction),
    });
  }

  res.json({
    auction: {
      ...auction,
      phase: auctionStatusLabel(auction),
      assigned_count: assignedIds.length,
      active_bidders: activeBidderIds.length,
      bidder_ratio: `${activeBidderIds.length} / ${assignedIds.length || 0}`,
    },
    items,
  });
}));

router.post("/auction/:id/products/:productId/mark-sold", wrap(async (req, res) => {
  const product = await Product.findOne({
    id: Number(req.params.productId),
    auction_id: Number(req.params.id),
  });
  if (!product) return res.status(404).json({ message: "Product not found" });
  let win = await Winner.findOne({ product_id: product.id });
  if (win) return res.json({ message: "Already sold", winner: win });
  const maxbid = await Bid.findOne({ product_id: product.id }).sort({ amount: -1 });
  if (!maxbid) return res.status(422).json({ message: "No bids to award" });
  win = await Winner.create({
    product_id: product.id,
    user_id: maxbid.user_id,
    bid_id: maxbid.id,
  });
  res.json({ message: "Marked sold", winner: win });
}));

router.get("/auctions/:type?", wrap(async (req, res) => {
  const type = req.params.type || "all";
  const rows = await Auction.find().sort({ id: -1 }).lean();
  const hydrated = [];
  for (const a of rows) {
    const h = await hydrateAuction(a);
    hydrated.push({
      ...h,
      phase: auctionStatusLabel(h),
      assigned_count: parseAssign(h.assign_user).length,
    });
  }
  res.json({ auctions: auctionFilter(hydrated, type), pageTitle: `${type} Auctions` });
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
  const b = req.body;
  const name = b.name;
  const icon = b.icon || "las la-gavel";
  if (!name) return res.status(422).json({ message: "Name is required" });
  const payload = {
    name,
    icon,
    started_at: b.started_at,
    expired_at: b.expired_at,
    status: b.status === 0 || b.status === "0" ? 0 : 1,
    auction_type: b.auction_type || "Open Auction",
    auction_category: b.auction_category || "E-waste",
    firm: b.firm || "",
    firm_kind: b.firm_kind || "Company",
    division: b.division || "Mobile",
    item_type: b.item_type || "Product",
    inv_type: b.inv_type || "Good",
    goods_location: b.goods_location || "",
    gst_mode: b.gst_mode || "exclusive",
  };
  if (req.params.id) {
    const a = await Auction.findOne({ id: Number(req.params.id) });
    if (!a) return res.status(404).json({ message: "Auction not found" });
    Object.assign(a, payload);
    await a.save();
    return res.json({ message: "auction updated successfully", auction: a });
  }
  payload.unique_id = await reserveUniqueId(b.unique_id, b.started_at || new Date().toISOString());
  payload.assign_user = "[]";
  const created = await Auction.create(payload);
  res.json({ message: "auction created successfully", auction: created });
}));

router.get("/products/:type?", wrap(async (req, res) => {
  const type = req.params.type || "all";
  const auctionId = req.query.auction_id;
  let rows = await productFilter(type, auctionId);
  const search = req.query.search;
  if (search) rows = rows.filter((p) => String(p.name || "").toLowerCase().includes(String(search).toLowerCase()));
  let auction = null;
  if (auctionId) {
    auction = await Auction.findOne({ id: Number(auctionId) }).lean();
    if (auction) auction = await hydrateAuction(auction);
  }
  res.json({ products: rows, auction, pageTitle: `${type} Products` });
}));

router.post("/products/approve", wrap(async (req, res) => {
  await Product.updateOne({ id: Number(req.body.id) }, { status: 1 });
  res.json({ message: "Product Approved Successfully" });
}));

router.post("/products", upload.single("image"), wrap(async (req, res) => {
  const b = req.body || {};
  const name = String(b.name || "").trim();
  const code = String(b.code || "").trim();
  const auctionId = b.auction ?? b.auction_id;
  const priceRaw = b.price;
  const minBidRaw = b.min_bid_amount;
  const missing = [];
  if (!name) missing.push("name");
  if (!code) missing.push("code");
  if (auctionId === undefined || auctionId === null || String(auctionId).trim() === "") missing.push("auction");
  if (priceRaw === undefined || priceRaw === null || String(priceRaw).trim() === "") missing.push("price");
  if (minBidRaw === undefined || minBidRaw === null || String(minBidRaw).trim() === "") missing.push("min_bid_amount");
  if (missing.length) {
    return res.status(422).json({ message: `Required product fields missing: ${missing.join(", ")}` });
  }
  const auction = await Auction.findOne({ id: Number(auctionId) }).lean();
  if (!auction) return res.status(404).json({ message: "Auction not found" });
  const categoryId = await resolveCategoryId(b.category, auction);
  await Product.create({
    admin_id: req.auth.id,
    category_id: categoryId,
    auction_id: Number(auctionId),
    name,
    image: req.file ? req.file.filename : null,
    price: Number(priceRaw),
    min_bid_amount: Number(minBidRaw),
    code,
    condition: b.condition || (b.is_combo === "1" || b.is_combo === true || b.is_combo === "true" ? "Combo" : ""),
    location: b.location || auction.goods_location || "",
    excise_duty: b.excise_duty || "",
    sales_duty: b.sales_duty || "",
    quantity: Number(b.quantity || 0),
    status: 1,
    started_at: b.started_at || auction.started_at,
    expired_at: b.expired_at || auction.expired_at,
    gst_mode: auction.gst_mode || "exclusive",
  });
  res.json({ message: "Product added successfully" });
}));

router.put("/products/:id", upload.single("image"), wrap(async (req, res) => {
  const product = await Product.findOne({ id: Number(req.params.id) });
  if (!product) return res.status(404).json({ message: "Product not found" });
  const b = req.body || {};
  const auction = await Auction.findOne({ id: Number(b.auction || product.auction_id) }).lean();
  if (!auction) return res.status(404).json({ message: "Auction not found" });
  const categoryId = await resolveCategoryId(b.category, auction);
  const isCombo = b.is_combo === "1" || b.is_combo === true || b.is_combo === "true" || String(b.condition || "").toLowerCase() === "combo";
  Object.assign(product, {
    category_id: categoryId,
    auction_id: Number(b.auction || product.auction_id),
    name: String(b.name || product.name).trim(),
    image: req.file ? req.file.filename : product.image,
    price: Number(b.price ?? product.price),
    min_bid_amount: Number(b.min_bid_amount ?? product.min_bid_amount),
    code: String(b.code || product.code).trim(),
    condition: isCombo ? "Combo" : (b.condition || product.condition || ""),
    location: b.location || auction.goods_location || product.location || "",
    excise_duty: b.excise_duty ?? product.excise_duty ?? "",
    sales_duty: b.sales_duty ?? product.sales_duty ?? "",
    quantity: Number(b.quantity ?? product.quantity ?? 0),
    started_at: b.started_at || auction.started_at || product.started_at,
    expired_at: b.expired_at || auction.expired_at || product.expired_at,
  });
  await product.save();
  res.json({ message: "Product updated successfully", product });
}));

router.post("/products/import", upload.single("import_file"), wrap(async (req, res) => {
  if (!req.file) return res.status(422).json({ message: "Import file required" });
  const workbook = XLSX.readFile(req.file.path);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet);
  const auction = await Auction.findOne({ id: Number(req.body.auction) }).lean();
  if (!auction) return res.status(404).json({ message: "Auction not found" });
  const categoryId = await resolveCategoryId(req.body.category, auction);
  const defaultGstMode = req.body.gst_mode || auction?.gst_mode || "exclusive";
  let count = 0;
  for (const data of rows) {
    const mode = String(data.mode || data.Type || "simple").toLowerCase().trim();
    const isCombo = mode === "combo";
    let name = String(data.name || "").trim();
    const comboItems = String(data.combo_items || data.items || "").trim();
    if (isCombo && comboItems) {
      const parts = comboItems.split("|").map((s) => s.trim()).filter(Boolean);
      name = name || `Combo: ${parts.join(" + ")}`;
    }
    if (!name) continue;
    const price = Number(data.price || 0);
    const minBid = Number(data.min_bid_amount || data.min_bid || 0);
    const code = String(data.code || `P-${Date.now().toString().slice(-6)}-${count}`).trim();
    const quantity = Number(data.quantity || 1);
    const gstMode = String(data.gst_mode || defaultGstMode).toLowerCase();
    await Product.create({
      admin_id: req.auth.id,
      category_id: categoryId,
      auction_id: Number(req.body.auction),
      name,
      price,
      price_ex_gst: price,
      price_inc_gst: price,
      gst_mode: gstMode,
      gst_percent: Number(data.gst_percent || 0),
      min_bid_amount: minBid,
      code,
      condition: isCombo ? "Combo" : String(data.condition || ""),
      location: auction.goods_location || "",
      quantity,
      status: 1,
      started_at: req.body.started_at || auction.started_at,
      expired_at: req.body.expired_at || auction.expired_at,
    });
    count += 1;
  }
  res.json({ message: `${count} product(s) imported successfully` });
}));

router.get("/products/import/sample/excel", wrap(async (_req, res) => {
  const rows = [
    {
      mode: "simple",
      name: "Steel Scrap Lot",
      code: "SS-001",
      price: 5000,
      min_bid_amount: 300,
      quantity: 5,
      combo_items: "",
    },
    {
      mode: "simple",
      name: "Copper Wire Bundle",
      code: "CW-002",
      price: 2200,
      min_bid_amount: 150,
      quantity: 10,
      combo_items: "",
    },
    {
      mode: "combo",
      name: "",
      code: "CMB-001",
      price: 15000,
      min_bid_amount: 750,
      quantity: 1,
      combo_items: "Monitor|Keyboard|Mouse",
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
  if (scope === "active") filter.status = 1;
  if (scope === "inactive" || scope === "banned") filter.status = 0;
  if (scope === "pending") filter.approve = 0;
  let users = await User.find(filter).sort({ id: -1 }).select("-password").lean();
  if (req.query.search) {
    const q = String(req.query.search).toLowerCase();
    users = users.filter(
      (u) =>
        String(u.username || "").toLowerCase().includes(q) ||
        String(u.email || "").toLowerCase().includes(q) ||
        String(u.mobile || "").includes(q) ||
        String(u.contact_no || "").includes(q) ||
        String(u.firm_name || "").toLowerCase().includes(q) ||
        String(u.contact_person || "").toLowerCase().includes(q) ||
        String(u.unique_id || "").toLowerCase().includes(q)
    );
  }
  res.json({ users, vendors: users });
}));

router.put("/users/:id", wrap(async (req, res) => {
  const user = await User.findOne({ id: Number(req.params.id) });
  if (!user) return res.status(404).json({ message: "Vendor not found" });
  const b = req.body;
  Object.assign(user, {
    kind: "vendor",
    firstname: b.firstname ?? user.firstname,
    lastname: b.lastname ?? user.lastname,
    name: b.name ?? user.name,
    email: b.email ?? user.email,
    mobile: b.mobile ?? user.mobile,
    country: b.country ?? user.country,
    address: b.address || "",
    city: b.city || "",
    state: b.state || "",
    zip: b.zip || "",
    firm_name: b.firm_name ?? user.firm_name,
    contact_person: b.contact_person ?? user.contact_person,
    contact_no: b.contact_no ?? user.contact_no,
    alternate_contact_no: b.alternate_contact_no ?? user.alternate_contact_no,
    contact_email: b.contact_email ?? user.contact_email,
    gst_no: b.gst_no ?? user.gst_no,
    pan_no: b.pan_no ?? user.pan_no,
    validation_status: b.validation_status ?? user.validation_status,
    approve: b.approve === undefined ? user.approve : (b.approve ? 1 : 0),
    status: b.status === undefined ? user.status : (b.status ? 1 : 0),
  });
  if (b.password && String(b.password).length >= 6) {
    user.password = bcrypt.hashSync(String(b.password), 10);
  }
  await user.save();
  res.json({ message: "Vendor detail has been updated" });
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

router.post("/contacts/:id/share-mail", wrap(async (req, res) => {
  const contact = await Contact.findOne({ id: Number(req.params.id) });
  if (!contact) return res.status(404).json({ message: "Enquiry not found" });
  const settings = await getSiteSettings();
  const body = (settings.vendorEnrolmentMail || "")
    .replace(/\{firm\}/gi, contact.firm_name || "")
    .replace(/\{name\}/gi, contact.contact_person || contact.name || "");
  contact.mail_sent = true;
  contact.mail_note = `Shared common enrolment mail to ${contact.email} (cc admin ${settings.adminNotifyEmail || ""}):\n\n${body}`;
  await contact.save();
  res.json({
    message: "Common enrolment mail prepared / marked shared",
    to: contact.email,
    admin: settings.adminNotifyEmail,
    body,
  });
}));

router.get("/vendors", wrap(async (req, res) => {
  const scope = String(req.query.scope || "all");
  const filter = {};
  if (scope === "active") filter.status = 1;
  if (scope === "inactive" || scope === "banned") filter.status = 0;
  if (scope === "pending") filter.approve = 0;
  const vendors = await User.find(filter).sort({ id: -1 }).select("-password").lean();
  res.json({ vendors, users: vendors });
}));

router.get("/vendors/:id", wrap(async (req, res) => {
  const vendor = await User.findOne({ id: Number(req.params.id) }).select("-password").lean();
  if (!vendor) return res.status(404).json({ message: "Vendor not found" });
  const auctions = await Auction.find().sort({ id: -1 }).lean();
  res.json({ vendor, user: vendor, auctions });
}));

router.post("/vendors/:id?", uploadDocs, wrap(async (req, res) => {
  const b = req.body || {};
  const docs = mapFiles(req.files?.documents || req.files?.files, "document");
  const imgs = mapFiles(req.files?.images, "image").concat(
    mapFiles((req.files?.files || []).filter((f) => String(f.mimetype || "").startsWith("image/")), "image")
  );

  const firm_name = String(b.firm_name || "").trim();
  const contact_person = String(b.contact_person || b.name || "").trim();
  const contact_no = String(b.contact_no || b.mobile || "").trim();
  const email = String(b.email || b.contact_email || "").trim().toLowerCase();
  const username = String(b.username || "").trim();

  if (!firm_name || !contact_person || !contact_no) {
    return res.status(422).json({ message: "Firm name, contact person and contact no are required" });
  }

  const payload = {
    kind: "vendor",
    name: b.name || contact_person,
    firstname: b.firstname || contact_person.split(/\s+/)[0] || contact_person,
    lastname: b.lastname || contact_person.split(/\s+/).slice(1).join(" ") || "Vendor",
    firm_name,
    address: b.address || "",
    contact_person,
    contact_no,
    mobile: contact_no,
    alternate_contact_no: b.alternate_contact_no || "",
    contact_email: email,
    email: email || undefined,
    gst_no: b.gst_no || "",
    pan_no: b.pan_no || "",
    validation_status: b.validation_status || "Pending",
    notes: b.notes || "",
    country: b.country || "India",
    country_code: b.country_code || "IN",
    mobile_code: b.mobile_code || "+91",
    approve: b.approve === "0" || b.approve === 0 || b.approve === false ? 0 : 1,
    status: b.status === "0" || b.status === 0 || b.status === false || b.status === "Inactive" ? 0 : 1,
  };

  if (req.params.id) {
    const v = await User.findOne({ id: Number(req.params.id) });
    if (!v) return res.status(404).json({ message: "Vendor not found" });
    if (username) payload.username = username;
    if (email && email !== v.email) {
      if (await User.findOne({ email, id: { $ne: v.id } })) {
        return res.status(422).json({ message: "Email already taken" });
      }
    }
    if (username && username !== v.username) {
      if (await User.findOne({ username, id: { $ne: v.id } })) {
        return res.status(422).json({ message: "Username already taken" });
      }
    }
    Object.assign(v, payload);
    if (b.password && String(b.password).length >= 6) {
      v.password = bcrypt.hashSync(String(b.password), 10);
    }
    if (docs.length) v.documents = [...(v.documents || []), ...docs];
    if (imgs.length) v.images = [...(v.images || []), ...imgs];
    if (!v.unique_id) v.unique_id = await nextEntityUniqueId(User, "VN");
    await v.save();
    const safe = v.toJSON();
    delete safe.password;
    return res.json({ message: "Vendor updated", vendor: safe });
  }

  if (!username || username.length < 6) {
    return res.status(422).json({ message: "Username must be at least 6 characters" });
  }
  if (!email) return res.status(422).json({ message: "Email is required" });
  if (!b.password || String(b.password).length < 6) {
    return res.status(422).json({ message: "Password must be at least 6 characters" });
  }
  if (await User.findOne({ username })) return res.status(422).json({ message: "Username already taken" });
  if (await User.findOne({ email })) return res.status(422).json({ message: "Email already taken" });

  payload.username = username;
  payload.email = email;
  payload.password = bcrypt.hashSync(String(b.password), 10);
  payload.unique_id = await nextEntityUniqueId(User, "VN");
  payload.documents = docs;
  payload.images = imgs;
  payload.approve = 1;
  payload.status = b.status === "0" || b.status === 0 || b.status === "Inactive" ? 0 : 1;

  const created = await User.create(payload);
  const safe = created.toJSON();
  delete safe.password;
  res.json({ message: "Vendor added", vendor: safe });
}));

router.get("/companies", wrap(async (_req, res) => {
  res.json({ companies: await Company.find().sort({ id: -1 }).lean() });
}));

router.get("/companies/:id", wrap(async (req, res) => {
  const company = await Company.findOne({ id: Number(req.params.id) }).lean();
  if (!company) return res.status(404).json({ message: "Company not found" });
  res.json({ company });
}));

router.post("/companies/:id?", uploadDocs, wrap(async (req, res) => {
  const b = req.body || {};
  const docs = mapFiles(req.files?.documents || req.files?.files, "document");
  const imgs = mapFiles(req.files?.images, "image");
  const payload = {
    firm_name: b.firm_name || "",
    address: b.address || "",
    gst_no: b.gst_no || "",
    pan_no: b.pan_no || "",
    contact_l1_name: b.contact_l1_name || "",
    contact_l1_no: b.contact_l1_no || "",
    contact_l1_email: b.contact_l1_email || "",
    contact_l2_name: b.contact_l2_name || "",
    contact_l2_no: b.contact_l2_no || "",
    contact_l2_email: b.contact_l2_email || "",
    contact_l3_name: b.contact_l3_name || "",
    contact_l3_no: b.contact_l3_no || "",
    contact_l3_email: b.contact_l3_email || "",
    finance_contact_person: b.finance_contact_person || "",
    finance_email: b.finance_email || "",
    validation_status: b.validation_status || "Pending",
    notes: b.notes || "",
  };
  if (!payload.firm_name || !payload.gst_no) {
    return res.status(422).json({ message: "Firm name and GST no are required" });
  }
  if (req.params.id) {
    const c = await Company.findOne({ id: Number(req.params.id) });
    if (!c) return res.status(404).json({ message: "Company not found" });
    Object.assign(c, payload);
    if (docs.length) c.documents = [...(c.documents || []), ...docs];
    if (imgs.length) c.images = [...(c.images || []), ...imgs];
    await c.save();
    return res.json({ message: "Company updated", company: c });
  }
  payload.unique_id = await nextEntityUniqueId(Company, "CO");
  payload.documents = docs;
  payload.images = imgs;
  const created = await Company.create(payload);
  res.json({ message: "Company added", company: created });
}));

router.get("/slides", wrap(async (_req, res) => {
  res.json({ slides: await HeroSlide.find().sort({ sort_order: 1, id: 1 }).lean() });
}));

router.post("/slides/:id?", upload.single("image"), wrap(async (req, res) => {
  const b = req.body || {};
  const payload = {
    kicker: b.kicker || "",
    title: b.title || "",
    text: b.text || "",
    button_label: b.button_label || "Explore",
    button_link: b.button_link || "/auction",
    sort_order: Number(b.sort_order || 0),
    status: b.status === "0" || b.status === 0 ? 0 : 1,
  };
  if (!payload.title) return res.status(422).json({ message: "Slide title is required" });
  if (req.params.id) {
    const s = await HeroSlide.findOne({ id: Number(req.params.id) });
    if (!s) return res.status(404).json({ message: "Slide not found" });
    Object.assign(s, payload);
    if (req.file) s.image = req.file.filename;
    await s.save();
    return res.json({ message: "Slide updated", slide: s });
  }
  if (!req.file && !b.image) return res.status(422).json({ message: "Slide image is required" });
  payload.image = req.file ? req.file.filename : b.image;
  const created = await HeroSlide.create(payload);
  res.json({ message: "Slide added", slide: created });
}));

router.delete("/slides/:id", wrap(async (req, res) => {
  await HeroSlide.deleteOne({ id: Number(req.params.id) });
  res.json({ message: "Slide deleted" });
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

router.get("/reports/auctions", wrap(async (req, res) => {
  const { status, category, firm, month, format, search } = req.query;
  let filterFn = null;
  if (status === "open" || status === "upcoming") filterFn = (a) => isUpcoming(a);
  else if (status === "live") filterFn = (a) => isLive(a);
  else if (status === "completed" || status === "expired") filterFn = (a) => isExpired(a);
  else if (status === "pending") filterFn = (a) => Number(a.status) === 0 && !isExpired(a);
  // status=all or empty → all auctions including completed

  let rows = await auctionReportRows(filterFn);
  if (category) rows = rows.filter((r) => String(r.Category).toLowerCase() === String(category).toLowerCase());
  if (firm) {
    const q = String(firm).toLowerCase();
    rows = rows.filter((r) => String(r.Firm).toLowerCase().includes(q) || String(r.Firm_Kind).toLowerCase() === q);
  }
  if (month) {
    rows = rows.filter((r) => String(r.Open || "").startsWith(month) || String(r.Close || "").startsWith(month));
  }
  if (search) {
    const q = String(search).toLowerCase();
    rows = rows.filter((r) =>
      String(r.Name || "").toLowerCase().includes(q)
      || String(r.Unique_ID || "").toLowerCase().includes(q)
      || String(r.Firm || "").toLowerCase().includes(q)
    );
  }

  if (format === "excel") {
    const name = `AuctionReport_${status || "all"}${month ? `_${month}` : ""}.xlsx`;
    return sendExcel(res, rows, name);
  }
  res.json({ rows, total: rows.length });
}));

router.get("/reports/revenue", wrap(async (req, res) => {
  const month = req.query.month; // YYYY-MM
  const rows = await auctionReportRows((a) => {
    if (!month) return isExpired(a) || isLive(a);
    return String(a.started_at || "").startsWith(month) || String(a.expired_at || "").startsWith(month);
  });
  const revenueRows = rows.map((r) => ({
    Unique_ID: r.Unique_ID,
    Name: r.Name,
    Category: r.Category,
    Firm: r.Firm,
    Month: month || "all",
    Products: r.Products,
    Winners: r.Winners,
    Revenue: r.Revenue,
  }));
  if (req.query.format === "excel") {
    return sendExcel(res, revenueRows, month ? `MonthlyRevenue_${month}.xlsx` : "MonthlyRevenue.xlsx", "Revenue");
  }
  res.json({ rows: revenueRows });
}));

export default router;
