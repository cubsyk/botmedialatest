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
const GROUP_ID = -1004337666009;

// LINK INVITE GRUP
const GROUP_INVITE_LINK = "https://t.me/+YbuW46Lf8zg3ZGFl";

// ==========================
// STATE — menyimpan media sementara
// pendingUploads[chatId] = { items: [{file_id, type, message_id}], timer }
// ==========================
const pendingUploads = {};

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

  // TABEL BARU: isi media per link (foto / video, bisa banyak)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS media_items (
      id SERIAL PRIMARY KEY,
      video_id INTEGER REFERENCES videos(id) ON DELETE CASCADE,
      file_id TEXT NOT NULL,
      type TEXT NOT NULL,
      urutan INTEGER DEFAULT 0
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
// KIRIM SEMUA MEDIA UNTUK 1 KODE
// return true kalau ketemu, false kalau tidak
// ==========================
async function sendContent(chatId, kode) {

  const post = await pool.query(
    "SELECT id, file_id FROM videos WHERE kode=$1",
    [kode]
  );

  if (post.rows.length === 0) return false;

  const row = post.rows[0];

  const mediaRes = await pool.query(
    "SELECT file_id, type FROM media_items WHERE video_id=$1 ORDER BY urutan ASC, id ASC",
    [row.id]
  );

  let items = mediaRes.rows;

  // Kompatibel dengan link lama (video tunggal di kolom videos.file_id)
  if (items.length === 0 && row.file_id) {
    items = [{ file_id: row.file_id, type: "video" }];
  }

  if (items.length === 0) return false;

  // Telegram: sendMediaGroup maksimal 10 item per kirim, minimal 2
  for (let i = 0; i < items.length; i += 10) {

    const chunk = items.slice(i, i + 10);

    if (chunk.length === 1) {

      const m = chunk[0];

      if (m.type === "photo")
        await bot.sendPhoto(chatId, m.file_id, { protect_content: true });
      else
        await bot.sendVideo(chatId, m.file_id, { protect_content: true });

    } else {

      await bot.sendMediaGroup(
        chatId,
        chunk.map(m => ({ type: m.type, media: m.file_id })),
        { protect_content: true }
      );

    }

  }

  return true;

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

  const res = await pool.query(`
    SELECT v.id, v.judul, v.kode,
           COUNT(m.id) AS jumlah
    FROM videos v
    LEFT JOIN media_items m ON m.video_id = v.id
    GROUP BY v.id
    ORDER BY v.created_at DESC
  `);

  if (res.rows.length === 0)
    return bot.sendMessage(msg.chat.id, "📭 Belum ada konten.");

  let text = "📋 Daftar Konten\n\n";

  res.rows.forEach((r, i) => {
    const jumlah = parseInt(r.jumlah) || 1; // link lama = 1 video
    text += `${i + 1}. ${r.judul} (${r.id}) — ${jumlah} media\n`;
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
    return bot.sendMessage(msg.chat.id, "❌ Konten tidak ditemukan.");

  const judul = res.rows[0].judul;

  // media_items ikut terhapus otomatis (ON DELETE CASCADE)
  await pool.query("DELETE FROM videos WHERE id=$1", [id]);

  bot.sendMessage(msg.chat.id, `✅ Konten "${judul}" berhasil dihapus.`);

});

// ==========================
// BATAL UPLOAD
// ==========================
bot.onText(/\/batal/, async msg => {

  const admin = await isAdmin(msg.chat.id);
  if (!admin) return;

  const state = pendingUploads[msg.chat.id];

  if (!state)
    return bot.sendMessage(msg.chat.id, "⚠️ Tidak ada proses upload yang aktif.");

  clearTimeout(state.timer);
  delete pendingUploads[msg.chat.id];

  bot.sendMessage(msg.chat.id, "✅ Upload dibatalkan.");

});

// ==========================
// ADMIN UPLOAD MEDIA (FOTO / VIDEO, BOLEH BANYAK / ALBUM)
// ==========================
bot.on("message", async msg => {

  const isPhoto = Array.isArray(msg.photo) && msg.photo.length > 0;
  const isVideo = !!msg.video;

  if (!isPhoto && !isVideo) return;

  const chatId = msg.chat.id;

  const admin = await isAdmin(chatId);
  if (!admin) return;

  if (!pendingUploads[chatId])
    pendingUploads[chatId] = { items: [], timer: null };

  const state = pendingUploads[chatId];

  if (isPhoto) {
    // msg.photo berisi beberapa ukuran, ambil yang terbesar (terakhir)
    state.items.push({
      file_id: msg.photo[msg.photo.length - 1].file_id,
      type: "photo",
      message_id: msg.message_id
    });
  } else {
    state.items.push({
      file_id: msg.video.file_id,
      type: "video",
      message_id: msg.message_id
    });
  }

  // Tunggu sebentar supaya semua media dari album sudah masuk,
  // baru kirim 1 pesan konfirmasi
  clearTimeout(state.timer);

  state.timer = setTimeout(() => {

    if (!pendingUploads[chatId]) return;

    const total = state.items.length;
    const foto = state.items.filter(i => i.type === "photo").length;
    const video = total - foto;

    bot.sendMessage(chatId,
`📥 ${total} media diterima (${foto} foto, ${video} video)

➕ Kirim media lagi kalau mau ditambah
📝 Atau ketik judul untuk menyelesaikan & membuat link

(ketik /batal untuk membatalkan)`
    );

  }, 1500);

});

// ==========================
// TERIMA JUDUL DARI ADMIN
// ==========================
bot.on("message", async msg => {

  const chatId = msg.chat.id;

  const state = pendingUploads[chatId];

  if (!state || state.items.length === 0) return;
  if (!msg.text) return;
  if (msg.text.startsWith("/")) return;

  const admin = await isAdmin(chatId);
  if (!admin) return;

  const judul = msg.text.trim();
  const kode = generateCode();

  // urutkan sesuai urutan kirim
  const items = [...state.items].sort((a, b) => a.message_id - b.message_id);

  clearTimeout(state.timer);
  delete pendingUploads[chatId];

  const ins = await pool.query(
    "INSERT INTO videos (kode, judul) VALUES ($1, $2) RETURNING id",
    [kode, judul]
  );

  const videoId = ins.rows[0].id;

  for (let i = 0; i < items.length; i++) {
    await pool.query(
      "INSERT INTO media_items (video_id, file_id, type, urutan) VALUES ($1, $2, $3, $4)",
      [videoId, items[i].file_id, items[i].type, i]
    );
  }

  const link = `https://t.me/${botUsername}?start=${kode}`;

  const template = `${judul}

${link}

MAU LANGSUNG NONTON TANPA RIBET? 10.000+ KONTEN ONLY 50K UPDATE 24/7
pc @mieayampangsit18
testi @testivipseductease`;

  bot.sendMessage(chatId, template);

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

  try {
    const ok = await sendContent(chatId, kode);
    if (!ok) bot.sendMessage(chatId, "❌ Konten tidak ditemukan");
  } catch (err) {
    console.error("sendContent error:", err.message);
    bot.sendMessage(chatId, "⚠️ Gagal mengirim konten, coba lagi nanti.");
  }

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

  try {

    const ok = await sendContent(chatId, kode);

    if (!ok) {
      return bot.answerCallbackQuery(query.id, {
        text: "❌ Konten tidak ditemukan",
        show_alert: true
      });
    }

  } catch (err) {
    console.error("sendContent error:", err.message);
    return bot.answerCallbackQuery(query.id, {
      text: "⚠️ Gagal mengirim konten",
      show_alert: true
    });
  }

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

Kirim foto/video (boleh banyak sekaligus) → ketik judul → link langsung muncul

📋 Command:
/listvideo — lihat semua konten
/hapus_(id) — hapus konten, contoh: /hapus_1
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
      "✅ Kamu sudah join! Klik link dari channel kami untuk menonton konten.",
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
