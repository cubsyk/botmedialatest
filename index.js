const TelegramBot = require('node-telegram-bot-api');
const { Pool } = require('pg');
const crypto = require("crypto");

const token = process.env.BOT_TOKEN;
const bot = new TelegramBot(token, { polling: true });

// ==========================
// DATABASE CONNECTION
// ==========================
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const botUsername = "seducteasemedia_bot";
const OWNER_ID = 1388479642;

// CHANNEL WAJIB JOIN
const CHANNEL_USERNAME = "@seducteasech";

// GROUP WAJIB JOIN (grup privat pakai Chat ID)
const GROUP_ID = -1003521400775;

// LINK INVITE GRUP
const GROUP_INVITE_LINK = "https://t.me/+WFBU_2WGIURmY2Nl";

// ==========================
// STATE — menyimpan video sementara
// ==========================
const pendingVideos = {};

// ==========================
// GENERATE RANDOM CODE
// ==========================
function generateCode() {
  return crypto.randomBytes(24).toString("base64")
    .replace(/\+/g, "A")
    .replace(/\//g, "B")
    .replace(/=/g, "");
}

// ==========================
// CREATE TABLE
// ==========================
(async () => {

  await pool.query(`
    CREATE TABLE IF NOT EXISTS videos (
      id SERIAL PRIMARY KEY,
      kode TEXT UNIQUE,
      file_id TEXT,
      judul TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS admins (
      id BIGINT PRIMARY KEY
    );
  `);

  await pool.query(
    "INSERT INTO admins (id) VALUES ($1) ON CONFLICT DO NOTHING",
    [OWNER_ID]
  );

  console.log("✅ Database ready");

})();

// ==========================
// CEK ADMIN
// ==========================
async function isAdmin(userId) {

  const result = await pool.query(
    "SELECT id FROM admins WHERE id=$1",
    [userId]
  );

  return result.rows.length > 0;

}

// ==========================
// CEK JOIN CHANNEL & GROUP
// ==========================
async function checkMembership(userId) {

  try {

    const channel = await bot.getChatMember(CHANNEL_USERNAME, userId);
    const group = await bot.getChatMember(GROUP_ID, userId);

    const allowed = ["member", "administrator", "creator"];

    if (!allowed.includes(channel.status)) return false;
    if (!allowed.includes(group.status)) return false;

    return true;

  } catch {
    return false;
  }

}

// ==========================
// ADD ADMIN
// ==========================
bot.onText(/\/addadmin (\d+)/, async (msg, match) => {

  if (msg.chat.id !== OWNER_ID)
    return bot.sendMessage(msg.chat.id, "❌ Hanya owner.");

  const id = match[1];

  await pool.query(
    "INSERT INTO admins (id) VALUES ($1) ON CONFLICT DO NOTHING",
    [id]
  );

  bot.sendMessage(msg.chat.id, "✅ Admin ditambahkan");

});

// ==========================
// LIST ADMIN
// ==========================
bot.onText(/\/listadmin/, async msg => {

  if (msg.chat.id !== OWNER_ID)
    return bot.sendMessage(msg.chat.id, "❌ Hanya owner.");

  const res = await pool.query("SELECT id FROM admins");

  let text = "📋 Daftar Admin\n\n";

  res.rows.forEach((r, i) => {
    if (r.id == OWNER_ID)
      text += `${i + 1}. ${r.id} (OWNER)\n`;
    else
      text += `${i + 1}. ${r.id}\n`;
  });

  bot.sendMessage(msg.chat.id, text);

});

// ==========================
// REMOVE ADMIN
// ==========================
bot.onText(/\/removeadmin (\d+)/, async (msg, match) => {

  if (msg.chat.id !== OWNER_ID)
    return bot.sendMessage(msg.chat.id, "❌ Hanya owner.");

  const id = parseInt(match[1]);

  if (id === OWNER_ID)
    return bot.sendMessage(msg.chat.id, "❌ Owner tidak bisa dihapus.");

  await pool.query(
    "DELETE FROM admins WHERE id=$1",
    [id]
  );

  bot.sendMessage(msg.chat.id, "✅ Admin dihapus");

});

// ==========================
// MY ID
// ==========================
bot.onText(/\/myid/, msg => {
  bot.sendMessage(msg.chat.id, `🆔 ID kamu: ${msg.chat.id}`);
});

// ==========================
// LIST VIDEO
// ==========================
bot.onText(/\/listvideo/, async msg => {

  const admin = await isAdmin(msg.chat.id);

  if (!admin)
    return bot.sendMessage(msg.chat.id, "❌ Hanya admin.");

  const res = await pool.query(
    "SELECT id, judul, kode FROM videos ORDER BY created_at DESC"
  );

  if (res.rows.length === 0)
    return bot.sendMessage(msg.chat.id, "📭 Belum ada video.");

  let text = "📋 Daftar Video\n\n";

  res.rows.forEach((r, i) => {
    text += `${i + 1}. ${r.judul} (${r.id})\n`;
    text += `🔗 https://t.me/${botUsername}?start=${r.kode}\n\n`;
  });

  bot.sendMessage(msg.chat.id, text);

});

// ==========================
// HAPUS VIDEO
// ==========================
bot.onText(/\/hapus_(\d+)/, async (msg, match) => {

  const admin = await isAdmin(msg.chat.id);

  if (!admin)
    return bot.sendMessage(msg.chat.id, "❌ Hanya admin.");

  const id = parseInt(match[1]);

  const res = await pool.query(
    "SELECT judul FROM videos WHERE id=$1",
    [id]
  );

  if (res.rows.length === 0)
    return bot.sendMessage(msg.chat.id, "❌ Video tidak ditemukan.");

  const judul = res.rows[0].judul;

  await pool.query("DELETE FROM videos WHERE id=$1", [id]);

  bot.sendMessage(msg.chat.id, `✅ Video "${judul}" berhasil dihapus.`);

});

// ==========================
// BATAL UPLOAD
// ==========================
bot.onText(/\/batal/, async msg => {

  const admin = await isAdmin(msg.chat.id);
  if (!admin) return;

  if (!pendingVideos[msg.chat.id])
    return bot.sendMessage(msg.chat.id, "⚠️ Tidak ada proses upload yang aktif.");

  delete pendingVideos[msg.chat.id];

  bot.sendMessage(msg.chat.id, "✅ Upload dibatalkan.");

});

// ==========================
// ADMIN UPLOAD VIDEO
// ==========================
bot.on("message", async msg => {

  if (!msg.video) return;

  const admin = await isAdmin(msg.chat.id);
  if (!admin) return;

  pendingVideos[msg.chat.id] = msg.video.file_id;

  bot.sendMessage(msg.chat.id,
    "📝 Berikan judul untuk video ini:\n\n(ketik /batal untuk membatalkan)"
  );

});

// ==========================
// TERIMA JUDUL DARI ADMIN
// ==========================
bot.on("message", async msg => {

  if (!pendingVideos[msg.chat.id]) return;
  if (!msg.text) return;
  if (msg.text.startsWith("/")) return;

  const admin = await isAdmin(msg.chat.id);
  if (!admin) return;

  const file_id = pendingVideos[msg.chat.id];
  const judul = msg.text.trim();
  const kode = generateCode();

  delete pendingVideos[msg.chat.id];

  await pool.query(
    "INSERT INTO videos (kode, file_id, judul) VALUES ($1, $2, $3)",
    [kode, file_id, judul]
  );

  const link = `https://t.me/${botUsername}?start=${kode}`;

  bot.sendMessage(msg.chat.id,
`✅ Video berhasil disimpan

Judul : ${judul}
🔗 Link: \`${link}\``,
    { parse_mode: "Markdown" }
  );

});

// ==========================
// START WITH LINK
// ==========================
bot.onText(/\/start (.+)/, async (msg, match) => {

  const chatId = msg.chat.id;
  const kode = match[1];

  const joined = await checkMembership(chatId);

  if (!joined) {

    return bot.sendMessage(chatId,
      "🚫 Kamu harus join channel & grup kami dulu untuk melihat konten!",
      {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "Join Channel",
                url: `https://t.me/${CHANNEL_USERNAME.replace("@", "")}`
              }
            ],
            [
              {
                text: "Join Grup",
                url: GROUP_INVITE_LINK
              }
            ],
            [
              {
                text: "✅ Saya sudah join",
                callback_data: `ck_${kode}`
              }
            ]
          ]
        }
      });

  }

  const res = await pool.query(
    "SELECT file_id FROM videos WHERE kode=$1",
    [kode]
  );

  if (res.rows.length === 0)
    return bot.sendMessage(chatId, "❌ Video tidak ditemukan");

  // protect_content: true — video tidak bisa di-forward & disimpan
  bot.sendVideo(chatId, res.rows[0].file_id, {
    protect_content: true
  });

});

// ==========================
// CEK ULANG JOIN
// ==========================
bot.on("callback_query", async query => {

  const chatId = query.message.chat.id;
  const data = query.data;

  if (!data.startsWith("ck_")) return;

  const kode = data.slice("ck_".length);

  const joined = await checkMembership(chatId);

  if (!joined) {

    return bot.answerCallbackQuery(query.id, {
      text: "❌ Kamu belum join",
      show_alert: true
    });

  }

  const res = await pool.query(
    "SELECT file_id FROM videos WHERE kode=$1",
    [kode]
  );

  if (res.rows.length === 0) {

    return bot.answerCallbackQuery(query.id, {
      text: "❌ Video tidak ditemukan",
      show_alert: true
    });

  }

  // protect_content: true — video tidak bisa di-forward & disimpan
  await bot.sendVideo(chatId, res.rows[0].file_id, {
    protect_content: true
  });

  bot.answerCallbackQuery(query.id);

});

// ==========================
// START BIASA
// ==========================
bot.onText(/\/start$/, async msg => {

  const admin = await isAdmin(msg.chat.id);

  if (admin) {
    return bot.sendMessage(msg.chat.id,
`📤 Panduan Admin

Upload video → ketik judul → link langsung muncul

📋 Command:
/listvideo — lihat semua video
/hapus_(id) — hapus video, contoh: /hapus_1
/batal — batalkan upload
/listadmin — daftar admin
/addadmin (id) — tambah admin
/removeadmin (id) — hapus admin
/myid — lihat ID kamu`
    );
  }

  const joined = await checkMembership(msg.chat.id);

  if (joined) {
    return bot.sendMessage(msg.chat.id,
      "✅ Kamu sudah join! Klik link video dari channel kami untuk menonton konten.",
      {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "Ke Channel",
                url: `https://t.me/${CHANNEL_USERNAME.replace("@", "")}`
              }
            ]
          ]
        }
      }
    );
  }

  bot.sendMessage(msg.chat.id,
    "👋 Halo! Untuk mendapatkan konten, join channel & grup kami dulu ya!",
    {
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: "Join Channel",
              url: `https://t.me/${CHANNEL_USERNAME.replace("@", "")}`
            }
          ],
          [
            {
              text: "Join Grup",
              url: GROUP_INVITE_LINK
            }
          ]
        ]
      }
    }
  );

});
