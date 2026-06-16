# TRCloud Proxy (Deno Deploy)

Proxy สำหรับเรียก TRCloud API จาก frontend ที่อยู่บน GitHub Pages

> **ทำไมต้อง Deno Deploy?** เครือข่าย/ISP ปลายทางบล็อก `*.vercel.app`, `*.netlify.app`,
> `*.workers.dev` — ทดสอบแล้วเข้าถึงได้สม่ำเสมอเฉพาะ `*.deno.dev`

## วิธี Deploy

1. ไปที่ https://dash.deno.com → **New Project**
2. เลือก **Deploy from GitHub** → เลือก repo `jackielarsaphon/pr-warehouse`
3. ตั้งค่า:
   - **Entry point**: `deno-proxy/main.ts`
   - **Branch**: `main`
4. ไปที่ **Settings → Environment Variables** เพิ่ม:
   | Name | Value |
   |------|-------|
   | `TRCLOUD_USERNAME` | `don` |
   | `TRCLOUD_PASSWORD` | `dw12345` |
   | `TRCLOUD_DEVICE_ID` | `0e218c475357ad43e7bcc689924d3ce6` |
5. Deploy แล้วจะได้ URL เช่น `https://pr-warehouse-xxxx.deno.dev`
6. นำ URL นั้นไปใส่ใน `.github/workflows/deploy.yml` ที่ตัวแปร `VITE_TRCLOUD_PROXY_BASE`

## ทดสอบ

```
curl https://<your-project>.deno.dev/health
# -> {"ok":true,"service":"trcloud-proxy"}
```
