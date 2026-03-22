/**
 * NEXCOM Exchange — Internationalisation (i18n)
 * Supported languages: English (en), Yoruba (yo), Igbo (ig), Hausa (ha), Nigerian Pidgin (pcm)
 * Default currency: NGN (Nigerian Naira)
 */

export type Language = "en" | "yo" | "ig" | "ha" | "pcm";
export type Currency = "NGN" | "USD" | "EUR" | "GBP" | "GHS" | "KES" | "ZAR" | "XOF";

// ─── Exchange rates (NGN as base) ─────────────────────────────────────────────
export const EXCHANGE_RATES: Record<Currency, number> = {
  NGN: 1,
  USD: 1620,
  EUR: 1750,
  GBP: 2050,
  GHS: 112,
  KES: 12.5,
  ZAR: 88,
  XOF: 2.65,
};

export const CURRENCY_SYMBOLS: Record<Currency, string> = {
  NGN: "₦",
  USD: "$",
  EUR: "€",
  GBP: "£",
  GHS: "₵",
  KES: "KSh",
  ZAR: "R",
  XOF: "CFA",
};

export const CURRENCY_NAMES: Record<Currency, string> = {
  NGN: "Nigerian Naira",
  USD: "US Dollar",
  EUR: "Euro",
  GBP: "British Pound",
  GHS: "Ghanaian Cedi",
  KES: "Kenyan Shilling",
  ZAR: "South African Rand",
  XOF: "West African CFA Franc",
};

// ─── Translation keys ─────────────────────────────────────────────────────────
export type TranslationKey =
  // Navigation
  | "nav.dashboard" | "nav.markets" | "nav.trade" | "nav.orders" | "nav.portfolio"
  | "nav.receipts" | "nav.deposits" | "nav.delivery" | "nav.warehouses"
  | "nav.alerts" | "nav.notifications" | "nav.account" | "nav.admin"
  | "nav.settlements" | "nav.analytics" | "nav.logout"
  // Common actions
  | "action.buy" | "action.sell" | "action.cancel" | "action.submit" | "action.confirm"
  | "action.save" | "action.edit" | "action.delete" | "action.search" | "action.filter"
  | "action.refresh" | "action.close" | "action.back" | "action.view" | "action.create"
  | "action.approve" | "action.reject" | "action.download" | "action.upload"
  // Status
  | "status.open" | "status.filled" | "status.cancelled" | "status.pending"
  | "status.settled" | "status.failed" | "status.active" | "status.verified" | "status.rejected"
  // Labels
  | "label.price" | "label.quantity" | "label.total" | "label.symbol" | "label.type"
  | "label.side" | "label.status" | "label.date" | "label.time" | "label.fee"
  | "label.currency" | "label.language" | "label.theme" | "label.settings"
  | "label.portfolio" | "label.pnl" | "label.value" | "label.cost" | "label.change"
  // Messages
  | "msg.loading" | "msg.noData" | "msg.error" | "msg.success" | "msg.loginRequired"
  | "msg.orderPlaced" | "msg.orderCancelled" | "msg.alertCreated" | "msg.alertDeleted"
  | "msg.settledSuccess" | "msg.comingSoon"
  // Dashboard
  | "dash.totalValue" | "dash.openOrders" | "dash.receipts" | "dash.recentActivity"
  // Trading
  | "trade.orderBook" | "trade.recentTrades" | "trade.limitOrder" | "trade.marketOrder"
  | "trade.stopLimit" | "trade.timeInForce" | "trade.placeOrder" | "trade.confirmOrder"
  | "trade.buy" | "trade.sell" | "trade.estimatedValue" | "trade.signInRequired"
  | "trade.bidPrice" | "trade.askPrice" | "trade.spread" | "trade.live" | "trade.connecting"
  | "trade.price" | "trade.qty" | "trade.time" | "trade.side"
  // Onboarding
  | "onboard.title" | "onboard.subtitle" | "onboard.step1" | "onboard.step2" | "onboard.step3"
  | "onboard.firstName" | "onboard.lastName" | "onboard.phone" | "onboard.nin" | "onboard.bvn";

type Translations = Record<TranslationKey, string>;

// ─── English ──────────────────────────────────────────────────────────────────
const en: Translations = {
  "nav.dashboard": "Dashboard", "nav.markets": "Markets", "nav.trade": "Trade",
  "nav.orders": "Orders", "nav.portfolio": "Portfolio", "nav.receipts": "Warehouse Receipts",
  "nav.deposits": "Deposits", "nav.delivery": "Delivery", "nav.warehouses": "Warehouses",
  "nav.alerts": "Price Alerts", "nav.notifications": "Notifications", "nav.account": "Account",
  "nav.admin": "Admin", "nav.settlements": "Settlements", "nav.analytics": "Analytics",
  "nav.logout": "Logout",
  "action.buy": "Buy", "action.sell": "Sell", "action.cancel": "Cancel",
  "action.submit": "Submit", "action.confirm": "Confirm", "action.save": "Save",
  "action.edit": "Edit", "action.delete": "Delete", "action.search": "Search",
  "action.filter": "Filter", "action.refresh": "Refresh", "action.close": "Close",
  "action.back": "Back", "action.view": "View", "action.create": "Create",
  "action.approve": "Approve", "action.reject": "Reject", "action.download": "Download",
  "action.upload": "Upload",
  "status.open": "Open", "status.filled": "Filled", "status.cancelled": "Cancelled",
  "status.pending": "Pending", "status.settled": "Settled", "status.failed": "Failed",
  "status.active": "Active", "status.verified": "Verified", "status.rejected": "Rejected",
  "label.price": "Price", "label.quantity": "Quantity", "label.total": "Total",
  "label.symbol": "Symbol", "label.type": "Type", "label.side": "Side",
  "label.status": "Status", "label.date": "Date", "label.time": "Time", "label.fee": "Fee",
  "label.currency": "Currency", "label.language": "Language", "label.theme": "Theme",
  "label.settings": "Settings", "label.portfolio": "Portfolio", "label.pnl": "P&L",
  "label.value": "Value", "label.cost": "Cost", "label.change": "Change",
  "msg.loading": "Loading...", "msg.noData": "No data available", "msg.error": "An error occurred",
  "msg.success": "Success", "msg.loginRequired": "Please log in to continue",
  "msg.orderPlaced": "Order placed successfully", "msg.orderCancelled": "Order cancelled",
  "msg.alertCreated": "Price alert created", "msg.alertDeleted": "Alert deleted",
  "msg.settledSuccess": "Settlement completed", "msg.comingSoon": "Coming soon",
  "dash.totalValue": "Total Portfolio Value", "dash.openOrders": "Open Orders",
  "dash.receipts": "Warehouse Receipts", "dash.recentActivity": "Recent Activity",
  "trade.orderBook": "Order Book", "trade.recentTrades": "Recent Trades",
  "trade.limitOrder": "Limit Order", "trade.marketOrder": "Market Order",
  "trade.stopLimit": "Stop Limit", "trade.timeInForce": "Time in Force",
  "trade.placeOrder": "Place Order", "trade.confirmOrder": "Confirm Order",
  "trade.buy": "Buy", "trade.sell": "Sell", "trade.estimatedValue": "Estimated Value",
  "trade.signInRequired": "Sign in to place live orders",
  "trade.bidPrice": "Bid", "trade.askPrice": "Ask", "trade.spread": "Spread",
  "trade.live": "Live", "trade.connecting": "Connecting…",
  "trade.price": "Price", "trade.qty": "Qty", "trade.time": "Time", "trade.side": "Side",
  "onboard.title": "Create Your Account", "onboard.subtitle": "Join the NEXCOM Exchange",
  "onboard.step1": "Personal Information", "onboard.step2": "Business Details",
  "onboard.step3": "KYC Documents", "onboard.firstName": "First Name",
  "onboard.lastName": "Last Name", "onboard.phone": "Phone Number",
  "onboard.nin": "NIN (National ID)", "onboard.bvn": "BVN (Bank Verification Number)",
};

// ─── Yoruba ───────────────────────────────────────────────────────────────────
const yo: Translations = {
  "nav.dashboard": "Iwe Akosile", "nav.markets": "Oja", "nav.trade": "Iṣowo",
  "nav.orders": "Awọn Aṣẹ", "nav.portfolio": "Apamọwọ", "nav.receipts": "Awọn Iwe Ẹri Ile-itọju",
  "nav.deposits": "Awọn Idogo", "nav.delivery": "Ifijiṣẹ", "nav.warehouses": "Awọn Ile-itọju",
  "nav.alerts": "Awọn Itaniji Owo", "nav.notifications": "Awọn Ifiranṣẹ", "nav.account": "Akọọlẹ",
  "nav.admin": "Alakoso", "nav.settlements": "Awọn Ipinnu", "nav.analytics": "Itupalẹ",
  "nav.logout": "Jade",
  "action.buy": "Ra", "action.sell": "Ta", "action.cancel": "Fagilee",
  "action.submit": "Fi Silẹ", "action.confirm": "Jẹrisi", "action.save": "Fipamọ",
  "action.edit": "Ṣatunkọ", "action.delete": "Paarẹ", "action.search": "Wa",
  "action.filter": "Àlẹmọ", "action.refresh": "Tun Ṣe", "action.close": "Pa",
  "action.back": "Pada", "action.view": "Wo", "action.create": "Ṣẹda",
  "action.approve": "Fọwọsi", "action.reject": "Kọ", "action.download": "Gba Sori",
  "action.upload": "Gbe Soke",
  "status.open": "Ṣii", "status.filled": "Ti Kun", "status.cancelled": "Ti Fagilee",
  "status.pending": "Nduro", "status.settled": "Ti Yanju", "status.failed": "Kuna",
  "status.active": "Nṣiṣẹ", "status.verified": "Ti Jẹrisi", "status.rejected": "Ti Kọ",
  "label.price": "Owo", "label.quantity": "Iye", "label.total": "Apapọ",
  "label.symbol": "Aami", "label.type": "Iru", "label.side": "Ẹgbẹ",
  "label.status": "Ipo", "label.date": "Ọjọ", "label.time": "Akoko", "label.fee": "Owo Iṣẹ",
  "label.currency": "Owo Orile-ede", "label.language": "Ede", "label.theme": "Apẹrẹ",
  "label.settings": "Eto", "label.portfolio": "Apamọwọ", "label.pnl": "Ere/Padanu",
  "label.value": "Iye Owo", "label.cost": "Iye Owo Rira", "label.change": "Iyipada",
  "msg.loading": "Nduro...", "msg.noData": "Ko si data", "msg.error": "Aṣiṣe waye",
  "msg.success": "Aṣeyọri", "msg.loginRequired": "Jọwọ wọle lati tẹsiwaju",
  "msg.orderPlaced": "Aṣẹ ti gbe kalẹ", "msg.orderCancelled": "Aṣẹ ti fagilee",
  "msg.alertCreated": "Itaniji owo ti ṣẹda", "msg.alertDeleted": "Itaniji ti paarẹ",
  "msg.settledSuccess": "Ipinnu ti pari", "msg.comingSoon": "Yoo wa laipẹ",
  "dash.totalValue": "Apapọ Iye Apamọwọ", "dash.openOrders": "Awọn Aṣẹ Ṣii",
  "dash.receipts": "Awọn Iwe Ẹri Ile-itọju", "dash.recentActivity": "Iṣẹ Aipẹ",
  "trade.orderBook": "Iwe Aṣẹ", "trade.recentTrades": "Awọn Iṣowo Aipẹ",
  "trade.limitOrder": "Aṣẹ Opin", "trade.marketOrder": "Aṣẹ Oja",
  "trade.stopLimit": "Duro Opin", "trade.timeInForce": "Akoko Agbara",
  "trade.placeOrder": "Gbe Aṣẹ", "trade.confirmOrder": "Jẹrisi Aṣẹ",
  "trade.buy": "Ra", "trade.sell": "Ta", "trade.estimatedValue": "Iye Owo Ifoju",
  "trade.signInRequired": "Wọle lati gbe awọn aṣẹ laaye",
  "trade.bidPrice": "Owo Rira", "trade.askPrice": "Owo Tita", "trade.spread": "Iyatọ",
  "trade.live": "Laaye", "trade.connecting": "Ndopọ…",
  "trade.price": "Owo", "trade.qty": "Iye", "trade.time": "Akoko", "trade.side": "Ẹgbẹ",
  "onboard.title": "Ṣẹda Akọọlẹ Rẹ", "onboard.subtitle": "Darapọ mọ NEXCOM Exchange",
  "onboard.step1": "Alaye Ti Ara Ẹni", "onboard.step2": "Awọn Alaye Iṣowo",
  "onboard.step3": "Awọn Iwe Aṣẹ KYC", "onboard.firstName": "Orukọ",
  "onboard.lastName": "Orukọ Idile", "onboard.phone": "Nọmba Foonu",
  "onboard.nin": "NIN (Nọmba Idanimọ Orile-ede)", "onboard.bvn": "BVN (Nọmba Idaniloju Banki)",
};

// ─── Igbo ─────────────────────────────────────────────────────────────────────
const ig: Translations = {
  "nav.dashboard": "Ọchịchọ Ọrụ", "nav.markets": "Ahịa", "nav.trade": "Azụmahịa",
  "nav.orders": "Iwu", "nav.portfolio": "Akpa Ego", "nav.receipts": "Akwụkwọ Ụlọ Nchekwa",
  "nav.deposits": "Ndekọ", "nav.delivery": "Nnyefe", "nav.warehouses": "Ụlọ Nchekwa",
  "nav.alerts": "Ọkwa Ọnụ Ahịa", "nav.notifications": "Ọkwa", "nav.account": "Akantị",
  "nav.admin": "Onye Njikwa", "nav.settlements": "Ikpeazụ", "nav.analytics": "Nyocha",
  "nav.logout": "Pụọ",
  "action.buy": "Zụọ", "action.sell": "Ree", "action.cancel": "Kagbuo",
  "action.submit": "Nyefee", "action.confirm": "Kwenye", "action.save": "Chekwaa",
  "action.edit": "Dezie", "action.delete": "Hichapụ", "action.search": "Chọọ",
  "action.filter": "Nyocha", "action.refresh": "Mee Ọzọ", "action.close": "Mechie",
  "action.back": "Laghachi", "action.view": "Lee", "action.create": "Mepụta",
  "action.approve": "Kwado", "action.reject": "Jụ", "action.download": "Budata",
  "action.upload": "Bulite",
  "status.open": "Mepere", "status.filled": "Jupụtara", "status.cancelled": "Akagbuola",
  "status.pending": "Na-atọ ụzọ", "status.settled": "Emechara", "status.failed": "Dara ada",
  "status.active": "Na-arụ ọrụ", "status.verified": "Akwadoro", "status.rejected": "Ajụrụ",
  "label.price": "Ọnụ ahịa", "label.quantity": "Ọnụọgụ", "label.total": "Ngụkọta",
  "label.symbol": "Akara", "label.type": "Ụdị", "label.side": "Akụkụ",
  "label.status": "Ọnọdụ", "label.date": "Ụbọchị", "label.time": "Oge", "label.fee": "Ụgwọ",
  "label.currency": "Ego", "label.language": "Asụsụ", "label.theme": "Ụdị Ihe Ngosi",
  "label.settings": "Ntọala", "label.portfolio": "Akpa Ego", "label.pnl": "Ọla/Mfu",
  "label.value": "Uru", "label.cost": "Ọnụ Ahịa Ịzụ", "label.change": "Mgbanwe",
  "msg.loading": "Na-ebu...", "msg.noData": "Enweghị data", "msg.error": "Mperi mere",
  "msg.success": "Ọ dị mma", "msg.loginRequired": "Biko banye iji gaa n'ihu",
  "msg.orderPlaced": "Iwu etinyere", "msg.orderCancelled": "Akagbuola iwu",
  "msg.alertCreated": "Ọkwa ọnụ ahịa emepụtara", "msg.alertDeleted": "Ehichapụrụ ọkwa",
  "msg.settledSuccess": "Emechara ikpeazụ", "msg.comingSoon": "Ọ ga-abịa n'oge na-adịghị anya",
  "dash.totalValue": "Ngụkọta Uru Akpa Ego", "dash.openOrders": "Iwu Mepere",
  "dash.receipts": "Akwụkwọ Ụlọ Nchekwa", "dash.recentActivity": "Ọrụ Ọhụrụ",
  "trade.orderBook": "Akwụkwọ Iwu", "trade.recentTrades": "Azụmahịa Ọhụrụ",
  "trade.limitOrder": "Iwu Oke", "trade.marketOrder": "Iwu Ahịa",
  "trade.stopLimit": "Kwụsị Oke", "trade.timeInForce": "Oge Ike",
  "trade.placeOrder": "Tinye Iwu", "trade.confirmOrder": "Kwenye Iwu",
  "trade.buy": "Zụọ", "trade.sell": "Ree", "trade.estimatedValue": "Uru Atụmatụ",
  "trade.signInRequired": "Banye iji tinye iwu ndụ",
  "trade.bidPrice": "Ọnụ Ịzụ", "trade.askPrice": "Ọnụ Ire", "trade.spread": "Ọdịiche",
  "trade.live": "Ndụ", "trade.connecting": "Na-ejikọ…",
  "trade.price": "Ọnụ ahịa", "trade.qty": "Ọnụọgụ", "trade.time": "Oge", "trade.side": "Akụkụ",
  "onboard.title": "Mepụta Akantị Gị", "onboard.subtitle": "Sonye NEXCOM Exchange",
  "onboard.step1": "Ozi Onwe Onye", "onboard.step2": "Nkọwa Azụmahịa",
  "onboard.step3": "Akwụkwọ KYC", "onboard.firstName": "Aha Mbụ",
  "onboard.lastName": "Aha Ụmụnna", "onboard.phone": "Nọmba Ekwentị",
  "onboard.nin": "NIN (Nọmba Njirimara Mba)", "onboard.bvn": "BVN (Nọmba Nkwenye Ụlọ Akụ)",
};

// ─── Hausa ────────────────────────────────────────────────────────────────────
const ha: Translations = {
  "nav.dashboard": "Allon Aiki", "nav.markets": "Kasuwa", "nav.trade": "Kasuwanci",
  "nav.orders": "Umarni", "nav.portfolio": "Jaka Kudi", "nav.receipts": "Takardar Gidan Ajiya",
  "nav.deposits": "Ajiyar Kudi", "nav.delivery": "Isar da Kaya", "nav.warehouses": "Gidajen Ajiya",
  "nav.alerts": "Faɗakarwa ta Farashin", "nav.notifications": "Sanarwa", "nav.account": "Asusun",
  "nav.admin": "Mai Gudanarwa", "nav.settlements": "Sulhuntawa", "nav.analytics": "Nazari",
  "nav.logout": "Fita",
  "action.buy": "Saya", "action.sell": "Sayar", "action.cancel": "Soke",
  "action.submit": "Aika", "action.confirm": "Tabbatar", "action.save": "Ajiye",
  "action.edit": "Gyara", "action.delete": "Goge", "action.search": "Nema",
  "action.filter": "Tace", "action.refresh": "Sabunta", "action.close": "Rufe",
  "action.back": "Koma", "action.view": "Duba", "action.create": "Ƙirƙira",
  "action.approve": "Amince", "action.reject": "Ƙi", "action.download": "Sauke",
  "action.upload": "Loda",
  "status.open": "Buɗe", "status.filled": "Cike", "status.cancelled": "An Soke",
  "status.pending": "Ana Jira", "status.settled": "An Sulhunta", "status.failed": "Ya Kasa",
  "status.active": "Aiki", "status.verified": "An Tabbatar", "status.rejected": "An Ƙi",
  "label.price": "Farashi", "label.quantity": "Yawa", "label.total": "Jimla",
  "label.symbol": "Alama", "label.type": "Nau'i", "label.side": "Gefen",
  "label.status": "Matsayi", "label.date": "Kwanan Wata", "label.time": "Lokaci", "label.fee": "Kuɗin Aiki",
  "label.currency": "Kuɗi", "label.language": "Harshe", "label.theme": "Salo",
  "label.settings": "Saiti", "label.portfolio": "Jaka Kudi", "label.pnl": "Riba/Asara",
  "label.value": "Darajar", "label.cost": "Farashin Siya", "label.change": "Canjin",
  "msg.loading": "Ana lodawa...", "msg.noData": "Babu bayani", "msg.error": "Kuskure ya faru",
  "msg.success": "Nasara", "msg.loginRequired": "Da fatan za a shiga don ci gaba",
  "msg.orderPlaced": "An sanya umarni", "msg.orderCancelled": "An soke umarni",
  "msg.alertCreated": "An ƙirƙiri faɗakarwa", "msg.alertDeleted": "An goge faɗakarwa",
  "msg.settledSuccess": "An kammala sulhuntawa", "msg.comingSoon": "Yana zuwa nan ba da jimawa ba",
  "dash.totalValue": "Jimlar Darajar Jaka Kudi", "dash.openOrders": "Buɗaɗɗen Umarni",
  "dash.receipts": "Takardar Gidan Ajiya", "dash.recentActivity": "Ayyukan Kwanan Nan",
  "trade.orderBook": "Littafin Umarni", "trade.recentTrades": "Kasuwancin Kwanan Nan",
  "trade.limitOrder": "Umarni na Iyaka", "trade.marketOrder": "Umarni na Kasuwa",
  "trade.stopLimit": "Tsayawa Iyaka", "trade.timeInForce": "Lokacin Ƙarfi",
  "trade.placeOrder": "Sanya Umarni", "trade.confirmOrder": "Tabbatar da Umarni",
  "trade.buy": "Saya", "trade.sell": "Sayar", "trade.estimatedValue": "Ƙimar da Ake Tsammani",
  "trade.signInRequired": "Shiga don sanya umarnin kai tsaye",
  "trade.bidPrice": "Farashin Siya", "trade.askPrice": "Farashin Sayarwa", "trade.spread": "Bambanci",
  "trade.live": "Kai tsaye", "trade.connecting": "Ana haɗawa…",
  "trade.price": "Farashi", "trade.qty": "Yawa", "trade.time": "Lokaci", "trade.side": "Gefen",
  "onboard.title": "Ƙirƙiri Asusunka", "onboard.subtitle": "Shiga NEXCOM Exchange",
  "onboard.step1": "Bayanan Sirri", "onboard.step2": "Bayanan Kasuwanci",
  "onboard.step3": "Takardu na KYC", "onboard.firstName": "Suna",
  "onboard.lastName": "Sunan Iyali", "onboard.phone": "Lambar Waya",
  "onboard.nin": "NIN (Lambar Shaida ta Ƙasa)", "onboard.bvn": "BVN (Lambar Tabbacin Banki)",
};

// ─── Nigerian Pidgin ──────────────────────────────────────────────────────────
const pcm: Translations = {
  "nav.dashboard": "Dashboard", "nav.markets": "Market", "nav.trade": "Trade",
  "nav.orders": "Orders", "nav.portfolio": "Portfolio", "nav.receipts": "Warehouse Receipts",
  "nav.deposits": "Deposits", "nav.delivery": "Delivery", "nav.warehouses": "Warehouses",
  "nav.alerts": "Price Alerts", "nav.notifications": "Notifications", "nav.account": "Account",
  "nav.admin": "Admin", "nav.settlements": "Settlements", "nav.analytics": "Analytics",
  "nav.logout": "Log Out",
  "action.buy": "Buy", "action.sell": "Sell", "action.cancel": "Cancel am",
  "action.submit": "Submit", "action.confirm": "Confirm", "action.save": "Save am",
  "action.edit": "Edit am", "action.delete": "Delete am", "action.search": "Search",
  "action.filter": "Filter", "action.refresh": "Refresh", "action.close": "Close am",
  "action.back": "Go back", "action.view": "View am", "action.create": "Create",
  "action.approve": "Approve am", "action.reject": "Reject am", "action.download": "Download am",
  "action.upload": "Upload am",
  "status.open": "Open", "status.filled": "Filled", "status.cancelled": "Cancelled",
  "status.pending": "Pending", "status.settled": "Settled", "status.failed": "E fail",
  "status.active": "Active", "status.verified": "Verified", "status.rejected": "Rejected",
  "label.price": "Price", "label.quantity": "Quantity", "label.total": "Total",
  "label.symbol": "Symbol", "label.type": "Type", "label.side": "Side",
  "label.status": "Status", "label.date": "Date", "label.time": "Time", "label.fee": "Fee",
  "label.currency": "Currency", "label.language": "Language", "label.theme": "Theme",
  "label.settings": "Settings", "label.portfolio": "Portfolio", "label.pnl": "Profit/Loss",
  "label.value": "Value", "label.cost": "Cost", "label.change": "Change",
  "msg.loading": "E dey load...", "msg.noData": "No data dey", "msg.error": "Error don happen",
  "msg.success": "E work!", "msg.loginRequired": "Abeg login make you continue",
  "msg.orderPlaced": "Order don enter", "msg.orderCancelled": "Order don cancel",
  "msg.alertCreated": "Price alert don set", "msg.alertDeleted": "Alert don delete",
  "msg.settledSuccess": "Settlement don complete", "msg.comingSoon": "E dey come soon",
  "dash.totalValue": "Total Portfolio Value", "dash.openOrders": "Open Orders",
  "dash.receipts": "Warehouse Receipts", "dash.recentActivity": "Recent Activity",
  "trade.orderBook": "Order Book", "trade.recentTrades": "Recent Trades",
  "trade.limitOrder": "Limit Order", "trade.marketOrder": "Market Order",
  "trade.stopLimit": "Stop Limit", "trade.timeInForce": "Time in Force",
  "trade.placeOrder": "Place Order", "trade.confirmOrder": "Confirm Order",
  "trade.buy": "Buy", "trade.sell": "Sell", "trade.estimatedValue": "Estimated Value",
  "trade.signInRequired": "Sign in to place live orders",
  "trade.bidPrice": "Bid", "trade.askPrice": "Ask", "trade.spread": "Spread",
  "trade.live": "Live", "trade.connecting": "Connecting…",
  "trade.price": "Price", "trade.qty": "Qty", "trade.time": "Time", "trade.side": "Side",
  "onboard.title": "Create Your Account", "onboard.subtitle": "Join NEXCOM Exchange",
  "onboard.step1": "Personal Info", "onboard.step2": "Business Details",
  "onboard.step3": "KYC Documents", "onboard.firstName": "First Name",
  "onboard.lastName": "Last Name", "onboard.phone": "Phone Number",
  "onboard.nin": "NIN (National ID Number)", "onboard.bvn": "BVN (Bank Verification Number)",
};

// ─── Translation map ──────────────────────────────────────────────────────────
const translations: Record<Language, Translations> = { en, yo, ig, ha, pcm };

/** Translate a key in the given language, falling back to English */
export function t(key: TranslationKey, lang: Language = "en"): string {
  return translations[lang]?.[key] ?? translations.en[key] ?? key;
}

/** Format a monetary value in the given currency */
export function formatCurrency(
  amountInNGN: number,
  currency: Currency = "NGN",
  compact = false
): string {
  const rate = EXCHANGE_RATES[currency];
  const converted = amountInNGN / rate;
  const symbol = CURRENCY_SYMBOLS[currency];
  if (compact) {
    if (converted >= 1_000_000_000) return `${symbol}${(converted / 1_000_000_000).toFixed(2)}B`;
    if (converted >= 1_000_000) return `${symbol}${(converted / 1_000_000).toFixed(2)}M`;
    if (converted >= 1_000) return `${symbol}${(converted / 1_000).toFixed(1)}K`;
  }
  return `${symbol}${converted.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Convert an amount from one currency to NGN */
export function toNGN(amount: number, fromCurrency: Currency): number {
  return amount * EXCHANGE_RATES[fromCurrency];
}

/** Convert an amount from NGN to another currency */
export function fromNGN(amountNGN: number, toCurrency: Currency): number {
  return amountNGN / EXCHANGE_RATES[toCurrency];
}
