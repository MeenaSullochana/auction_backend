import { Router } from "express";
import { Auction, Bid, Product, Watchlist, Winner } from "../models.js";
import { assignedTo, enrichProduct, isLive, maxBid, topBidders, wrap } from "../helpers.js";
import { placeBid } from "../bidService.js";

const router = Router();

router.get("/dashboard", wrap(async (req, res) => {
  const all = await Auction.find({ status: 1 }).sort({ id: -1 }).lean();
  const auctions = all.filter((a) => assignedTo(a, req.auth.id) && isLive(a));
  res.json({ auctions });
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
  const auction = await Auction.findOne({ id: Number(req.params.id) }).lean();
  if (!auction) return res.status(404).json({ message: "Auction not found" });
  if (!assignedTo(auction, req.auth.id)) {
    return res.status(403).json({ message: "You are not assigned to this auction" });
  }
  const products = await Product.find({ auction_id: auction.id, status: 1 }).lean();
  const live = [];
  for (const p of products.filter(isLive)) live.push(await enrichProduct(p, req.user));
  res.json({ auction, products: live, pageTitle: auction.name });
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
  const userBid = await Bid.findOne({ product_id: product.id, user_id: req.auth.id }).lean();
  res.json({
    product: await enrichProduct(product, req.user),
    max_pro: await maxBid(product.id),
    getUserBid: userBid,
    max_bid: await topBidders(product.id, req.user),
  });
}));

router.get("/auctions/:auctionId/multiple", wrap(async (req, res) => {
  const auction = await Auction.findOne({ id: Number(req.params.auctionId) }).lean();
  if (!auction || !assignedTo(auction, req.auth.id)) {
    return res.status(403).json({ message: "No auction Found" });
  }
  const products = await Product.find({ auction_id: auction.id, status: 1 }).lean();
  const live = [];
  for (const p of products.filter(isLive)) live.push(await enrichProduct(p, req.user));
  res.json({ products: live });
}));

router.post("/watchlist", wrap(async (req, res) => {
  const ids = req.body.productids || [];
  await Watchlist.deleteMany({ user_id: req.auth.id });
  if (ids.length) {
    await Watchlist.insertMany(ids.map((id) => ({ user_id: req.auth.id, product_id: Number(id) })));
  }
  res.json({ message: "success" });
}));

router.get("/auctions/:auctionId/watch", wrap(async (req, res) => {
  const values = (await Watchlist.find({ user_id: req.auth.id }).lean()).map((r) => r.product_id);
  if (!values.length) return res.status(422).json({ message: "No auction Found" });
  const auction = await Auction.findOne({ id: Number(req.params.auctionId) }).lean();
  if (!auction || !assignedTo(auction, req.auth.id)) {
    return res.status(403).json({ message: "No auction Found" });
  }
  const products = await Product.find({ id: { $in: values }, auction_id: auction.id, status: 1 }).lean();
  const live = [];
  for (const p of products.filter(isLive)) live.push(await enrichProduct(p, req.user));
  res.json({ products: live });
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
