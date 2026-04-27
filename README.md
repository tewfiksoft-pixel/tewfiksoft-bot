# TewfikSoft HR Bot — Cloud Edition (Koyeb)

بوت Telegram لإدارة الموارد البشرية — يعمل على Koyeb بنظام Polling.

---

## 🚀 النشر على Koyeb

### المتطلبات
- حساب [Koyeb](https://app.koyeb.com) (مجاني)
- توكن بوت Telegram من [@BotFather](https://t.me/botfather)

### خطوات النشر
1. ارفع المشروع على GitHub (مستودع خاص)
2. سجّل دخولك على [Koyeb Dashboard](https://app.koyeb.com)
3. اضغط **Create App → Deploy from GitHub**
4. اختر هذا المستودع والفرع `main`
5. في **Build & Run**:
   - Build Command: `npm install`
   - Start Command: `node index.js`
6. في **Environment Variables** أضف:
   - `BOT_TOKEN` = توكن البوت من BotFather
   - `ADMIN_CHAT_ID` = Telegram ID الخاص بك
   - `PORT` = `8080`
7. في **Ports**: أضف Port `8080` بروتوكول `HTTP`
8. اختر المنطقة: `Frankfurt (fra)`
9. اضغط **Deploy**

---

## 🔍 مراقبة البوت (UptimeRobot)

1. سجّل دخولك على [UptimeRobot](https://uptimerobot.com)
2. أضف Monitor جديد:
   - النوع: **HTTP(s)**
   - URL: `https://YOUR-APP-NAME.koyeb.app`
   - الفترة: **5 دقائق**
3. سيُبقي هذا التطبيق نشطاً ويمنع وضع السكون

---

## ⚙️ متغيرات البيئة المطلوبة

| المتغير | الوصف |
|---------|-------|
| `BOT_TOKEN` | توكن البوت من BotFather |
| `ADMIN_CHAT_ID` | Telegram ID المسؤول (لاستقبال إشعارات البدء) |
| `PORT` | المنفذ (القيمة الافتراضية: 8080) |

---

## ⚠️ ملاحظات مهمة

- البوت يعمل بنظام **Polling** (وليس Webhook)
- لا تشغّل نسختين من البوت في نفس الوقت (محلي + سحابي) لتفادي `Conflict`
- قاعدة البيانات تتزامن تلقائياً كل دقيقتين من Google Drive

---

## 📁 هيكل المشروع

```
CloudBot/
├── index.js          # البوت الرئيسي
├── config.json       # إعدادات المستخدمين والصلاحيات
├── package.json      # التبعيات
├── koyeb.yaml        # إعداد Koyeb
└── .gitignore
```
