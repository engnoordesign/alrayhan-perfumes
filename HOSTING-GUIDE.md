# دليل النشر — رفع الموقع على الإنترنت وربطه بدومين

هذا الدليل يشرح، خطوة بخطوة، كيف تنقل الموقع من جهازك المحلي إلى الإنترنت بحيث يفتحه
أي زبون من هاتفه على عنوان مثل `alrayhanperfumes.com`.

**الوقت المتوقع:** ساعة إلى ساعتين لأول مرة.
**التكلفة التقريبية:** 6–12 دولار سنوياً للدومين + 5–7 دولار شهرياً للسيرفر.

---

## نظرة سريعة على الخطوات

1. شراء سيرفر (VPS)
2. شراء دومين
3. توجيه الدومين إلى السيرفر
4. تجهيز السيرفر ورفع الملفات
5. تشغيل الموقع بشكل دائم
6. تفعيل HTTPS (القفل الأخضر)
7. تفعيل إيميلات الطلبات

---

## 1) شراء سيرفر (VPS)

الموقع يحتاج سيرفر يشغّل Node.js. أي VPS بسيط يكفي تماماً — الموقع خفيف.

### الخيارات المقترحة

| المزوّد | السعر الشهري | ملاحظات |
|---|---|---|
| **Hetzner** (hetzner.com) | ~4.5 دولار | الأرخص والأفضل قيمة، سيرفراتهم في ألمانيا/فنلندا |
| **DigitalOcean** (digitalocean.com) | 6 دولار | الأسهل للمبتدئين، واجهة واضحة وشروحات كثيرة |
| **Vultr** (vultr.com) | 6 دولار | لديهم سيرفرات قريبة من المنطقة |
| **Contabo** (contabo.com) | ~5 دولار | موارد أكبر بنفس السعر |

### المواصفات المطلوبة (الحد الأدنى يكفي)

- **النظام:** Ubuntu 22.04 LTS أو 24.04 LTS
- **الرام:** 1 GB (كافٍ تماماً)
- **المعالج:** 1 vCPU
- **التخزين:** 25 GB

### الموقع الجغرافي

اختر أقرب مركز بيانات لزبائنك ليكون الموقع أسرع. لزبائن في العراق، الترتيب المفضّل:
**الإمارات/البحرين** إن توفّر، ثم **تركيا**، ثم **ألمانيا/فرنسا**، ثم **لندن**.

### طريقة الدفع

معظم هذه الشركات تقبل فيزا/ماستركارد. إذا واجهت صعوبة في الدفع من العراق، الحلول الشائعة:
بطاقة دفع دولية من أحد البنوك المحلية، أو PayPal، أو بطاقات مسبقة الدفع الرقمية.
بعض المزوّدين (مثل DigitalOcean) يقبلون الدفع عبر PayPal مباشرة.

بعد الشراء ستصلك رسالة فيها **عنوان IP** للسيرفر (مثل `203.0.113.45`) وكلمة مرور
المستخدم `root`. احتفظ بهما.

---

## 2) شراء دومين

| المزوّد | السعر السنوي التقريبي | ملاحظات |
|---|---|---|
| **Namecheap** (namecheap.com) | 8–12 دولار | شائع وسهل، حماية الخصوصية مجانية |
| **Cloudflare Registrar** | 9–10 دولار | يبيع بسعر التكلفة بدون أرباح، لكن يتطلب نقل الدومين إليهم |
| **Porkbun** (porkbun.com) | 8–11 دولار | أسعار جيدة وواجهة بسيطة |

ابحث عن اسم مثل `alrayhanperfumes.com` أو `alrayhan-perfumes.com`.
امتداد `.com` هو الأفضل والأكثر ثقة. هناك أيضاً `.iq` للعراق لكنه أعقد في التسجيل.

> **تنبيه مهم:** فعّل **حماية الخصوصية (WHOIS Privacy)** — عادة مجانية — وإلا سيظهر
> اسمك ورقمك وعنوانك علناً لأي شخص يبحث عن الدومين.

---

## 3) توجيه الدومين إلى السيرفر

ادخل إلى لوحة تحكم الدومين (في Namecheap مثلاً: **Domain List → Manage → Advanced DNS**)
وأضف سجلّين:

| النوع | الاسم (Host) | القيمة (Value) | TTL |
|---|---|---|---|
| A | `@` | عنوان IP للسيرفر | Automatic |
| A | `www` | نفس عنوان IP | Automatic |

احذف أي سجلات `A` أو `CNAME` قديمة موجودة مسبقاً لنفس الاسم (كثير من المزوّدين يضعون
صفحة إعلانية افتراضية).

انتظر من 10 دقائق إلى ساعتين حتى تنتشر التغييرات. للتأكد أنها اشتغلت، اكتب في الطرفية:

```bash
ping alrayhanperfumes.com
```

إذا ظهر عنوان IP سيرفرك، فالتوجيه نجح.

---

## 4) تجهيز السيرفر ورفع الملفات

### الدخول إلى السيرفر

من جهازك (PowerShell على ويندوز، أو Terminal على ماك/لينكس):

```bash
ssh root@203.0.113.45
```

استبدل الرقم بعنوان IP سيرفرك، وأدخل كلمة المرور عند الطلب.

### تثبيت Node.js والأدوات

انسخ هذه الأوامر والصقها واحداً تلو الآخر:

```bash
apt update && apt upgrade -y
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs nginx unzip
npm install -g pm2
```

للتأكد من نجاح التثبيت:

```bash
node -v      # يجب أن يظهر v20.x.x
```

### رفع ملفات الموقع

**الطريقة الأسهل** — من جهازك (ليس من داخل السيرفر)، افتح نافذة طرفية جديدة في المجلد
الذي يحتوي ملف الـ zip:

```bash
scp alrayhan-perfumes-system.zip root@203.0.113.45:/var/www/
```

ثم ارجع لنافذة السيرفر وفك الضغط:

```bash
cd /var/www
unzip alrayhan-perfumes-system.zip
cd alrayhan-system/server
npm install --production
```

---

## 5) تشغيل الموقع بشكل دائم

### إعداد ملف الإعدادات

```bash
cd /var/www/alrayhan-system/server
cp .env.example .env
nano .env
```

غيّر على الأقل كلمة مرور الإدارة إلى شيء قوي، واحفظ بـ `Ctrl+O` ثم `Enter` ثم `Ctrl+X`:

```
PORT=3000
ADMIN_PASSWORD=ضع-كلمة-مرور-قوية-هنا
DELIVERY_FEE=5000
```

### تشغيل الموقع مع pm2

`pm2` يبقي الموقع شغّالاً ويعيد تشغيله تلقائياً إذا توقف أو أُعيد تشغيل السيرفر:

```bash
cd /var/www/alrayhan-system/server
pm2 start server.js --name alrayhan
pm2 save
pm2 startup     # نفّذ الأمر الذي يطبعه لك
```

أوامر مفيدة لاحقاً:

```bash
pm2 logs alrayhan      # مشاهدة السجلات والأخطاء
pm2 restart alrayhan   # إعادة التشغيل بعد أي تعديل
pm2 status             # حالة الموقع
```

### ربط الدومين بالموقع عبر nginx

```bash
nano /etc/nginx/sites-available/alrayhan
```

الصق هذا، مع استبدال اسم الدومين باسمك:

```nginx
server {
    listen 80;
    server_name alrayhanperfumes.com www.alrayhanperfumes.com;

    client_max_body_size 10M;   # يسمح برفع صور المنتجات

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

ثم فعّله:

```bash
ln -s /etc/nginx/sites-available/alrayhan /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t          # يجب أن يقول "syntax is ok"
systemctl reload nginx
```

الآن افتح `http://alrayhanperfumes.com` في المتصفح — يجب أن يظهر الموقع.

---

## 6) تفعيل HTTPS (القفل الأخضر)

بدون HTTPS سيظهر تحذير "غير آمن" للزبائن. التفعيل مجاني ويأخذ دقيقتين:

```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d alrayhanperfumes.com -d www.alrayhanperfumes.com
```

اتبع الأسئلة (أدخل إيميلك، ووافق على الشروط، واختر إعادة التوجيه التلقائي إلى HTTPS).
الشهادة تتجدد تلقائياً كل 90 يوماً بدون تدخل منك.

الآن الموقع يعمل على `https://alrayhanperfumes.com` 🔒

---

## 7) تفعيل إيميلات الطلبات

حتى يصلك إشعار بكل طلب جديد:

```bash
nano /var/www/alrayhan-system/server/.env
```

أضف إعدادات Gmail (راجع `README.md` لتفاصيل إنشاء App Password):

```
OWNER_EMAIL=youraddress@gmail.com
MAIL_FROM=Alrayhan Perfumes <youraddress@gmail.com>
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=youraddress@gmail.com
SMTP_PASS=رمز-التطبيق-المكوّن-من-16-حرف
```

ثم:

```bash
pm2 restart alrayhan
pm2 logs alrayhan
```

ابحث في السجل عن `✅ إعدادات البريد سليمة`.

---

## حماية أساسية (موصى بها بشدة)

```bash
# جدار حماية: اسمح فقط بالمنافذ الضرورية
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw enable

# منع محاولات اختراق كلمة مرور SSH
apt install -y fail2ban
systemctl enable --now fail2ban
```

**غيّر كلمة مرور الإدارة** في `.env` من `alrayhan2026` إلى شيء قوي — هذه أهم خطوة أمنية.

---

## النسخ الاحتياطي (مهم جداً)

كل بيانات المتجر (المنتجات، الطلبات، الحسابات) في مجلدين فقط:

```
/var/www/alrayhan-system/server/data/      ← قواعد البيانات
/var/www/alrayhan-system/server/uploads/   ← صور المنتجات
```

لأخذ نسخة احتياطية إلى جهازك، نفّذ من جهازك:

```bash
scp -r root@203.0.113.45:/var/www/alrayhan-system/server/data ./backup-data
scp -r root@203.0.113.45:/var/www/alrayhan-system/server/uploads ./backup-uploads
```

**اعمل هذا أسبوعياً على الأقل.** يمكن أيضاً تفعيل خاصية Snapshots من لوحة تحكم
المزوّد (بدولار أو دولارين شهرياً) لتأخذ نسخة كاملة من السيرفر تلقائياً.

---

## تحديث الموقع لاحقاً

عند وجود نسخة جديدة من الملفات:

```bash
# 1) احفظ بياناتك أولاً!
cd /var/www/alrayhan-system/server
cp -r data ~/data-backup
cp -r uploads ~/uploads-backup

# 2) ارفع النسخة الجديدة وفك ضغطها
# 3) أعد بياناتك مكان الملفات الافتراضية
cp -r ~/data-backup/* /var/www/alrayhan-system/server/data/
cp -r ~/uploads-backup/* /var/www/alrayhan-system/server/uploads/

# 4) أعد التشغيل
cd /var/www/alrayhan-system/server
npm install --production
pm2 restart alrayhan
```

---

## حل المشاكل الشائعة

| المشكلة | الحل |
|---|---|
| الموقع لا يفتح أبداً | `pm2 status` — إذا كان متوقفاً: `pm2 restart alrayhan` ثم `pm2 logs` |
| "502 Bad Gateway" | الموقع متوقف أو على منفذ مختلف. تحقق من `PORT=3000` في `.env` |
| الدومين لا يعمل | انتظر أطول (حتى 24 ساعة)، وتأكد من سجلات A في لوحة الدومين |
| الصور لا تُرفع | زد `client_max_body_size` في nginx وأعد تحميله |
| الإيميلات لا تصل | `pm2 logs alrayhan` وابحث عن رسالة خطأ البريد. غالباً App Password خاطئ |
| نسيت كلمة مرور الإدارة | عدّلها في `.env` ثم `pm2 restart alrayhan` |

---

## ملاحظة على قاعدة البيانات

النظام يخزّن البيانات في ملفات JSON، وهذا ممتاز لمحل واحد بحركة عادية — بسيط،
سريع، وسهل النسخ الاحتياطي.

إذا كبر المتجر لاحقاً (مئات الطلبات يومياً، أو عدة موظفين يعدّلون في نفس اللحظة)،
فالترقية المنطقية هي نقل التخزين إلى PostgreSQL. الكود مهيّأ لذلك: كل القراءة والكتابة
تمر عبر دالتين فقط في `server/db.js`، لذا التحويل يتم في مكان واحد دون لمس بقية النظام.

---

## أشياء يجب تغييرها قبل استقبال زبائن حقيقيين

هذه نقاط ما تزال بوضع تجريبي (مشروحة بالتفصيل في `README.md`):

1. **رموز التحقق للهاتف تظهر على الشاشة** بدل إرسالها كرسالة نصية — تحتاج ربط مزوّد SMS
2. **تسجيل الدخول بجوجل/آبل محاكاة فقط** — يحتاج تسجيل التطبيق لدى جوجل وآبل
3. **شحن المحفظة مجاني** — لا يوجد بوابة دفع حقيقية مربوطة
4. **كلمة مرور الإدارة مشتركة** — لا توجد حسابات إدارية منفصلة لكل موظف

الأول والثالث هما الأهم إن كنت تنوي الاعتماد على الحسابات والمحفظة تجارياً.
