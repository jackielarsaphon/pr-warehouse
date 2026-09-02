# TRCloud Proxy

ตัวกลางให้หน้าเว็บเรียก TRCloud API ได้ — รันเป็น container บน VPS `tdlmc.com`
เข้าถึงจากภายนอกทางเดียวคือ `https://pr.tdlmc.com/trc/*` ซึ่งมีด่าน login ครอบอยู่

## ทำไมต้องมี proxy ไม่ยิง TRCloud ตรงจากเบราว์เซอร์

TRCloud ต้องล็อกอินด้วย cookie `PHPSESSID` + `trcloud` (device id ที่อนุมัติแล้ว)
ถ้าให้หน้าเว็บถือรหัสไว้เอง ใครเปิด view-source ก็ได้สิทธิ์เท่าเจ้าของบัญชี
proxy จึงถือรหัสไว้ฝั่งเซิร์ฟเวอร์ ล็อกอินเอง แล้ว cache session ไว้ 20 นาที

## ทำไมย้ายจาก Deno Deploy มาที่นี่ (2 ก.ย. 2026)

เดิมอยู่ `https://pr-warehouse.dwnb1994.deno.net` ซึ่งใช้ได้ แต่**เปราะ**:
เครือข่ายปลายทางบล็อกโดเมน free-subdomain PaaS เป็นชุดที่ระดับ SNI
(`*.run.app`, `*.vercel.app`, `*.netlify.app`, `*.web.app`, `*.pages.dev` โดนแล้ว)
`deno.net` อยู่ class เดียวกัน = ยังไม่โดนเท่านั้น ไม่ใช่ปลอดภัย

ย้ายมาอยู่ใต้โดเมนของบริษัทเองจึงตัดความเสี่ยงนี้ทิ้ง และได้ผลพลอยได้คือ
**same-origin กับหน้าเว็บ** ไม่ต้องพึ่ง CORS อีก

## Deploy

```bash
# ครั้งแรก: สร้างไฟล์ env บน VPS (ห้ามอยู่ใน repo)
sudo install -m 600 /dev/null /etc/pr-warehouse-proxy.env
sudo tee /etc/pr-warehouse-proxy.env >/dev/null <<'ENV'
TRCLOUD_USERNAME=<username>
TRCLOUD_PASSWORD=<password>
TRCLOUD_DEVICE_ID=<ค่า cookie trcloud ของเครื่องที่ TRCloud อนุมัติแล้ว>
ENV

# ขึ้น container
cd /opt/pr-warehouse-proxy
docker compose --env-file /etc/pr-warehouse-proxy.env up -d --build
```

⚠️ **ระวังใส่ค่าสลับช่อง** `TRCLOUD_USERNAME` กับ `TRCLOUD_DEVICE_ID` — เคยพลาดมาแล้ว
อาการคือ proxy ตอบ `Login failed: ชื่อผู้ใช้หรือรหัสผ่านผิด` ทั้งที่รหัสถูก

## ทดสอบ

```bash
# บน VPS (ข้ามด่าน login ได้เพราะยิง loopback ตรง)
curl -s localhost:8096/health
# -> {"ok":true,"service":"trcloud-proxy"}

# จากข้างนอก (ต้องล็อกอินก่อน ไม่งั้นได้ 302 ไปหน้า login)
curl -s https://pr.tdlmc.com/trc/health
```

## endpoint ที่ proxy รู้จัก

| path | ทำอะไร |
|------|--------|
| `/` · `/health` | ตอบสถานะ ไม่แตะ TRCloud |
| `/p?path=<endpoint>` | ทางที่หน้าเว็บใช้จริง — endpoint อยู่ใน query ไม่ใช่ใน path |
| `/trcloud-api/<endpoint>` | ทางเก่า ยังรองรับไว้ |

`/p` ต้องมีเพราะบาง endpoint ของ TRCloud มี `.php` และอักขระที่ทำให้ตัวกลาง
บางตัวตีความ path ผิด — ยัดไว้ใน query string จึงเลี่ยงปัญหาได้
