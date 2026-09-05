import { Bid, Product, User, Transaction } from "./models.js";
import { maxBid, parseAuctionDate, randomCode, trxId } from "./helpers.js";

/** Persist wall-clock time in Asia/Kolkata (same convention as admin forms). */
function stamp(date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date instanceof Date ? date : new Date(date));
  const get = (type) => parts.find((p) => p.type === type)?.value || "00";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}:${get("second")}`;
}

export async function placeBid({ product, user, amount, agentAmount, minIncrement, io }) {
  if (!amount && !agentAmount) {
    return { error: "Please Enter Bid Amount or set Agent Amount" };
  }

  const currentMax = await maxBid(product.id);
  const minRequired =
    currentMax > 0 ? currentMax + Number(product.min_bid_amount) : Number(product.price) + Number(product.min_bid_amount);

  if (amount && Number(amount) < minRequired) {
    return { error: `Bid amount must be greater than or equal to ${minRequired}` };
  }
  if (agentAmount && Number(agentAmount) < minRequired) {
    return { error: `Agent amount must be greater than ${minRequired}` };
  }

  let bid = await Bid.findOne({ product_id: product.id, user_id: user.id });
  let aamount = 0;
  let bidAmount = amount ? Number(amount) : bid?.amount || 0;

  if (agentAmount) {
    const top = await Bid.findOne({ product_id: product.id }).sort({ amount: -1 });
    if (!top || Number(top.user_id) !== Number(user.id)) {
      aamount = 1;
      bidAmount = minRequired;
    }
  }

  if (bid) {
    bid.amount = bidAmount;
    if (agentAmount) bid.agent_amount = Number(agentAmount);
    await bid.save();
  } else {
    bid = await Bid.create({
      product_id: product.id,
      user_id: user.id,
      amount: bidAmount,
      agent_amount: agentAmount ? Number(agentAmount) : 0,
    });
  }

  let expiredAt = product.expired_at;
  const secondsLeft = (parseAuctionDate(product.expired_at) - Date.now()) / 1000;
  if (secondsLeft > 0 && secondsLeft < 40) {
    expiredAt = stamp(new Date(parseAuctionDate(product.expired_at) + 4 * 60 * 1000));
    await Product.updateOne({ id: product.id }, { expired_at: expiredAt });
    io?.emit("auction-time", { product_id: product.id, expired_at: expiredAt });
  }

  await Product.updateOne({ id: product.id }, { $inc: { total_bid: 1 } });
  const userCode = user.user_code || `U${randomCode(5)}`;
  await User.updateOne({ id: user.id }, { user_code: userCode });

  await Transaction.create({
    user_id: user.id,
    product_id: product.id,
    amount: aamount === 1 ? minRequired : amount ? Number(amount) : 0,
    agent_amount: agentAmount ? Number(agentAmount) : 0,
    trx_type: "-",
    details: "Subtracted for a new bid",
    trx: trxId(),
  });

  if (amount) {
    const increment = Number(minIncrement || product.min_bid_amount);
    const agents = await Bid.find({
      product_id: product.id,
      agent_amount: { $gt: Number(amount) },
      user_id: { $ne: user.id },
    });

    for (const abid of agents) {
      const maxNow = await maxBid(product.id);
      const bidAmnt = maxNow + increment;
      if (bidAmnt <= Number(abid.agent_amount)) {
        abid.amount = bidAmnt;
        await abid.save();
        await Product.updateOne({ id: product.id }, { $inc: { total_bid: 1 } });
        const agentUser = await User.findOne({ id: abid.user_id });
        const code = agentUser.user_code || `U${randomCode(5)}`;
        await User.updateOne({ id: abid.user_id }, { user_code: code });
        await Transaction.create({
          user_id: abid.user_id,
          product_id: product.id,
          amount: bidAmnt,
          agent_amount: 0,
          trx_type: "-",
          details: "Subtracted for a new bid",
          trx: trxId(),
        });

        const extraLeft = (parseAuctionDate(expiredAt) - Date.now()) / 1000;
        if (extraLeft > 0 && extraLeft < 40) {
          expiredAt = stamp(new Date(parseAuctionDate(expiredAt) + 4 * 60 * 1000));
          await Product.updateOne({ id: product.id }, { expired_at: expiredAt });
          io?.emit("auction-time", { product_id: product.id, expired_at: expiredAt });
        }
      }
    }
  }

  const payload = {
    product_id: product.id,
    max_bid: await maxBid(product.id),
    count_bid: await Bid.countDocuments({ product_id: product.id }),
    expired_at: expiredAt,
  };
  io?.emit("new-trade", payload);
  io?.emit("demo-bid", payload);

  return { ok: true, bid: bid.toJSON(), payload };
}
