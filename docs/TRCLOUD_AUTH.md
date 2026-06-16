# TRCloud Auto-Login (dev proxy)

บันทึกกันลืม: dev server ล็อกอิน TRCloud ให้อัตโนมัติยังไง และจะแก้ปัญหายังไงเวลามันพัง

โค้ดอยู่ใน [`vite.config.js`](../vite.config.js) — ฟังก์ชัน `trcloudLogin()` และ proxy `'/trcloud-api'`

---

## ปัญหาเดิม

TRCloud ใช้ session cookie (`PHPSESSID` + `trcloud`) ที่ **หมดอายุบ่อย** เดิมต้อง copy cookie จากเบราว์เซอร์มาแปะใน `.env` ใหม่เรื่อยๆ พอหมดอายุก็เจอ:

```json
{"success":0,"message":"User and Passkey are mismatched!"}
```

> ⚠️ การ copy cookie **ชุดเดิม** มาแปะซ้ำไม่ช่วย — ถ้า `PHPSESSID`/`trcloud` เป็นค่าเดิมที่ตายแล้ว ก็ยัง mismatched เหมือนเดิม ต้องได้ session **ใหม่จริงๆ** เท่านั้น

---

## กลไกล็อกอินจริงของ TRCloud

ค้นจาก JavaScript ในหน้า `https://thaidrill.trcloud.co/application/login/` — การล็อกอินจริงมี **2 สเต็ป** (ไม่ใช่ POST ไป `/application/` ตรงๆ แบบโค้ดเวอร์ชันเก่า):

| สเต็ป | request | ได้อะไร |
|---|---|---|
| 1 | `GET /application/login/` | `PHPSESSID` สด (ยังไม่ authen) |
| 2 | `POST /application/login/login_engine.php`<br>body: `json={"username","password","cookie":<device id>,"remember":"false"}` | ยืนยันตัวตนให้ `PHPSESSID` นั้น |

สำเร็จแล้ว response = `{"success":1,"message":"Login Complete!"}` และ cookie ที่ใช้ยิง API ได้คือ:

```
trcloud=<device id>; PHPSESSID=<session ใหม่>
```

### `device id` คืออะไร
คือค่าของ cookie **`trcloud`** = "รหัสประจำเครื่อง/เบราว์เซอร์" ที่ TRCloud ใช้ระบุว่าเครื่องไหนได้รับอนุมัติ

- เครื่องที่อนุมัติแล้ว → ล็อกอินผ่าน
- เครื่องใหม่ที่ยังไม่อนุมัติ → response `message:"wait"` (รอแอดมินอนุมัติ) หรือ `"block"`
- **ไม่ผูกกับฮาร์ดแวร์** เป็นแค่ string ดังนั้น copy ค่านี้ไปเครื่องอื่นแล้วใช้ได้ ตราบใดที่เป็น device ที่อนุมัติแล้ว

---

## วิธีเปิดใช้งาน

ตั้งค่าใน `.env` (ดูตัวอย่างที่ `.env.example`):

```ini
TRCLOUD_USE_LOGIN_COOKIE=true          # สวิตช์เปิด auto-login
TRCLOUD_USERNAME=<username>
TRCLOUD_PASSWORD=<password>
TRCLOUD_DEVICE_ID=<ค่า trcloud ของเครื่องที่อนุมัติแล้ว>
# ถ้าไม่ตั้ง TRCLOUD_DEVICE_ID ระบบจะ parse ค่า trcloud= จาก TRCLOUD_COOKIE ให้แทน
```

จากนั้น `npm run dev` — ตอน start จะเห็น log:

```
✅ TRCloud Login สำเร็จ: Login Complete!
🍪 Cookie (login): trcloud=...; PHPSESSID=...
```

> 🔒 `.env` มี credentials + device id = เข้าถึง TRCloud ได้เต็มที่ **ห้าม commit ขึ้น git** (อยู่ใน `.gitignore` แล้ว) ถ้าจะย้ายไปเครื่องอื่นต้อง copy `.env` แบบส่วนตัว

---

## กติกาสำคัญใน proxy 2 ข้อ

อยู่ใน `configure` ของ proxy `'/trcloud-api'`:

1. **เปิด auto-login → ใช้ session ที่ล็อกอินไว้ก่อนเสมอ**
   แอป (ฝั่ง browser) เก็บ cookie เก่าไว้ใน `localStorage` (key `mw_trcloud_proxy_cookie`) แล้วแนบมาทาง header `X-TRCloud-Cookie` ถ้า proxy ไปเชื่อตัวนี้ก่อน จะเอา cookie เก่าที่ตายแล้วไปยิง → mismatched
   → เมื่อ `TRCLOUD_USE_LOGIN_COOKIE=true` proxy จะใช้ session จาก auto-login เป็นหลัก

2. **Sticky session**
   ไม่ให้ `Set-Cookie` จาก response มาเขียนทับ `PHPSESSID`/`trcloud` ของ session ที่ล็อกอินไว้ (บาง endpoint ที่ยัง unauth จะคืน PHPSESSID ใหม่ที่ไม่มีสิทธิ์)

---

## Troubleshooting

| อาการ | สาเหตุ / วิธีแก้ |
|---|---|
| `User and Passkey are mismatched!` | session ที่ proxy ใช้ไม่ผ่าน auth — เช็ค log ตอน start ว่า `✅ Login สำเร็จ` ไหม |
| login ตอน start ขึ้น `wait` / `block` | `TRCLOUD_DEVICE_ID` เป็นเครื่องที่ยังไม่อนุมัติ — ใช้ device id ของเครื่องที่อนุมัติแล้ว |
| login ขึ้น `wrong` | username/password ผิด |
| แก้ config แล้วยังพังเหมือนเดิม | **มี vite ตัวเก่า orphan ค้างพอร์ตอยู่** (restart หยุดแค่ npm แต่ลูก node ยังรัน) → kill node ทั้งหมดแล้ว start ใหม่:<br>`Get-Process node \| Stop-Process -Force` แล้ว `npm run dev` |
| รายการไม่ขึ้นในเว็บ ทั้งที่ยิง API ตรงๆ ได้ | cookie เก่าใน localStorage — hard-refresh `Ctrl+Shift+R` หรือล้าง:<br>`localStorage.removeItem('mw_trcloud_proxy_cookie')` |

---

## วิธีหา / ต่ออายุ device id (ถ้าจำเป็น)

ปกติไม่ต้องทำ เพราะ device id ที่อนุมัติแล้วใช้ได้ยาว แต่ถ้าต้องได้ตัวใหม่:

1. ล็อกอิน TRCloud ในเบราว์เซอร์ปกติ
2. F12 → Application → Cookies → copy ค่า `trcloud`
3. ถ้าเป็นเครื่อง/เบราว์เซอร์ใหม่ที่ยังไม่อนุมัติ ต้องให้แอดมิน TRCloud อนุมัติ device id นั้นก่อน
