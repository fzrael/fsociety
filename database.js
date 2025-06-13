const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// إنشاء اتصال بقاعدة البيانات
const db = new sqlite3.Database(path.join(__dirname, 'licenses.db'), (err) => {
  if (err) {
    console.error('خطأ في الاتصال بقاعدة البيانات:', err);
  } else {
    console.log('- 🟢 Database online ');
    // إنشاء جدول التراخيص إذا لم يكن موجوداً
    db.run(`CREATE TABLE IF NOT EXISTS licenses (
      licenseKey TEXT PRIMARY KEY,
      type TEXT NOT NULL CHECK(type IN ('basic', 'trial')),
      status TEXT NOT NULL,
      maxSearches INTEGER NOT NULL,
      searchesLeft INTEGER NOT NULL,
      createdAt TEXT NOT NULL,
      expiresAt TEXT NOT NULL
    )`);
  }
});

// دالة لإضافة ترخيص جديد
function addLicense(license) {
  return new Promise((resolve, reject) => {
    const stmt = db.prepare(`
      INSERT INTO licenses (licenseKey, type, status, maxSearches, searchesLeft, createdAt, expiresAt)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run(
      license.licenseKey,
      license.type,
      license.status,
      license.maxSearches,
      license.maxSearches,
      license.createdAt,
      license.expiresAt,
      (err) => {
        if (err) reject(err);
        else resolve();
      }
    );
    
    stmt.finalize();
  });
}

// دالة لجلب جميع التراخيص
function getAllLicenses() {
  return new Promise((resolve, reject) => {
    db.all('SELECT * FROM licenses', [], (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

// دالة لتحديث ترخيص
const updateLicense = async (licenseKey, updates) => {
  return new Promise((resolve, reject) => {
    const { type, status, maxSearches, searchesLeft } = updates;
    
    db.run(
      `UPDATE licenses 
       SET type = ?, status = ?, maxSearches = ?, searchesLeft = ?
       WHERE licenseKey = ?`,
      [type, status, maxSearches, searchesLeft, licenseKey],
      function(err) {
        if (err) {
          console.error('Error updating license:', err);
          reject(err);
        } else {
          resolve(this.changes);
        }
      }
    );
  });
};

// دالة لحذف ترخيص
function deleteLicense(licenseKey) {
  return new Promise((resolve, reject) => {
    db.run('DELETE FROM licenses WHERE licenseKey = ?', [licenseKey], (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

// دالة لحذف مجموعة من التراخيص
function deleteLicenses(licenseKeys) {
  return new Promise((resolve, reject) => {
    const placeholders = licenseKeys.map(() => '?').join(',');
    const query = `DELETE FROM licenses WHERE licenseKey IN (${placeholders})`;
    
    db.run(query, licenseKeys, function(err) {
      if (err) {
        console.error('Error deleting licenses:', err);
        reject(err);
      } else {
        resolve(this.changes); // returns number of rows deleted
      }
    });
  });
}

module.exports = {
  db,
  addLicense,
  getAllLicenses,
  updateLicense,
  deleteLicense,
  deleteLicenses
}; 