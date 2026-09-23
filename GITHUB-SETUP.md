# رفع المشروع على GitHub — خطوة بخطوة

هذا الدليل يرفع مشروع "عطور الريحان" إلى حسابك على GitHub كمستودع (repository) خاص.

> **اجعل المستودع خاصاً (Private).** المشروع جاهز بحيث لا تُرفع كلمات المرور ولا بيانات
> الزبائن، لكن الكود نفسه يخص متجرك ولا داعي لجعله علنياً.

---

## ما الذي يُرفع وما الذي لا يُرفع (تلقائياً)

ملف `.gitignore` الموجود في المشروع يمنع رفع هذه الأشياء — لا تحتاج أن تفعل شيئاً:

| لا يُرفع أبداً | السبب |
|---|---|
| `server/.env` | فيه كلمة مرور الإدارة وكلمة مرور البريد |
| `server/data/users.json` | حسابات الزبائن وأرصدة المحافظ |
| `server/data/orders.json` | طلبات الزبائن وأرقام هواتفهم وعناوينهم |
| `server/uploads/` | صور المنتجات المرفوعة (احتفظ بنسخة احتياطية منفصلة) |
| `node_modules/` | تُنشأ من جديد بأمر `npm install` |

أما المنتجات والخطوط (`products.json` و `brands.json`) فتُرفع، لأنها بيانات المتجر الأساسية.

---

## الطريقة الأولى: GitHub Desktop (الأسهل — بدون أوامر)

1. **أنشئ حساباً** على <https://github.com> إذا لم يكن لديك واحد.
2. **حمّل GitHub Desktop** من <https://desktop.github.com> وثبّته، ثم سجّل الدخول بحسابك
   (من القائمة: File → Options → Accounts → Sign in).
3. **فك ضغط المشروع** في مكان ثابت (مثلاً `Documents\alrayhan-system`).
   اعمل على هذه النسخة من الآن فصاعداً.
4. في GitHub Desktop: **File → Add local repository…** ثم اختر مجلد `alrayhan-system`.
5. سيظهر تنبيه أن هذا المجلد ليس مستودعاً بعد — اضغط **create a repository**.
   - Name: `alrayhan-perfumes`
   - اترك باقي الخيارات كما هي، واضغط **Create repository**.
6. ستظهر قائمة الملفات في اليسار. تأكد أنك **لا ترى** ملف `.env` ولا `users.json` ولا `orders.json`.
   (إن ظهر أي منها، توقف واسألني.)
7. في الأسفل يساراً اكتب في خانة Summary: `النسخة الأولى من متجر عطور الريحان`
   ثم اضغط **Commit to main**.
8. اضغط **Publish repository** في الأعلى.
   - **تأكد أن خيار "Keep this code private" مفعّل.**
   - اضغط **Publish repository**.

تم. افتح <https://github.com> وستجد المستودع `alrayhan-perfumes` في حسابك.

### حفظ التعديلات لاحقاً

كلما عدّلت شيئاً في المشروع: افتح GitHub Desktop، اكتب وصفاً قصيراً للتعديل في Summary،
اضغط **Commit to main**، ثم **Push origin**.

---

## الطريقة الثانية: سطر الأوامر

تحتاج برنامج Git من <https://git-scm.com/download/win>. استخدم **Command Prompt** (وليس
PowerShell) لتجنّب مشكلة صلاحيات السكربتات التي واجهتها سابقاً.

1. على GitHub: اضغط **+** أعلى الصفحة ← **New repository**
   - Repository name: `alrayhan-perfumes`
   - اختر **Private**
   - **لا تضع علامة** على "Add a README file" (المشروع فيه README أصلاً)
   - اضغط **Create repository**، وانسخ الرابط الذي يظهر (يشبه
     `https://github.com/اسمك/alrayhan-perfumes.git`)

2. في Command Prompt، داخل مجلد المشروع:
   ```
   cd Documents\alrayhan-system
   git init -b main
   git config user.name "اسمك"
   git config user.email "بريدك-المسجل-في-github@example.com"
   git add .
   git status
   ```
   راجع ناتج `git status`: يجب **ألا** يظهر `.env` ولا `users.json` ولا `orders.json`.

3. ثم:
   ```
   git commit -m "النسخة الأولى من متجر عطور الريحان"
   git remote add origin https://github.com/اسمك/alrayhan-perfumes.git
   git push -u origin main
   ```
   عند أول `push` ستفتح نافذة لتسجيل الدخول إلى GitHub عبر المتصفح — سجّل دخولك واقبل.

### حفظ التعديلات لاحقاً
```
git add .
git commit -m "وصف قصير للتعديل"
git push
```

---

## تنزيل المشروع على جهاز آخر (أو على السيرفر)

```
git clone https://github.com/اسمك/alrayhan-perfumes.git
cd alrayhan-perfumes\server
copy .env.example .env
npm install
npm start
```
(على لينكس/السيرفر استخدم `cp` بدلاً من `copy`.)

تذكّر: الـ clone الجديد **لا يحتوي** على `.env` ولا طلبات الزبائن ولا الصور — هذه تبقى
على الجهاز الذي أنشأها. لنقلها، انسخ `server/.env` و `server/data/users.json` و
`server/data/orders.json` ومجلد `server/uploads/` يدوياً.

---

## إذا رفعت ملفاً سرياً بالخطأ

إذا ظهر ملف `.env` على GitHub لأي سبب: **غيّر فوراً** كلمة مرور الإدارة، وأنشئ App Password
جديد للبريد (واحذف القديم من إعدادات Google)، لأن حذف الملف لاحقاً لا يمحوه من سجل التعديلات.
