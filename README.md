# 🤖 Telegram Bot EBIS Telkom (`t.me/EbisTelkomBot`)

Bot Telegram interaktif yang terhubung langsung secara real-time ke **Firebase Firestore** aplikasi web [EBIS Teknisi](https://github.com/ReihanMutaqin/ebis.git).

---

## ⚡ Fitur Utama

- 🔍 **Cek Work Order Real-Time**: Cari order berdasarkan Nomor Order, No. Internet, atau Nama Pelanggan.
- 📊 **Rekapitulasi Status**: Statistik jumlah order (Pending, On Progress, Completed, Kendala, Cancel).
- 🚀 **Update Status Instan**: Mengubah status order & menetapkan nama teknisi langsung melalui tombol interaktif di Telegram.
- ⏳ **Filter Task Pending & Kendala**: Menampilkan daftar order yang butuh penanganan cepat.
- 👨‍🔧 **Pencarian Per Teknisi**: Cek daftar pekerjaan yang ditugaskan ke teknisi tertentu.

---

## 🚀 Jalankan di Lokal (Pengujian)

1. Pastikan Node.js sudah terinstall di komputer.
2. Buka terminal di folder `c:\PROJEK\Tele Bot`.
3. Install dependencies:
   ```bash
   npm install
   ```
4. Jalankan bot:
   ```bash
   npm start
   ```
5. Buka Telegram dan kirim pesan `/start` ke [@EbisTelkomBot](https://t.me/EbisTelkomBot).

---

## 🌐 Cara Membuat Bot Online 24 Jam GRATIS

### Opsi A: Deploy ke Vercel (100% Gratis & Serverless 24/7)

1. Install **Vercel CLI** atau hubungkan repository GitHub kamu ke Vercel:
   ```bash
   npm install -g vercel
   vercel
   ```
2. Tambahkan Environment Variable di Dashboard Vercel:
   - `TELEGRAM_BOT_TOKEN`: `8844898337:AAHMHLyzLcUN6Znnh7ToNJzQdxdYaAsnzPs`
   - `VITE_FIREBASE_API_KEY`: `AIzaSyAP5atKFrnU6BrCRxD62taBUIsU23ryLJw`
   - `VITE_FIREBASE_PROJECT_ID`: `ebisteknisi`
   - `VITE_FIREBASE_DATABASE_URL`: `https://ebisteknisi-default-rtdb.asia-southeast1.firebasedatabase.app`
   - `VITE_FIREBASE_AUTH_DOMAIN`: `ebisteknisi.firebaseapp.com`
   - `VITE_FIREBASE_STORAGE_BUCKET`: `ebisteknisi.firebasestorage.app`
   - `VITE_FIREBASE_MESSAGING_SENDER_ID`: `1034060411734`
   - `VITE_FIREBASE_APP_ID`: `1:1034060411734:web:2080bc85c1a21732ba5cf7`
3. Setelah deploy selesai dan kamu mendapatkan URL (misal: `https://ebis-bot.vercel.app`), aktifkan Webhook Telegram dengan menjalankan command:
   ```bash
   node set_webhook.js https://ebis-bot.vercel.app
   ```
4. Bot akan **aktif 24 jam nonstop gratis** tanpa perlu laptop dinyalakan!

---

### Opsi B: Deploy ke Render / Railway / Glitch (Gratis)

1. Upload folder bot ini ke GitHub.
2. Buat Web Service baru di Render / Railway.
3. Masukkan Environment Variables yang sama dari file `.env`.
4. Render/Railway akan menguji server dan bot siap beroperasi 24/7.
