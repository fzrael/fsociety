const sqlite3 = require('sqlite3').verbose();
const crypto = require('crypto');
const db = new sqlite3.Database('./licenses.db');
const axios = require('axios');

// إعدادات المشرف
const ADMIN_ID = '1660083954'; // معرفك في تليجرام

// متغيرات لتتبع المستخدمين والتراخيص
let usedTrialUsers = new Set();
let activeLicenses = 0;
let userStates = {};

// التحقق من صلاحيات المشرف
function isAdmin(userId) {
    console.log('User ID:', userId);
    console.log('Admin ID:', ADMIN_ID);
    console.log('Is Admin:', userId.toString() === ADMIN_ID);
    return userId.toString() === ADMIN_ID;
}

// إنشاء جدول للرسائل الجماعية
db.run(`
    CREATE TABLE IF NOT EXISTS broadcasts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        message TEXT,
        sentAt TEXT,
        sentBy TEXT,
        status TEXT
    )
`);

// إنشاء جدول لتتبع المستخدمين الذين استخدموا الترخيص التجريبي
db.run(`
    CREATE TABLE IF NOT EXISTS trial_users (
        userId TEXT PRIMARY KEY,
        usedAt TEXT
    )
`);

// دالة للتحقق مما إذا كان المستخدم قد استخدم الترخيص التجريبي من قبل
function hasUserUsedTrial(userId) {
    return new Promise((resolve, reject) => {
        db.get('SELECT userId FROM trial_users WHERE userId = ?', [userId], (err, row) => {
            if (err) reject(err);
            else resolve(!!row);
        });
    });
}

// دالة لتسجيل استخدام المستخدم للترخيص التجريبي
function markUserAsUsedTrial(userId) {
    return new Promise((resolve, reject) => {
        const now = new Date().toISOString();
        db.run('INSERT INTO trial_users (userId, usedAt) VALUES (?, ?)', [userId, now], (err) => {
            if (err) reject(err);
            else resolve();
        });
    });
}

// دالة لإنشاء مفتاح ترخيص فريد
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

// دالة لإضافة ترخيص إلى قاعدة البيانات
function addLicenseToDatabase(licenseKey, userId) {
    return new Promise((resolve, reject) => {
        const now = new Date();
        const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24 ساعة

        const stmt = db.prepare(`
            INSERT INTO licenses (licenseKey, type, status, maxSearches, searchesLeft, createdAt, expiresAt)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        
        stmt.run(
            [licenseKey, 'trial', 'active', 1, 1, now.toISOString(), expiresAt.toISOString()],
            function(err) {
                if (err) reject(err);
                else resolve();
            }
        );
        stmt.finalize();
    });
}

// دالة للتحقق من الترخيص في قاعدة البيانات
function getLicenseFromDatabase(licenseKey) {
    return new Promise((resolve, reject) => {
        db.get('SELECT * FROM licenses WHERE licenseKey = ? AND status = "active"', [licenseKey], (err, row) => {
            if (err) {
                reject(err);
            } else {
                resolve(row);
            }
        });
    });
}

// معالجة أمر /start
async function handleStart(ctx) {
    try {
        // إرسال الصورة أولاً
        await ctx.replyWithPhoto(
            'https://miro.medium.com/v2/resize:fit:1400/1*NMS4XHEpdGdcR2Fs6IaK9g.png',
            {
                caption: `
🌟 مرحباً بك في بوت fsociety 🌟

🔐 نحن نقدم خدمة التراخيص الموثوقة والآمنة

✨ مميزات البوت:
• تراخيص تجريبية مجانية
• دعم فني على مدار الساعة
• واجهة سهلة الاستخدام
• تحديثات مستمرة

📌 للبدء، اضغط على زر "بدء الاستخدام" أدناه
                `,
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🚀 بدء الاستخدام', callback_data: 'show_main_menu' }]
                    ]
                }
            }
        );
    } catch (error) {
        console.error('Error sending welcome message:', error);
        // إذا فشل إرسال الصورة، سنرسل رسالة نصية فقط
        const startKeyboard = {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🚀 بدء الاستخدام', callback_data: 'show_main_menu' }]
                ]
            }
        };

        await ctx.reply(`
🌟 مرحباً بك في بوت fsociety 🌟

🔐 نحن نقدم خدمة التراخيص الموثوقة والآمنة

✨ مميزات البوت:
• تراخيص تجريبية مجانية
• دعم فني على مدار الساعة
• واجهة سهلة الاستخدام
• تحديثات مستمرة

📌 للبدء، اضغط على زر "بدء الاستخدام" أدناه
        `, startKeyboard);
    }
}

// معالجة الرسائل
async function handleMessage(ctx) {
    const text = ctx.message.text;
    const userId = ctx.from.id;
    
    if (text === '🎁 ترخيص تجريبي') {
        await handleTrial(ctx);
    } else if (text === 'ℹ️ معلومات') {
        // إنشاء لوحة المفاتيح للمعلومات
        const infoKeyboard = {
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '📝 دليل الاستخدام', callback_data: 'help_guide' },
                        { text: '❓ الأسئلة الشائعة', callback_data: 'help_faq' }
                    ],
                    [
                        { text: '📞 الدعم الفني', callback_data: 'help_support' },
                        { text: '📢 قناتنا', url: 'https://t.me/your_channel' }
                    ],
                    [
                        { text: '🔒 الخصوصية', callback_data: 'help_privacy' },
                        { text: '📜 الشروط والأحكام', callback_data: 'help_terms' }
                    ]
                ]
            }
        };
        
        ctx.reply('اختر من القائمة أدناه:', infoKeyboard);
    } else if (text === '⚙️ إعدادات') {
        // إنشاء لوحة المفاتيح للإعدادات
        const settingsKeyboard = {
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '🔔 الإشعارات', callback_data: 'settings_notifications' },
                        { text: '🌐 اللغة', callback_data: 'settings_language' }
                    ],
                    [
                        { text: '📊 إحصائياتي', callback_data: 'settings_stats' }
                    ]
                ]
            }
        };
        
        ctx.reply('اختر من القائمة أدناه:', settingsKeyboard);
    }
}

// معالجة أمر /trial
async function handleTrial(ctx) {
    const userId = ctx.from.id;
    const username = ctx.from.username || ctx.from.first_name;
    
    try {
        // التحقق مما إذا كان المستخدم قد استخدم الترخيص التجريبي من قبل
        const hasUsed = await hasUserUsedTrial(userId);
        if (hasUsed) {
            ctx.reply(`عذراً ${username}، لقد استخدمت الترخيص التجريبي من قبل. يمكنك شراء ترخيص كامل من الموقع.`);
            return;
        }

        // إنشاء ترخيص جديد
        const licenseKey = generateLicenseKey();
        
        // إضافة الترخيص إلى قاعدة البيانات
        await addLicenseToDatabase(licenseKey, userId);
        
        // تسجيل استخدام المستخدم للترخيص التجريبي
        await markUserAsUsedTrial(userId);
        
        // إرسال رسالة النجاح مع تفاصيل الترخيص
        const successMessage = `
🎉 تهانينا ${username}!

تم إنشاء ترخيصك التجريبي بنجاح:

🔑 مفتاح الترخيص: \`${licenseKey}\`
⏳ مدة الصلاحية: 24 ساعة
🔍 عدد عمليات البحث: 1

يمكنك استخدام هذا الترخيص في الموقع:
https://fsociety.com/license-info
        `;
        ctx.reply(successMessage, { parse_mode: 'Markdown' });
    } catch (err) {
        console.error('خطأ في إنشاء الترخيص:', err);
        ctx.reply(`عذراً ${username}، حدث خطأ أثناء إنشاء الترخيص. يرجى المحاولة مرة أخرى لاحقاً.`);
    }
}

// معالجة أمر /admin
function handleAdmin(ctx) {
    const userId = ctx.from.id;
    
    if (!isAdmin(userId)) {
        ctx.reply('عذراً، هذا الأمر متاح فقط للمشرف.');
        return;
    }

    // جلب الإحصائيات من قاعدة البيانات
    db.all('SELECT COUNT(*) as count FROM trial_users', [], (err, rows) => {
        if (err) {
            console.error('خطأ في جلب الإحصائيات:', err);
            ctx.reply('حدث خطأ أثناء جلب الإحصائيات.');
            return;
        }

        const totalUsers = rows[0].count;

        db.all('SELECT COUNT(*) as count FROM licenses WHERE status = "active"', [], (err, rows) => {
            if (err) {
                console.error('خطأ في جلب التراخيص:', err);
                ctx.reply('حدث خطأ أثناء جلب الإحصائيات.');
                return;
            }

            const activeLicenses = rows[0].count;

            const adminMessage = `
👨‍💼 لوحة تحكم المشرف

📊 الإحصائيات السريعة:
- عدد المستخدمين: ${totalUsers}
- التراخيص النشطة: ${activeLicenses}

⚡️ الأوامر المتاحة:
/broadcast - إرسال إشعار جماعي
/stats - عرض إحصائيات مفصلة
/users - إدارة المستخدمين
/licenses - إدارة التراخيص
    `;

            ctx.reply(adminMessage);
        });
    });
}

// معالجة أمر /broadcast
async function handleBroadcast(ctx) {
    const userId = ctx.from.id;
    
    if (!isAdmin(userId)) {
        ctx.reply('عذراً، هذا الأمر متاح فقط للمشرف.');
        return;
    }

    const message = ctx.message.text.replace('/broadcast', '').trim();
    
    if (!message) {
        ctx.reply('يرجى كتابة الرسالة المراد إرسالها. مثال:\n/broadcast مرحباً بالجميع!');
        return;
    }

    // عرض تأكيد الإرسال
    const confirmMessage = `
📢 تأكيد الإرسال الجماعي

📝 الرسالة:
${message}

📊 عدد المستخدمين: ${usedTrialUsers.size}

هل تريد إرسال هذه الرسالة؟
    `;

    const keyboard = {
        reply_markup: {
            inline_keyboard: [
                [
                    { text: '✅ نعم، إرسال', callback_data: 'confirm_broadcast' },
                    { text: '❌ إلغاء', callback_data: 'cancel_broadcast' }
                ]
            ]
        }
    };

    ctx.reply(confirmMessage, keyboard);
}

// دالة لجلب عدد التراخيص اليوم
function getTodayLicenses() {
    return new Promise((resolve, reject) => {
        const today = new Date().toISOString().split('T')[0];
        db.get('SELECT COUNT(*) as count FROM licenses WHERE DATE(createdAt) = ?', [today], (err, row) => {
            if (err) reject(err);
            else resolve(row ? row.count : 0);
        });
    });
}

// دالة لحساب الإيرادات اليومية
function calculateDailyRevenue() {
    return new Promise((resolve, reject) => {
        const today = new Date().toISOString().split('T')[0];
        // حساب عدد التراخيص النشطة اليوم
        db.get('SELECT COUNT(*) as total FROM licenses WHERE DATE(createdAt) = ? AND status = "active"', [today], (err, row) => {
            if (err) reject(err);
            else resolve(row ? row.total * 1 : 0); // افتراض أن كل ترخيص يساوي 1
        });
    });
}

// دالة لجلب عدد طلبات التراخيص
function getLicenseRequests() {
    return new Promise((resolve, reject) => {
        db.get('SELECT COUNT(*) as count FROM licenses', [], (err, row) => {
            if (err) reject(err);
            else resolve(row ? row.count : 0);
        });
    });
}

// معالجة أمر /stats
async function handleStats(ctx) {
    const userId = ctx.from.id;
    
    if (!isAdmin(userId)) {
        ctx.reply('عذراً، هذا الأمر متاح فقط للمشرف.');
        return;
    }

    try {
        // جلب جميع الإحصائيات
        const [totalUsers, todayLicenses, dailyRevenue, licenseRequests] = await Promise.all([
            new Promise((resolve, reject) => {
                db.get('SELECT COUNT(*) as count FROM trial_users', [], (err, row) => {
                    if (err) reject(err);
                    else resolve(row ? row.count : 0);
                });
            }),
            getTodayLicenses(),
            calculateDailyRevenue(),
            getLicenseRequests()
        ]);

        const statsMessage = `
📊 إحصائيات مفصلة

👥 عدد المستخدمين: ${totalUsers}
📅 التراخيص اليوم: ${todayLicenses}
💰 التراخيص النشطة اليوم: ${dailyRevenue}

📈 نشاط البوت:
- طلبات التراخيص: ${licenseRequests}
        `;

        ctx.reply(statsMessage);
    } catch (err) {
        console.error('خطأ في جلب الإحصائيات:', err);
        ctx.reply('حدث خطأ أثناء جلب الإحصائيات.');
    }
}

// معالجة أمر /users
function handleUsers(ctx) {
    const userId = ctx.from.id;
    
    if (!isAdmin(userId)) {
        ctx.reply('عذراً، هذا الأمر متاح فقط للمشرف.');
        return;
    }

    // جلب قائمة المستخدمين
    db.all('SELECT userId, usedAt FROM trial_users ORDER BY usedAt DESC LIMIT 10', [], (err, rows) => {
        if (err) {
            console.error('خطأ في جلب المستخدمين:', err);
            ctx.reply('حدث خطأ أثناء جلب قائمة المستخدمين.');
            return;
        }

        let usersList = '👥 آخر 10 مستخدمين:\n\n';
        rows.forEach((user, index) => {
            usersList += `${index + 1}. ${user.userId} - ${new Date(user.usedAt).toLocaleString()}\n`;
        });

        ctx.reply(usersList);
    });
}

// معالجة أمر /licenses
function handleLicenses(ctx) {
    const userId = ctx.from.id;
    
    if (!isAdmin(userId)) {
        ctx.reply('عذراً، هذا الأمر متاح فقط للمشرف.');
        return;
    }

    // جلب قائمة التراخيص
    db.all('SELECT licenseKey, type, status, createdAt, expiresAt FROM licenses ORDER BY createdAt DESC LIMIT 10', [], (err, rows) => {
        if (err) {
            console.error('خطأ في جلب التراخيص:', err);
            ctx.reply('حدث خطأ أثناء جلب قائمة التراخيص.');
            return;
        }

        let licensesList = '🔑 آخر 10 تراخيص:\n\n';
        rows.forEach((license, index) => {
            licensesList += `${index + 1}. ${license.licenseKey}\n`;
            licensesList += `   النوع: ${license.type}\n`;
            licensesList += `   الحالة: ${license.status}\n`;
            licensesList += `   الصلاحية: ${new Date(license.expiresAt).toLocaleString()}\n\n`;
        });

        ctx.reply(licensesList);
    });
}

// معالجة أمر /start
async function handleStart(ctx) {
    try {
        // إرسال الصورة أولاً
        await ctx.replyWithPhoto(
            'https://miro.medium.com/v2/resize:fit:1400/1*NMS4XHEpdGdcR2Fs6IaK9g.png',
            {
                caption: `
🌟 مرحباً بك في بوت fsociety 🌟

🔐 نحن نقدم خدمة التراخيص الموثوقة والآمنة

✨ مميزات البوت:
• تراخيص تجريبية مجانية
• دعم فني على مدار الساعة
• واجهة سهلة الاستخدام
• تحديثات مستمرة

📌 للبدء، اضغط على زر "بدء الاستخدام" أدناه
                `,
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🚀 بدء الاستخدام', callback_data: 'show_main_menu' }]
                    ]
                }
            }
        );
    } catch (error) {
        console.error('Error sending welcome message:', error);
        // إذا فشل إرسال الصورة، سنرسل رسالة نصية فقط
        const startKeyboard = {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🚀 بدء الاستخدام', callback_data: 'show_main_menu' }]
                ]
            }
        };

        await ctx.reply(`
🌟 مرحباً بك في بوت fsociety 🌟

🔐 نحن نقدم خدمة التراخيص الموثوقة والآمنة

✨ مميزات البوت:
• تراخيص تجريبية مجانية
• دعم فني على مدار الساعة
• واجهة سهلة الاستخدام
• تحديثات مستمرة

📌 للبدء، اضغط على زر "بدء الاستخدام" أدناه
        `, startKeyboard);
    }
}

// معالجة الأزرار التفاعلية
async function handleCallbackQuery(ctx) {
    const data = ctx.callbackQuery.data;
    const userId = ctx.from.id;
    
    try {
        switch(data) {
            case 'show_main_menu':
                // إظهار القائمة الرئيسية
                const mainKeyboard = {
                    keyboard: [
                        [{ text: '🎁 ترخيص تجريبي' }],
                        [{ text: 'ℹ️ معلومات' }, { text: '⚙️ إعدادات' }]
                    ],
                    resize_keyboard: true
                };

                const mainMenuMessage = `
مرحباً ${ctx.callbackQuery.from.first_name} 👋
أنا هنا لمساعدتك في الحصول على ترخيص تجريبي.

📋 القائمة الرئيسية:
🎁 ترخيص تجريبي - احصل على ترخيص مجاني
ℹ️ معلومات - تعرف على خدماتنا
⚙️ إعدادات - خصص تجربتك

اختر من القائمة أدناه:
                `;

                await ctx.reply(mainMenuMessage, { reply_markup: mainKeyboard });
                break;
                
            case 'help_guide':
                await ctx.reply(`
📝 دليل الاستخدام:

🎁 الحصول على ترخيص:
   • اضغط على "ترخيص تجريبي"
   • انسخ الترخيص
   • أدخله في الموقع

📊 المتابعة:
   • تتبع حالة الترخيص
   • استقبال التنبيهات
   • تحديث المعلومات
                `, {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '🔙 رجوع', callback_data: 'show_main_menu' }]
                        ]
                    }
                });
                break;
                
            case 'help_faq':
                await ctx.reply(`
❓ الأسئلة الشائعة:

Q: كيف يعمل البوت؟
A: يقوم بتوفير تراخيص للوصول إلى خدمات الموقع.

Q: هل بياناتي آمنة؟
A: نعم، نحن لا نخزن أي بيانات شخصية.

Q: كيف أحصل على ترخيص دائم؟
A: قم بزيارة موقعنا للحصول على ترخيص دائم.
                `);
                break;
                
            case 'help_support':
                await ctx.reply(`
📞 الدعم الفني:

للتواصل مع الدعم الفني:
@your_support

⏰ ساعات العمل:
24/7
                `);
                break;
                
            case 'help_privacy':
                await ctx.reply(`
🔒 سياسة الخصوصية:

• نحن لا نخزن بياناتك الشخصية
• نستخدم تشفير قوي
• نتبع أفضل ممارسات الأمان
                `);
                break;
                
            case 'help_terms':
                await ctx.reply(`
📜 الشروط والأحكام:

• للاستخدام الشخصي فقط
• لا يجوز إعادة توزيع التراخيص
• نحتفظ بحق إيقاف الخدمة
                `);
                break;
                
            case 'settings_notifications':
                await ctx.reply(`
🔔 إعدادات الإشعارات:

• تنبيهات انتهاء الترخيص
• عروض خاصة
                `);
                break;
                
            case 'settings_language':
                await ctx.reply(`
🌐 إعدادات اللغة:

اللغة الحالية: العربية
                `);
                break;
                
            case 'settings_stats':
                await ctx.reply(`
📊 إحصائياتي:

• حالة الترخيص
                `);
                break;
        }
        
        await ctx.answerCbQuery();
    } catch (error) {
        console.error('Error handling callback query:', error);
        await ctx.answerCbQuery('حدث خطأ أثناء معالجة الطلب');
    }
}

// تصدير الدوال للاستخدام في server.js
module.exports = {
    handleStart,
    handleTrial,
    handleMessage,
    handleAdmin,
    handleBroadcast,
    handleStats,
    handleUsers,
    handleLicenses,
    handleCallbackQuery
}; 