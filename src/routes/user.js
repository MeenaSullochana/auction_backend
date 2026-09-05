import { Router } from "express";
import { Auction, Bid, Product, Watchlist, Winner } from "../models.js";
import { assignedTo, enrichProduct, isLive, isUpcoming, maxBid, topBidders, wrap } from "../helpers.js";
import { placeBid } from "../bidService.js";

const router = Router();

async function assertAssignedAuction(auctionId, userId) {
  const auction = await Auction.findOne({ id: Number(auctionId) }).lean();
  if (!auction) return { error: { status: 404, message: "Auction not found" } };
  if (!assignedTo(auction, userId)) {
    return { error: { status: 403, message: "You are not assigned to this auction" } };
  }
  return { auction };
}

async function favouriteProductIds(userId, auctionId) {
  const rows = await Watchlist.find({ user_id: userId }).lean();
  const ids = rows.map((r) => Number(r.product_id));
  if (!ids.length) return [];
  const inAuction = await Product.find({ auction_id: Number(auctionId), id: { $in: ids } }).select("id").lean();
  return inAuction.map((p) => Number(p.id));
}

async function enrichRoomProduct(product, viewer) {
  const enriched = await enrichProduct(product, viewer);
  const tops = await topBidders(product.id, viewer);
  const myBid = await Bid.findOne({ product_id: product.id, user_id: viewer.id }).lean();
  const winner = await Winner.findOne({ product_id: product.id }).lean();
  let rank_label = "—";
  if (winner) {
    rank_label = Number(winner.user_id) === Number(viewer.id) ? "Sold (You)" : "Sold";
  } else {
    const mine = tops.find((b) => Number(b.user_id) === Number(viewer.id));
    if (mine?.position) rank_label = String(mine.position).toUpperCase();
    else if (myBid) rank_label = "Out";
  }
  return {
    ...enriched,
    my_bid: myBid?.amount || 0,
    rank_label,
    top_bidders: tops,
    is_sold: !!winner,
  };
}

router.get("/dashboard", wrap(async (req, res) => {
  const all = await Auction.find({ status: 1 }).sort({ id: -1 }).lean();
  const mine = all.filter((a) => assignedTo(a, req.auth.id));
  const auctions = mine
    .filter((a) => isLive(a) || isUpcoming(a))
    .map((a) => ({
      ...a,
      phase: isLive(a) ? "live" : "upcoming",
      phase_label: isLive(a) ? "Live" : "Upcoming",
    }));
  res.json({
    auctions,
    live: auctions.filter((a) => a.phase === "live"),
    upcoming: auctions.filter((a) => a.phase === "upcoming"),
  });
}));

router.get("/winning-history", wrap(async (req, res) => {
  const wins = await Winner.find({ user_id: req.auth.id }).sort({ id: -1 }).lean();
  const winningHistories = [];
  for (const w of wins) {
    const p = await Product.findOne({ id: w.product_id }).lean();
    const b = await Bid.findOne({ id: w.bid_id }).lean();
    winningHistories.push({
      ...w,
      product_name: p?.name,
      product_code: p?.code,
      bid_amount: b?.amount,
    });
  }
  res.json({ winningHistories, emptyMessage: "No winning history found" });
}));

router.get("/auctions/:id/products", wrap(async (req, res) => {
  const gate = await assertAssignedAuction(req.params.id, req.auth.id);
  if (gate.error) return res.status(gate.error.status).json({ message: gate.error.message });
  const { auction } = gate;
  const products = await Product.find({ auction_id: auction.id, status: 1 }).sort({ id: 1 }).lean();
  const favIds = await favouriteProductIds(req.auth.id, auction.id);
  const visible = [];
  const catalog = (isLive(auction) || isUpcoming(auction))
    ? products
    : products.filter((row) => isLive(row) || isUpcoming(row));
  for (const p of catalog) {
    const row = await enrichProduct(p, req.user);
    visible.push({ ...row, is_favourite: favIds.includes(Number(p.id)) });
  }
  res.json({
    auction: {
      ...auction,
      phase: isLive(auction) ? "live" : isUpcoming(auction) ? "upcoming" : "closed",
    },
    products: visible,
    favourite_ids: favIds,
    pageTitle: auction.name,
  });
}));

/** Bidder room: auction header + item rows (favourites filter when live). */
router.get("/auctions/:id/room", wrap(async (req, res) => {
  const gate = await assertAssignedAuction(req.params.id, req.auth.id);
  if (gate.error) return res.status(gate.error.status).json({ message: gate.error.message });
  const { auction } = gate;
  const favIds = await favouriteProductIds(req.auth.id, auction.id);
  const all = await Product.find({ auction_id: auction.id, status: 1 }).sort({ id: 1 }).lean();
  const catalog = (isLive(auction) || isUpcoming(auction))
    ? all
    : all.filter((row) => isLive(row) || isUpcoming(row));
  const livePhase = isLive(auction);
  const q = req.query.favourites_only;
  const wantFavOnly = String(q) === "1" || (livePhase && favIds.length > 0 && String(q) !== "0");

  let selected = catalog;
  if (wantFavOnly && favIds.length) {
    selected = catalog.filter((p) => favIds.includes(Number(p.id)));
  }

  const products = [];
  for (const p of selected) {
    const row = await enrichRoomProduct(p, req.user);
    products.push({ ...row, is_favourite: favIds.includes(Number(p.id)) });
  }

  const others = catalog
    .filter((p) => !favIds.includes(Number(p.id)))
    .map((p) => ({ id: p.id, code: p.code, name: p.name }));

  res.json({
    auction: {
      ...auction,
      phase: livePhase ? "live" : isUpcoming(auction) ? "upcoming" : "closed",
    },
    products,
    favourite_ids: favIds,
    favourites_only: !!(wantFavOnly && favIds.length),
    other_items: others,
    pageTitle: auction.name,
  });
}));

router.get("/products/:auctionId/:id", wrap(async (req, res) => {
  const product = await Product.findOne({
    id: Number(req.params.id),
    auction_id: Number(req.params.auctionId),
    status: { $ne: 0 },
  }).lean();
  if (!product) return res.status(404).json({ message: "Product not found" });
  const auction = await Auction.findOne({ id: product.auction_id }).lean();
  if (!assignedTo(auction, req.auth.id)) {
    return res.status(403).json({ message: "You are not assigned to this auction" });
  }
  const siblings = await Product.find({ auction_id: auction.id, status: 1 }).sort({ id: 1 }).select("id code name").lean();
  const idx = siblings.findIndex((s) => Number(s.id) === Number(product.id));
  const userBid = await Bid.findOne({ product_id: product.id, user_id: req.auth.id }).lean();
  const favIds = await favouriteProductIds(req.auth.id, auction.id);
  const room = await enrichRoomProduct(product, req.user);
  res.json({
    product: { ...room, is_favourite: favIds.includes(Number(product.id)) },
    auction,
    max_pro: await maxBid(product.id),
    getUserBid: userBid,
    max_bid: room.top_bidders,
    siblings,
    prev_id: idx > 0 ? siblings[idx - 1].id : null,
    next_id: idx >= 0 && idx < siblings.length - 1 ? siblings[idx + 1].id : null,
  });
}));

router.get("/auctions/:auctionId/multiple", wrap(async (req, res) => {
  const gate = await assertAssignedAuction(req.params.auctionId, req.auth.id);
  if (gate.error) return res.status(gate.error.status).json({ message: gate.error.message });
  const { auction } = gate;
  const products = await Product.find({ auction_id: auction.id, status: 1 }).sort({ id: 1 }).lean();
  const favIds = await favouriteProductIds(req.auth.id, auction.id);
  const live = [];
  for (const p of products.filter((row) => isLive(row) || isUpcoming(row))) {
    live.push({ ...(await enrichProduct(p, req.user)), is_favourite: favIds.includes(Number(p.id)) });
  }
  res.json({ products: live, favourite_ids: favIds, auction });
}));

/** Replace favourites for one auction (keeps favourites from other auctions). */
router.post("/watchlist", wrap(async (req, res) => {
  const auctionId = Number(req.body.auction_id || req.body.auctionId || 0);
  const ids = (req.body.productids || req.body.product_ids || []).map(Number).filter(Boolean);
  if (auctionId) {
    const inAuction = await Product.find({ auction_id: auctionId }).select("id").lean();
    const auctionProductIds = inAuction.map((p) => Number(p.id));
    await Watchlist.deleteMany({ user_id: req.auth.id, product_id: { $in: auctionProductIds } });
    if (ids.length) {
      await Watchlist.insertMany(ids.map((id) => ({ user_id: req.auth.id, product_id: id })));
    }
  } else {
    await Watchlist.deleteMany({ user_id: req.auth.id });
    if (ids.length) {
      await Watchlist.insertMany(ids.map((id) => ({ user_id: req.auth.id, product_id: id })));
    }
  }
  res.json({ message: "Favourites saved", favourite_ids: ids });
}));

router.post("/favourites/toggle", wrap(async (req, res) => {
  const productId = Number(req.body.product_id);
  const product = await Product.findOne({ id: productId }).lean();
  if (!product) return res.status(404).json({ message: "Product not found" });
  const auction = await Auction.findOne({ id: product.auction_id }).lean();
  if (!assignedTo(auction, req.auth.id)) {
    return res.status(403).json({ message: "You are not assigned to this auction" });
  }
  const existing = await Watchlist.findOne({ user_id: req.auth.id, product_id: productId });
  if (existing) {
    await Watchlist.deleteOne({ _id: existing._id });
    return res.json({ favourited: false, product_id: productId });
  }
  await Watchlist.create({ user_id: req.auth.id, product_id: productId });
  res.json({ favourited: true, product_id: productId });
}));

router.get("/auctions/:auctionId/watch", wrap(async (req, res) => {
  const gate = await assertAssignedAuction(req.params.auctionId, req.auth.id);
  if (gate.error) return res.status(gate.error.status).json({ message: gate.error.message });
  const { auction } = gate;
  const favIds = await favouriteProductIds(req.auth.id, auction.id);
  if (!favIds.length) return res.json({ products: [], message: "No favourites yet" });
  const products = await Product.find({ id: { $in: favIds }, auction_id: auction.id, status: 1 }).sort({ id: 1 }).lean();
  const out = [];
  for (const p of products) {
    out.push({ ...(await enrichRoomProduct(p, req.user)), is_favourite: true });
  }
  res.json({ products: out, auction });
}));

router.post("/bid", wrap(async (req, res) => {
  const product = await Product.findOne({ id: Number(req.body.product_id) }).lean();
  if (!product || !isLive(product)) {
    return res.status(422).json({ message: "Live product not found" });
  }
  const auction = await Auction.findOne({ id: product.auction_id }).lean();
  if (!assignedTo(auction, req.auth.id)) {
    return res.status(403).json({ message: "You are not assigned to this auction" });
  }
  const result = await placeBid({
    product,
    user: req.user,
    amount: req.body.amount,
    agentAmount: req.body.agent_amount,
    minIncrement: req.body.min_bid_increment,
    io: req.app.get("io"),
  });
  if (result.error) return res.status(422).json({ message: result.error });
  res.json({ message: "Bid placed successfully", ...result });
}));

router.post("/product/winner", wrap(async (req, res) => {
  const product_id = Number(req.body.product_id);
  let win = await Winner.findOne({ product_id }).lean();
  if (win) return res.json(win);
  const maxbid = await Bid.findOne({ product_id }).sort({ amount: -1 }).lean();
  if (!maxbid) return res.json("");
  await Winner.create({ product_id, user_id: maxbid.user_id, bid_id: maxbid.id });
  res.json(maxbid);
}));

export default router;
