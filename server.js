const express = require('express');
const axios = require('axios');
const path = require('path');
const session = require('express-session');
const bcrypt = require('bcrypt');
const rateLimit = require('express-rate-limit');
const { nanoid } = require('nanoid');
const { addLicense, getAllLicenses, updateLicense, deleteLicense, deleteLicenses } = require('./database');

const app = express();

// إضافة معالجة لبيانات النموذج
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// إعدادات الجلسة
app.use(session({
  secret: 'your-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false, // اجعلها true في الإنتاج مع HTTPS
    maxAge: 24 * 60 * 60 * 1000 // يوم واحد
  }
}));

// حماية ضد محاولات تخمين كلمة المرور
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 دقيقة
  max: 5 // 5 محاولات فقط
});

// حماية ضد تجاوز التراخيص
const licenseLimiter = rateLimit({
  windowMs: 60 * 1000, // دقيقة واحدة
  max: 10 // 10 محاولات فقط
});

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));

// بيانات المشرف (في بيئة الإنتاج يجب تخزينها في قاعدة بيانات)
const admin = {
  username: '3rosh',
  // كلمة المرور: admin123
  password: '3rosh123'
};

// التحقق من الجلسة
const requireLogin = (req, res, next) => {
  if (req.session && req.session.isAuthenticated) {
    next();
  } else {
    res.redirect('/login');
  }
};





// صفحة تسجيل الدخول
app.get('/login', (req, res) => {
  if (req.session.isAuthenticated) {
    return res.redirect('/admin');
  }
  res.render('login', { error: null });
});

// معالجة تسجيل الدخول
app.post('/login', (req, res) => {
  const { username, password } = req.body;
  
  // التحقق من بيانات الاعتماد
  if (username === '3rosh' && password === '3rosh123') {
    req.session.isAuthenticated = true;
    req.session.username = username;
    res.redirect('/admin');
  } else {
    res.render('login', { error: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
  }
});

// صفحة لوحة التحكم
app.get('/admin', requireLogin, (req, res) => {
  res.render('admin');
});

// مسار تسجيل الخروج
app.post('/logout', (req, res) => {
  // حذف الكوكيز
  res.clearCookie('session');
  res.clearCookie('user');
  
  // إنهاء الجلسة
  req.session.destroy((err) => {
    if (err) {
      console.error('Error destroying session:', err);
      return res.status(500).json({ error: 'حدث خطأ أثناء تسجيل الخروج' });
    }
    
    // إعادة التوجيه إلى صفحة تسجيل الدخول
    res.redirect('/login');
  });
});

// صفحة الإدارة (محمية)
app.get('/admin', requireLogin, (req, res) => {
  res.render('admin');
});

// جلب التراخيص (محمية)
app.get('/api/licenses', requireLogin, async (req, res) => {
  try {
    const licenses = await getAllLicenses();
    res.json(licenses);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ message: 'حدث خطأ في جلب التراخيص' });
  }
});

// دالة توليد كود الترخيص
function generateLicenseKey() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let key = '';
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      key += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    if (i < 3) key += '-';
  }
  return key;
}

// إنشاء ترخيص جديد (محمية)
app.post('/api/licenses', requireLogin, async (req, res) => {
  try {
    const { type, duration, maxSearches } = req.body;
    
    const license = {
      licenseKey: generateLicenseKey(),
      type,
      status: 'active',
      maxSearches: parseInt(maxSearches),
      searchesLeft: parseInt(maxSearches),
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + duration * 24 * 60 * 60 * 1000).toISOString()
    };

    await addLicense(license);
    res.json(license);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ message: 'حدث خطأ في إنشاء الترخيص' });
  }
});

// API endpoint for license verification and magnet link
app.post('/api/verify-license', async (req, res) => {
    try {
        const { licenseKey } = req.body;
        
        // التحقق من صحة الترخيص
        const licenses = await getAllLicenses();
        const license = licenses.find(l => l.licenseKey === licenseKey);
        
        if (!license) {
            return res.json({ valid: false, message: 'ترخيص غير صالح' });
        }
        
        // التحقق من حالة الترخيص
        if (license.status !== 'active') {
            return res.json({ valid: false, message: 'الترخيص غير نشط' });
        }
        
        // التحقق من تاريخ انتهاء الترخيص
        const now = new Date();
        const expiresAt = new Date(license.expiresAt);
        
        if (now > expiresAt) {
            // تحديث حالة الترخيص إلى منتهي
            await updateLicense(licenseKey, { ...license, status: 'expired' });
            return res.json({ valid: false, message: 'انتهت صلاحية الترخيص' });
        }
        
        // إرجاع معلومات الترخيص مع نوعه ورابط التورنت أو رسالة حسب نوع الترخيص
        const response = {
            valid: true,
            type: license.type,
            message: 'تم التحقق من الترخيص بنجاح',
            magnetLink: license.type === 'basic' 
                ? "magnet:?xt=urn:btih:d136b1adde531f38311fbf43fb96fc26df1a34cd&dn=Fsocity"
                : "عذراً، الترخيص التجريبي لا يسمح بتحميل البيانات"
        };

        return res.json(response);
        
    } catch (error) {
        console.error('License verification error:', error);
        res.status(500).json({ valid: false, message: 'حدث خطأ أثناء التحقق من الترخيص' });
    }
});

// تحديث ترخيص (محمية)
app.put('/api/licenses/:licenseKey', requireLogin, async (req, res) => {
  try {
    const { licenseKey } = req.params;
    const updates = req.body;
    
    // جلب الترخيص الحالي أولاً
    const licenses = await getAllLicenses();
    const currentLicense = licenses.find(l => l.licenseKey === licenseKey);
    
    if (!currentLicense) {
      return res.status(404).json({ message: 'الترخيص غير موجود' });
    }

    // دمج البيانات القديمة مع التحديثات الجديدة
    const updatedLicense = {
      ...currentLicense,
      ...updates,
      searchesLeft: updates.searchesLeft || currentLicense.searchesLeft, // الحفاظ على القيمة القديمة إذا لم يتم تحديثها
      maxSearches: updates.maxSearches || currentLicense.maxSearches
    };

    await updateLicense(licenseKey, updatedLicense);
    res.json({ message: 'تم تحديث الترخيص بنجاح', license: updatedLicense });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ message: 'حدث خطأ في تحديث الترخيص' });
  }
});

// حذف مجموعة من التراخيص (محمية)
app.delete('/api/licenses/batch', requireLogin, async (req, res) => {
  try {
    const { licenseKeys } = req.body;
    
    if (!Array.isArray(licenseKeys) || licenseKeys.length === 0) {
      return res.status(400).json({ message: 'يرجى تحديد التراخيص المراد حذفها' });
    }

    // استخدام الدالة الأكثر كفاءة للحذف المتعدد
    const deletedCount = await deleteLicenses(licenseKeys);
    
    if (deletedCount === 0) {
      return res.status(404).json({ message: 'لم يتم العثور على التراخيص المحددة' });
    }

    res.json({ 
      message: `تم حذف ${deletedCount} ترخيص بنجاح`,
      deletedCount: deletedCount,
      success: true
    });
  } catch (error) {
    console.error('Error deleting licenses:', error);
    res.status(500).json({ 
      message: 'حدث خطأ في حذف التراخيص',
      success: false
    });
  }
});

// حذف ترخيص (محمية)
app.delete('/api/licenses/:licenseKey', requireLogin, async (req, res) => {
  try {
    const { licenseKey } = req.params;
    await deleteLicense(licenseKey);
    res.json({ message: 'تم حذف الترخيص بنجاح', success: true });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ message: 'حدث خطأ في حذف الترخيص', success: false });
  }
});

app.get('/', (req, res) => {
  res.render('index');
});

app.get('/breaches', (req, res) => {
  res.render('breaches');
});

const axiosInstance = axios.create({
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    'Accept': 'application/json',
    'Accept-Language': 'en-US,en;q=0.9',
  }
});


app.get('/api/breaches', async (req, res) => {
  try {
    const response = await axiosInstance.get('https://api.xposedornot.com/v1/breaches');
    res.json(response.data);
  } catch (error) {
    console.error('Breaches API Error:', error.response?.data || error.message);
    res.status(500).json({ 
      error: "حدث خطأ أثناء جلب قواعد البيانات المسربة." 
    });
  }
});

app.get('/search', async (req, res) => {
  const email = req.query.email;
  const deep = req.query.deep === 'true';
  const licenseKey = req.query.licenseKey;

  // التحقق من وجود الترخيص للبحث المتقدم
  if (deep) {
    if (!licenseKey) {
      return res.status(403).json({
        error: "يجب توفير ترخيص صالح للبحث المتقدم"
      });
    }

    try {
      // التحقق من صلاحية الترخيص
      const licenses = await getAllLicenses();
      const license = licenses.find(l => l.licenseKey === licenseKey);

      if (!license) {
        return res.status(403).json({
          error: "الترخيص غير صالح"
        });
      }

      if (license.status !== 'active') {
        return res.status(403).json({
          error: "الترخيص غير نشط"
        });
      }

      if (new Date(license.expiresAt) < new Date()) {
        await updateLicense(licenseKey, { ...license, status: 'expired' });
        return res.status(403).json({
          error: "انتهت صلاحية الترخيص"
        });
      }

      if (license.searchesLeft <= 0) {
        return res.status(403).json({
          error: "تم استنفاد عدد عمليات البحث"
        });
      }

      // تحديث عدد عمليات البحث المتبقية
      await updateLicense(licenseKey, { ...license, searchesLeft: license.searchesLeft - 1 });
    } catch (error) {
      console.error('License verification error:', error);
      return res.status(500).json({
        error: "حدث خطأ أثناء التحقق من الترخيص"
      });
    }
  }

  try {
    const checkRes = await axiosInstance.get(`https://api.xposedornot.com/v1/check-email/${encodeURIComponent(email)}`);
    
    let response = {
      result: checkRes.data
    };

    if (deep && checkRes.data.breaches && checkRes.data.breaches.length > 0) {
      try {
        const analyticsRes = await axiosInstance.get(`https://api.xposedornot.com/v1/breach-analytics?email=${encodeURIComponent(email)}`);
        response.analytics = analyticsRes.data;
      } catch (analyticsError) {
        console.error('Analytics API Error:', analyticsError.response?.data || analyticsError.message);
      }
    }

    res.json(response);
  } catch (error) {
    console.error('API Error:', error.response?.data || error.message);
    res.json({ 
      error: "حدث خطأ أثناء جلب البيانات أو البريد غير موجود." 
    });
  }
});

// صفحة الأسعار
app.get('/pricing', (req, res) => {
  res.render('pricing');
});

// مسار البحث المجاني
app.get('/free-search', async (req, res) => {
  try {
    const { email } = req.query;
    
    if (!email) {
      return res.status(400).json({ error: 'يرجى إدخال بريد إلكتروني' });
    }

    const response = await axiosInstance.get(`https://api.xposedornot.com/v1/check-email/${email}`);
    
    // تحضير الرد مع البريد وعدد التسريبات فقط
    const breachCount = response.data.breaches ? response.data.breaches[0].length : 0;
    res.json({
      email: email,
      breachCount: breachCount
    });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'حدث خطأ أثناء البحث' });
  }
});

app.get('/privacy-policy', (req, res) => {
  res.render('privacy-policy');
});

// Route for download page
app.get('/download', (req, res) => {
    res.render('download');
});

// Protected download route
// app.get('/download/database.zip', async (req, res) => {
//     try {
//         const licenseKey = req.query.license;
        
//         if (!licenseKey) {
//             return res.status(403).json({ error: 'يجب توفير ترخيص صالح للتحميل' });
//         }

//         // Get all licenses
//         const licenses = await getAllLicenses();
//         const license = licenses.find(l => l.licenseKey === licenseKey);
        
//         if (!license) {
//             return res.status(403).json({ error: 'الترخيص غير موجود' });
//         }

//         if (license.status !== 'active') {
//             return res.status(403).json({ error: 'الترخيص غير نشط' });
//         }

//         const now = new Date();
//         const expiresAt = new Date(license.expiresAt);
//         if (now > expiresAt) {
//             await updateLicense(licenseKey, { ...license, status: 'expired' });
//             return res.status(403).json({ error: 'الترخيص منتهي الصلاحية' });
//         }

//         // Send the database file
//         const file = path.join(__dirname, 'database', 'leaked_data.zip');
//         res.download(file);
//     } catch (error) {
//         console.error('Error downloading database:', error);
//         res.status(500).json({ error: 'حدث خطأ أثناء تحميل قاعدة البيانات' });
//     }
// });

// صفحة معلومات الترخيص
app.get('/license-info', (req, res) => {
    res.render('license-info');
});

// نقطة نهاية لجلب معلومات الترخيص
app.post('/api/license-info', async (req, res) => {
    try {
        const { licenseKey } = req.body;
        
        // التحقق من صحة الترخيص
        const licenses = await getAllLicenses();
        const license = licenses.find(l => l.licenseKey === licenseKey);
        
        if (!license) {
            return res.status(404).json({ valid: false, message: 'ترخيص غير صالح' });
        }

        // حساب الأيام المتبقية
        const now = new Date();
        const expiresAt = new Date(license.expiresAt);
        const daysLeft = Math.ceil((expiresAt - now) / (1000 * 60 * 60 * 24));
        
        if (license.status !== 'active') {
            return res.json({ valid: false, message: 'الترخيص غير نشط' });
        }
        
        if (now > expiresAt) {
            // تحديث حالة الترخيص إلى منتهي
            await updateLicense(licenseKey, { ...license, status: 'expired' });
            return res.json({ valid: false, message: 'انتهت صلاحية الترخيص' });
        }

        // إرجاع معلومات الترخيص
        return res.json({
            valid: true,
            type: license.type,
            status: license.status,
            createdAt: license.createdAt,
            expiresAt: license.expiresAt,
            daysLeft: daysLeft,
            searchesLeft: license.searchesLeft,
            maxSearches: license.maxSearches
        });
        
    } catch (error) {
        console.error('License info error:', error);
        res.status(500).json({ valid: false, message: 'حدث خطأ أثناء جلب معلومات الترخيص' });
    }
});

// تشغيل البوت
const { Telegraf } = require('telegraf');
const bot = new Telegraf('8115084797:AAGE7XqJC7mC9wxQNIQJgcPsRYZXThoSS58');

// استيراد دوال البوت
const { handleStart, handleTrial, handleMessage, handleAdmin, handleBroadcast, handleStats, handleUsers, handleLicenses, handleCallbackQuery } = require('./bot');

// تسجيل الأوامر
bot.command('start', (ctx) => handleStart(ctx, bot));
bot.command('trial', handleTrial);
bot.command('admin', handleAdmin);
bot.command('broadcast', handleBroadcast);
bot.command('stats', handleStats);
bot.command('users', handleUsers);
bot.command('licenses', handleLicenses);
bot.on('text', handleMessage);
bot.on('callback_query', (ctx) => handleCallbackQuery(ctx));

// تشغيل البوت
bot.launch()
    .then(() => {
        console.log('✅ تم تشغيل البوت بنجاح');
    })
    .catch((err) => {
        console.error('❌ فشل في تشغيل البوت:', err);
    });

// تشغيل السيرفر
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on:`);
  console.log(`- Local: http://localhost:${PORT}`);
  console.log(`- Network: http://192.168.100.116:${PORT}`);
});

// معالجة إغلاق السيرفر بشكل صحيح
process.on('SIGINT', () => {
    console.log('إغلاق السيرفر...');
    if (server) {
        server.close(() => {
            console.log('تم إغلاق السيرفر');
            process.exit(0);
        });
    } else {
        process.exit(0);
    }
});

process.once('SIGTERM', () => {
    bot.stop('SIGTERM');
    server.close(() => {
        console.log('تم إغلاق السيرفر والبوت');
        process.exit(0);
    });
});