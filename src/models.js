import mongoose from "mongoose";

const counterSchema = new mongoose.Schema({ _id: String, seq: { type: Number, default: 0 } });
export const Counter = mongoose.models.Counter || mongoose.model("Counter", counterSchema);

export async function nextId(name) {
  const doc = await Counter.findByIdAndUpdate(name, { $inc: { seq: 1 } }, { new: true, upsert: true });
  return doc.seq;
}

function withId(schema, name) {
  schema.add({ id: { type: Number, unique: true, index: true } });
  schema.pre("save", async function () {
    if (!this.id) this.id = await nextId(name);
  });
  schema.set("toJSON", {
    transform(_doc, ret) {
      delete ret._id;
      delete ret.__v;
      return ret;
    },
  });
}

const adminSchema = new mongoose.Schema(
  { name: String, username: { type: String, unique: true }, email: String, password: String },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } }
);
withId(adminSchema, "admins");

const userSchema = new mongoose.Schema(
  {
    firstname: String,
    lastname: String,
    username: { type: String, unique: true },
    email: { type: String, unique: true },
    mobile: String,
    password: String,
    country: String,
    country_code: String,
    mobile_code: String,
    address: String,
    city: String,
    state: String,
    zip: String,
    status: { type: Number, default: 1 },
    approve: { type: Number, default: 0 },
    user_code: String,
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } }
);
withId(userSchema, "users");

const categorySchema = new mongoose.Schema(
  { name: String, icon: { type: String, default: "las la-tags" }, status: { type: Number, default: 1 } },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } }
);
withId(categorySchema, "categories");

const auctionSchema = new mongoose.Schema(
  {
    name: String,
    icon: { type: String, default: "las la-gavel" },
    status: { type: Number, default: 1 },
    started_at: String,
    expired_at: String,
    assign_user: { type: String, default: "[]" },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } }
);
withId(auctionSchema, "auctions");

const productSchema = new mongoose.Schema(
  {
    admin_id: Number,
    category_id: Number,
    auction_id: Number,
    name: String,
    image: String,
    price: { type: Number, default: 0 },
    min_bid_amount: { type: Number, default: 0 },
    code: String,
    condition: String,
    location: String,
    excise_duty: String,
    sales_duty: String,
    quantity: { type: Number, default: 0 },
    total_bid: { type: Number, default: 0 },
    status: { type: Number, default: 1 },
    started_at: String,
    expired_at: String,
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } }
);
withId(productSchema, "products");

const bidSchema = new mongoose.Schema(
  {
    product_id: Number,
    user_id: Number,
    amount: { type: Number, default: 0 },
    agent_amount: { type: Number, default: 0 },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } }
);
bidSchema.index({ product_id: 1, user_id: 1 }, { unique: true });
withId(bidSchema, "bids");

const winnerSchema = new mongoose.Schema(
  { product_id: { type: Number, unique: true }, user_id: Number, bid_id: Number },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } }
);
withId(winnerSchema, "winners");

const transactionSchema = new mongoose.Schema({
  user_id: Number,
  product_id: Number,
  amount: { type: Number, default: 0 },
  agent_amount: { type: Number, default: 0 },
  trx_type: String,
  details: String,
  trx: String,
  created_at: { type: Date, default: Date.now },
});
withId(transactionSchema, "transactions");

const contactSchema = new mongoose.Schema({
  name: String,
  email: String,
  subject: String,
  message: String,
  created_at: { type: Date, default: Date.now },
});
withId(contactSchema, "contacts");

const passwordResetSchema = new mongoose.Schema({ email: String, token: String, created_at: { type: Date, default: Date.now } });

const watchlistSchema = new mongoose.Schema({ user_id: Number, product_id: Number });
watchlistSchema.index({ user_id: 1, product_id: 1 }, { unique: true });

const siteSettingSchema = new mongoose.Schema(
  {
    key: { type: String, unique: true, default: "site" },
    wordThe: { type: String, default: "THE" },
    wordAuction: { type: String, default: "AUCTION" },
    wordHouse: { type: String, default: "HOUSE" },
    colorThe: { type: String, default: "#93C47D" },
    colorAuction: { type: String, default: "#FFFFFF" },
    colorHouse: { type: String, default: "#93C47D" },
    colorBg: { type: String, default: "#050605" },
    colorPanel: { type: String, default: "#121A13" },
    colorAccent: { type: String, default: "#93C47D" },
    colorAccent2: { type: String, default: "#C5E3B4" },
    colorText: { type: String, default: "#F4F7F2" },
    colorMuted: { type: String, default: "#A8B8A4" },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } }
);

export const DEFAULT_SITE = {
  key: "site",
  wordThe: "THE",
  wordAuction: "AUCTION",
  wordHouse: "HOUSE",
  colorThe: "#93C47D",
  colorAuction: "#FFFFFF",
  colorHouse: "#93C47D",
  colorBg: "#050605",
  colorPanel: "#121A13",
  colorAccent: "#93C47D",
  colorAccent2: "#C5E3B4",
  colorText: "#F4F7F2",
  colorMuted: "#A8B8A4",
};

export async function getSiteSettings() {
  let doc = await SiteSetting.findOne({ key: "site" });
  if (!doc) doc = await SiteSetting.create(DEFAULT_SITE);
  return typeof doc.toJSON === "function" ? doc.toJSON() : doc;
}

export const Admin = mongoose.models.Admin || mongoose.model("Admin", adminSchema);
export const User = mongoose.models.User || mongoose.model("User", userSchema);
export const Category = mongoose.models.Category || mongoose.model("Category", categorySchema);
export const Auction = mongoose.models.Auction || mongoose.model("Auction", auctionSchema);
export const Product = mongoose.models.Product || mongoose.model("Product", productSchema);
export const Bid = mongoose.models.Bid || mongoose.model("Bid", bidSchema);
export const Winner = mongoose.models.Winner || mongoose.model("Winner", winnerSchema);
export const Transaction = mongoose.models.Transaction || mongoose.model("Transaction", transactionSchema);
export const Contact = mongoose.models.Contact || mongoose.model("Contact", contactSchema);
export const PasswordReset = mongoose.models.PasswordReset || mongoose.model("PasswordReset", passwordResetSchema);
export const Watchlist = mongoose.models.Watchlist || mongoose.model("Watchlist", watchlistSchema);
export const SiteSetting = mongoose.models.SiteSetting || mongoose.model("SiteSetting", siteSettingSchema);

export function json(doc) {
  if (!doc) return null;
  return typeof doc.toJSON === "function" ? doc.toJSON() : doc;
}

export function jsonAll(docs) {
  return docs.map(json);
}
