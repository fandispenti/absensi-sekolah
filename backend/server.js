import express from 'express';
import cors from 'cors';
import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Initialize Database
let db;
async function initDb() {
  const dbPath = path.join(__dirname, 'database.sqlite');
  db = await open({
    filename: dbPath,
    driver: sqlite3.Database
  });

  // Enable foreign keys
  await db.run('PRAGMA foreign_keys = ON');

  // Create tables
  await db.exec(`
    CREATE TABLE IF NOT EXISTS siswa (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nama TEXT NOT NULL,
      nisn TEXT UNIQUE NOT NULL,
      kelas TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS absensi (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      siswa_id INTEGER NOT NULL,
      tanggal TEXT NOT NULL, -- Format: YYYY-MM-DD
      status TEXT CHECK(status IN ('hadir', 'sakit', 'izin', 'alpha')) NOT NULL,
      keterangan TEXT,
      FOREIGN KEY(siswa_id) REFERENCES siswa(id) ON DELETE CASCADE,
      UNIQUE(siswa_id, tanggal) -- One attendance record per student per day
    );

    CREATE TABLE IF NOT EXISTS terlambat (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      siswa_id INTEGER NOT NULL,
      tanggal TEXT NOT NULL, -- Format: YYYY-MM-DD
      jam TEXT NOT NULL,     -- Format: HH:MM
      keterangan TEXT,
      FOREIGN KEY(siswa_id) REFERENCES siswa(id) ON DELETE CASCADE
    );
  `);

  console.log(`Database initialized at ${dbPath}`);
}

// Routes

// 1. Get all students (optionally filter by class)
app.get('/api/siswa', async (req, res) => {
  try {
    const { kelas } = req.query;
    let query = 'SELECT * FROM siswa ORDER BY kelas ASC, nama ASC';
    const params = [];
    if (kelas) {
      query = 'SELECT * FROM siswa WHERE kelas = ? ORDER BY nama ASC';
      params.push(kelas);
    }
    const data = await db.all(query, params);
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get list of all unique classes
app.get('/api/kelas', async (req, res) => {
  try {
    const data = await db.all('SELECT DISTINCT kelas FROM siswa ORDER BY kelas ASC');
    res.json(data.map(item => item.kelas));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 2. Import students from Excel data
app.post('/api/siswa/import', async (req, res) => {
  const students = req.body; // Array of { nama, nisn, kelas }
  if (!Array.isArray(students)) {
    return res.status(400).json({ error: 'Data harus berupa array' });
  }

  try {
    await db.run('BEGIN TRANSACTION');
    const stmt = await db.prepare(
      'INSERT OR REPLACE INTO siswa (nama, nisn, kelas) VALUES (?, ?, ?)'
    );

    for (const student of students) {
      const { nama, nisn, kelas } = student;
      if (!nama || !nisn || !kelas) {
        throw new Error('Semua field (nama, nisn, kelas) wajib diisi');
      }
      await stmt.run(nama.toString().trim(), nisn.toString().trim(), kelas.toString().trim());
    }

    await stmt.finalize();
    await db.run('COMMIT');

    res.json({ success: true, message: `${students.length} data siswa berhasil diimpor` });
  } catch (error) {
    await db.run('ROLLBACK');
    res.status(500).json({ error: error.message });
  }
});

// 3. Get attendance records (with filters)
app.get('/api/absensi', async (req, res) => {
  try {
    const { tanggal, kelas, bulan, tahun } = req.query;
    let query = `
      SELECT a.id, a.tanggal, a.status, a.keterangan, a.siswa_id, s.nama, s.kelas, s.nisn 
      FROM absensi a
      JOIN siswa s ON a.siswa_id = s.id
      WHERE 1=1
    `;
    const params = [];

    if (tanggal) {
      query += ' AND a.tanggal = ?';
      params.push(tanggal);
    }
    if (kelas) {
      query += ' AND s.kelas = ?';
      params.push(kelas);
    }
    if (bulan && tahun) {
      // Format tanggal: YYYY-MM-DD. Kita filter menggunakan strftime atau substring
      query += ' AND a.tanggal LIKE ?';
      params.push(`${tahun}-${bulan.padStart(2, '0')}-%`);
    }

    query += ' ORDER BY a.tanggal DESC, s.kelas ASC, s.nama ASC';
    const data = await db.all(query, params);
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 4. Save/update attendance records
app.post('/api/absensi', async (req, res) => {
  const records = req.body; // Array of { siswa_id, tanggal, status, keterangan }
  if (!Array.isArray(records)) {
    return res.status(400).json({ error: 'Data harus berupa array' });
  }

  try {
    await db.run('BEGIN TRANSACTION');
    const stmt = await db.prepare(`
      INSERT INTO absensi (siswa_id, tanggal, status, keterangan)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(siswa_id, tanggal) DO UPDATE SET
        status = excluded.status,
        keterangan = excluded.keterangan
    `);

    for (const record of records) {
      const { siswa_id, tanggal, status, keterangan } = record;
      if (!siswa_id || !tanggal || !status) {
        throw new Error('siswa_id, tanggal, dan status wajib diisi');
      }
      await stmt.run(siswa_id, tanggal, status, keterangan || '');
    }

    await stmt.finalize();
    await db.run('COMMIT');

    res.json({ success: true, message: `${records.length} data absensi berhasil disimpan` });
  } catch (error) {
    await db.run('ROLLBACK');
    res.status(500).json({ error: error.message });
  }
});

// 5. Get late students records
app.get('/api/terlambat', async (req, res) => {
  try {
    const { tanggal, kelas, bulan, tahun } = req.query;
    let query = `
      SELECT t.id, t.tanggal, t.jam, t.keterangan, t.siswa_id, s.nama, s.kelas, s.nisn 
      FROM terlambat t
      JOIN siswa s ON t.siswa_id = s.id
      WHERE 1=1
    `;
    const params = [];

    if (tanggal) {
      query += ' AND t.tanggal = ?';
      params.push(tanggal);
    }
    if (kelas) {
      query += ' AND s.kelas = ?';
      params.push(kelas);
    }
    if (bulan && tahun) {
      query += ' AND t.tanggal LIKE ?';
      params.push(`${tahun}-${bulan.padStart(2, '0')}-%`);
    }

    query += ' ORDER BY t.tanggal DESC, t.jam DESC, s.nama ASC';
    const data = await db.all(query, params);
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 6. Save a late record
app.post('/api/terlambat', async (req, res) => {
  const { siswa_id, tanggal, jam, keterangan } = req.body;
  if (!siswa_id || !tanggal || !jam) {
    return res.status(400).json({ error: 'siswa_id, tanggal, dan jam wajib diisi' });
  }

  try {
    const result = await db.run(
      'INSERT INTO terlambat (siswa_id, tanggal, jam, keterangan) VALUES (?, ?, ?, ?)',
      [siswa_id, tanggal, jam, keterangan || '']
    );
    res.json({ success: true, id: result.lastID, message: 'Data keterlambatan berhasil dicatat' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete a late record
app.delete('/api/terlambat/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await db.run('DELETE FROM terlambat WHERE id = ?', [id]);
    res.json({ success: true, message: 'Data keterlambatan berhasil dihapus' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 7. Get recap dashboard data (general summary & today stats)
app.get('/api/dashboard-stats', async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    
    // Total students
    const { totalSiswa } = await db.get('SELECT COUNT(*) as totalSiswa FROM siswa');
    
    // Today's attendance stats
    const attendanceStats = await db.all(`
      SELECT status, COUNT(*) as count 
      FROM absensi 
      WHERE tanggal = ? 
      GROUP BY status
    `, [today]);
    
    const todayAbsensi = {
      hadir: 0,
      sakit: 0,
      izin: 0,
      alpha: 0
    };
    attendanceStats.forEach(item => {
      todayAbsensi[item.status] = item.count;
    });
    
    // Today's late students
    const { totalTerlambatHariIni } = await db.get(
      'SELECT COUNT(*) as totalTerlambatHariIni FROM terlambat WHERE tanggal = ?',
      [today]
    );

    // Monthly attendance summary (last 6 months) for charts
    const monthlySummary = await db.all(`
      SELECT 
        strftime('%Y-%m', tanggal) as bulan,
        SUM(case when status = 'hadir' then 1 else 0 end) as hadir,
        SUM(case when status = 'sakit' then 1 else 0 end) as sakit,
        SUM(case when status = 'izin' then 1 else 0 end) as izin,
        SUM(case when status = 'alpha' then 1 else 0 end) as alpha
      FROM absensi
      GROUP BY bulan
      ORDER BY bulan DESC
      LIMIT 6
    `);

    // Monthly late summary (last 6 months)
    const monthlyLateSummary = await db.all(`
      SELECT 
        strftime('%Y-%m', tanggal) as bulan,
        COUNT(*) as jumlah_terlambat
      FROM terlambat
      GROUP BY bulan
      ORDER BY bulan DESC
      LIMIT 6
    `);

    // Top late students this month
    const currentMonth = today.substring(0, 7); // YYYY-MM
    const topLateStudents = await db.all(`
      SELECT s.nama, s.kelas, COUNT(t.id) as frekuensi
      FROM terlambat t
      JOIN siswa s ON t.siswa_id = s.id
      WHERE t.tanggal LIKE ?
      GROUP BY t.siswa_id
      ORDER BY frekuensi DESC
      LIMIT 5
    `, [`${currentMonth}-%`]);

    res.json({
      totalSiswa: totalSiswa || 0,
      todayAbsensi,
      totalTerlambatHariIni: totalTerlambatHariIni || 0,
      monthlySummary: monthlySummary.reverse(),
      monthlyLateSummary: monthlyLateSummary.reverse(),
      topLateStudents
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Start server after connecting to database
initDb().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running on port ${PORT}`);
  });
}).catch(err => {
  console.error('Failed to connect to database', err);
});
