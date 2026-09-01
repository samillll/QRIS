const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');
const multer = require('multer');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// ===== MIDDLEWARE =====
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// ===== MULTER (Upload Bukti) =====
const storage = multer.diskStorage({
    destination: './uploads/',
    filename: (req, file, cb) => {
        cb(null, Date.now() + '-' + file.originalname);
    }
});
const upload = multer({ storage });

// ===== DATABASE =====
const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'qris_merchant',
    waitForConnections: true,
    connectionLimit: 10,
});

// ============================================================
// API ROUTES
// ============================================================

// ---------- GET SALDO ----------
app.get('/api/saldo', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT saldo FROM users WHERE id = 1');
        res.json({ saldo: rows[0]?.saldo || 0 });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ---------- GET RIWAYAT ----------
app.get('/api/riwayat', async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT id, nominal, keterangan, type, status, created_at as date 
             FROM transactions 
             ORDER BY created_at DESC 
             LIMIT 50`
        );
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ---------- KONFIRMASI TRANSFER ----------
app.post('/api/konfirmasi', upload.single('bukti'), async (req, res) => {
    const { nominal } = req.body;
    const file = req.file;

    if (!nominal || nominal < 1000) {
        return res.status(400).json({ error: 'Nominal minimal Rp 1.000' });
    }
    if (!file) {
        return res.status(400).json({ error: 'Bukti transfer harus diupload' });
    }

    try {
        // Tambah saldo
        await pool.query('UPDATE users SET saldo = saldo + ? WHERE id = 1', [parseInt(nominal)]);

        // Catat transaksi
        await pool.query(
            `INSERT INTO transactions (nominal, keterangan, type, status, bukti_path) 
             VALUES (?, ?, ?, ?, ?)`,
            [parseInt(nominal), 'Topup QRIS', 'Masuk', 'success', file.path]
        );

        // Ambil data terbaru
        const [saldoRows] = await pool.query('SELECT saldo FROM users WHERE id = 1');
        const [riwayatRows] = await pool.query(
            `SELECT id, nominal, keterangan, type, status, created_at as date 
             FROM transactions 
             ORDER BY created_at DESC 
             LIMIT 50`
        );

        res.json({
            success: true,
            saldo: saldoRows[0]?.saldo || 0,
            riwayat: riwayatRows
        });

    } catch (err) {
        console.error('Error konfirmasi:', err);
        res.status(500).json({ error: err.message });
    }
});

// ---------- WITHDRAW ----------
app.post('/api/withdraw', async (req, res) => {
    const { amount, account } = req.body;

    if (!amount || amount < 5000) {
        return res.status(400).json({ error: 'Minimal penarikan Rp 5.000' });
    }
    if (!account) {
        return res.status(400).json({ error: 'Nomor rekening harus diisi' });
    }

    try {
        const [rows] = await pool.query('SELECT saldo FROM users WHERE id = 1');
        const currentSaldo = rows[0]?.saldo || 0;

        if (currentSaldo < amount) {
            return res.status(400).json({ error: 'Saldo tidak cukup' });
        }

        await pool.query('UPDATE users SET saldo = saldo - ? WHERE id = 1', [amount]);
        await pool.query(
            `INSERT INTO transactions (nominal, keterangan, type, status) 
             VALUES (?, ?, ?, ?)`,
            [amount, `Penarikan ke ${account}`, 'Keluar', 'success']
        );

        const [saldoRows] = await pool.query('SELECT saldo FROM users WHERE id = 1');
        const [riwayatRows] = await pool.query(
            `SELECT id, nominal, keterangan, type, status, created_at as date 
             FROM transactions 
             ORDER BY created_at DESC 
             LIMIT 50`
        );

        res.json({
            success: true,
            message: `Penarikan Rp ${amount.toLocaleString('id-ID')} ke ${account} berhasil`,
            saldo: saldoRows[0]?.saldo || 0,
            riwayat: riwayatRows
        });

    } catch (err) {
        console.error('Error withdraw:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// START SERVER
// ============================================================
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 QRIS Merchant Server running on http://localhost:${PORT}`);
    console.log(`📡 Mode: ${process.env.NODE_ENV || 'development'}`);
});
