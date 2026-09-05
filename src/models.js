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

const fileRefSchema = {
  filename: String,
  originalname: String,
  mimetype: String,
  kind: { type: String, default: "file" },
};

const userSchema = new mongoose.Schema(
  {
    kind: { type: String, default: "vendor" }, // all login users are vendors (bidders)
    unique_id: { type: String, unique: true, sparse: true },
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
    status: { type: Number, default: 1 }, // 1 active, 0 inactive
    approve: { type: Number, default: 0 },
    user_code: String,
    // Vendor / bidder enrolment fields
    name: String,
    firm_name: String,
    contact_person: String,
    contact_no: String,
    alternate_contact_no: String,
    contact_email: String,
    gst_no: String,
    pan_no: String,
    validation_status: { type: String, default: "Pending" },
    documents: { type: [fileRefSchema], default: [] },
    images: { type: [fileRefSchema], default: [] },
    notes: String,
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
    unique_id: { type: String, unique: true, sparse: true },
    icon: { type: String, default: "las la-gavel" },
    status: { type: Number, default: 1 },
    started_at: String,
    expired_at: String,
    assign_user: { type: String, default: "[]" },
    auction_type: { type: String, default: "Open Auction" },
    auction_category: { type: String, default: "E-waste" },
    firm: { type: String, default: "" },
    firm_kind: { type: String, default: "Company" },
    division: { type: String, default: "Mobile" },
    item_type: { type: String, default: "Product" },
    inv_type: { type: String, default: "Good" },
    goods_location: { type: String, default: "" },
    gst_mode: { type: String, default: "exclusive" },
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
    gst_mode: { type: String, default: "exclusive" },
    gst_percent: { type: Number, default: 0 },
    price_ex_gst: { type: Number, default: 0 },
    price_inc_gst: { type: Number, default: 0 },
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
  firm_name: String,
  address: String,
  contact_person: String,
  contact_no: String,
  type: { type: String, default: "enquiry" },
  mail_sent: { type: Boolean, default: false },
  mail_note: String,
  created_at: { type: Date, default: Date.now },
});
withId(contactSchema, "contacts");

const vendorSchema = new mongoose.Schema(
  {
    unique_id: { type: String, unique: true, sparse: true },
    name: String,
    firm_name: String,
    address: String,
    contact_person: String,
    contact_no: String,
    alternate_contact_no: String,
    contact_email: String,
    gst_no: String,
    pan_no: String,
    validation_status: { type: String, default: "Pending" },
    documents: { type: [fileRefSchema], default: [] },
    images: { type: [fileRefSchema], default: [] },
    notes: String,
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } }
);
withId(vendorSchema, "vendors");

const companySchema = new mongoose.Schema(
  {
    unique_id: { type: String, unique: true, sparse: true },
    firm_name: String,
    address: String,
    gst_no: String,
    pan_no: String,
    contact_l1_name: String,
    contact_l1_no: String,
    contact_l1_email: String,
    contact_l2_name: String,
    contact_l2_no: String,
    contact_l2_email: String,
    contact_l3_name: String,
    contact_l3_no: String,
    contact_l3_email: String,
    finance_contact_person: String,
    finance_email: String,
    validation_status: { type: String, default: "Pending" },
    documents: { type: [fileRefSchema], default: [] },
    images: { type: [fileRefSchema], default: [] },
    notes: String,
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } }
);
withId(companySchema, "companies");

const heroSlideSchema = new mongoose.Schema(
  {
    image: String,
    kicker: { type: String, default: "" },
    title: { type: String, default: "" },
    text: { type: String, default: "" },
    button_label: { type: String, default: "Explore" },
    button_link: { type: String, default: "/auction" },
    sort_order: { type: Number, default: 0 },
    status: { type: Number, default: 1 },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } }
);
withId(heroSlideSchema, "hero_slides");

const passwordResetSchema = new mongoose.Schema({ email: String, token: String, created_at: { type: Date, default: Date.now } });

const watchlistSchema = new mongoose.Schema({ user_id: Number, product_id: Number });
watchlistSchema.index({ user_id: 1, product_id: 1 }, { unique: true });

const siteSettingSchema = new mongoose.Schema(
  {
    key: { type: String, unique: true, default: "site" },
    wordThe: { type: String, default: "THE" },
    wordAuction: { type: String, default: "AUCTION" },
    wordHouse: { type: String, default: "HOUSE" },
    colorThe: { type: String, default: "#5F8F54" },
    colorAuction: { type: String, default: "#1A1E1A" },
    colorHouse: { type: String, default: "#5F8F54" },
    colorBg: { type: String, default: "#F2F5F2" },
    colorPanel: { type: String, default: "#FFFFFF" },
    colorAccent: { type: String, default: "#7AAB6D" },
    colorAccent2: { type: String, default: "#5F8F54" },
    colorText: { type: String, default: "#1A1E1A" },
    colorMuted: { type: String, default: "#5E6A5E" },
    adminNotifyEmail: { type: String, default: "auction@gmail.com" },
    vendorEnrolmentMail: {
      type: String,
      default:
        "Dear Vendor,\n\nThank you for your enquiry with The Auction House.\n\nPlease find enclosed / request for:\n1. Vendor enrolment documents\n2. Auction House terms & conditions\n3. Vendor registration fee details\n\nKindly complete registration after document submission.\n\nRegards,\nThe Auction House\nChennai",
    },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } }
);

export const DEFAULT_SITE = {
  key: "site",
  wordThe: "THE",
  wordAuction: "AUCTION",
  wordHouse: "HOUSE",
  colorThe: "#5F8F54",
  colorAuction: "#1A1E1A",
  colorHouse: "#5F8F54",
  colorBg: "#F2F5F2",
  colorPanel: "#FFFFFF",
  colorAccent: "#7AAB6D",
  colorAccent2: "#5F8F54",
  colorText: "#1A1E1A",
  colorMuted: "#5E6A5E",
  adminNotifyEmail: "auction@gmail.com",
  vendorEnrolmentMail:
    "Dear Vendor,\n\nThank you for your enquiry with The Auction House.\n\nPlease find enclosed / request for:\n1. Vendor enrolment documents\n2. Auction House terms & conditions\n3. Vendor registration fee details\n\nKindly complete registration after document submission.\n\nRegards,\nThe Auction House\nChennai",
};

const LEGACY_DARK_BG = new Set(["#050605", "#000000", "#0a0f0b", "#121a13"]);

export async function getSiteSettings() {
  let doc = await SiteSetting.findOne({ key: "site" });
  if (!doc) doc = await SiteSetting.create(DEFAULT_SITE);
  const bg = String(doc.colorBg || "").toLowerCase();
  if (LEGACY_DARK_BG.has(bg)) {
    doc.colorBg = DEFAULT_SITE.colorBg;
    doc.colorPanel = DEFAULT_SITE.colorPanel;
    doc.colorAccent = DEFAULT_SITE.colorAccent;
    doc.colorAccent2 = DEFAULT_SITE.colorAccent2;
    doc.colorText = DEFAULT_SITE.colorText;
    doc.colorMuted = DEFAULT_SITE.colorMuted;
    doc.colorThe = DEFAULT_SITE.colorThe;
    doc.colorAuction = DEFAULT_SITE.colorAuction;
    doc.colorHouse = DEFAULT_SITE.colorHouse;
    await doc.save();
  }
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
export const Vendor = mongoose.models.Vendor || mongoose.model("Vendor", vendorSchema);
export const Company = mongoose.models.Company || mongoose.model("Company", companySchema);
export const HeroSlide = mongoose.models.HeroSlide || mongoose.model("HeroSlide", heroSlideSchema);
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
