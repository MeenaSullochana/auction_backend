import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import { connectDb } from "./db.js";
import { Admin, Auction, Category, DEFAULT_SITE, Product, SiteSetting, User } from "./models.js";

dotenv.config();
await connectDb();

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

if (!(await User.findOne({ username: "bidder01" }))) {
  await User.create({
    firstname: "Demo",
    lastname: "Bidder",
    username: "bidder01",
    email: "bidder@auction.test",
    mobile: "+919800000001",
    password: userPass,
    country: "India",
    country_code: "IN",
    mobile_code: "+91",
    status: 1,
    approve: 1,
    user_code: "U9F21",
  });
}

if (!(await Category.findOne())) {
  await Category.create({ name: "Plant & Machinery", icon: "las la-cogs", status: 1 });
  await Category.create({ name: "Vehicles", icon: "las la-car", status: 1 });
  await Category.create({ name: "Scrap & Spares", icon: "las la-recycle", status: 1 });
}

if (!(await Auction.findOne())) {
  const start = new Date(Date.now() - 60 * 60 * 1000).toISOString().slice(0, 19).replace("T", " ");
  const end = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 19).replace("T", " ");
  const upcomingStart = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 19).replace("T", " ");
  const upcomingEnd = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString().slice(0, 19).replace("T", " ");
  const user = await User.findOne({ username: "bidder01" });
  await Auction.create({
    name: "Chennai Industrial Disposal",
    icon: "las la-industry",
    status: 1,
    started_at: start,
    expired_at: end,
    assign_user: JSON.stringify([user.id]),
  });
  await Auction.create({
    name: "Upcoming Spare Parts Lot",
    icon: "las la-boxes",
    status: 1,
    started_at: upcomingStart,
    expired_at: upcomingEnd,
    assign_user: "[]",
  });
  const auction = await Auction.findOne({ name: "Chennai Industrial Disposal" });
  const cat = await Category.findOne({ name: "Plant & Machinery" });
  await Product.create({
    admin_id: 1,
    category_id: cat.id,
    auction_id: auction.id,
    name: "CNC Lathe Machine",
    price: 125000,
    min_bid_amount: 1000,
    code: "TAH-CNC-01",
    condition: "Used - Good",
    location: "Chennai Yard",
    excise_duty: "12",
    sales_duty: "18",
    quantity: 1,
    status: 1,
    started_at: start,
    expired_at: end,
  });
  await Product.create({
    admin_id: 1,
    category_id: cat.id,
    auction_id: auction.id,
    name: "Hydraulic Press 50T",
    price: 80000,
    min_bid_amount: 500,
    code: "TAH-HYD-02",
    condition: "Working",
    location: "Chennai Yard",
    excise_duty: "12",
    sales_duty: "18",
    quantity: 1,
    status: 1,
    started_at: start,
    expired_at: end,
  });
}

console.log("MongoDB seed complete.");
console.log("Admin login: username=admin  password=admin123");
console.log("User login:  username=bidder01  password=user1234  (already approved)");
process.exit(0);
