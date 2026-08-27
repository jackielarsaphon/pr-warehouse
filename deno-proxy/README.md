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
   | `TRCLOUD_USERNAME` | ดูจาก `.env` ในเครื่อง |
   | `TRCLOUD_PASSWORD` | ดูจาก `.env` ในเครื่อง |
   | `TRCLOUD_DEVICE_ID` | ดูจาก `.env` ในเครื่อง (cookie `trcloud`) |
5. Deploy แล้วจะได้ URL เช่น `https://pr-warehouse-xxxx.deno.dev`
6. นำ URL นั้นไปใส่ใน `.github/workflows/deploy.yml` ที่ตัวแปร `VITE_TRCLOUD_PROXY_BASE`

## ทดสอบ

```
curl https://<your-project>.deno.dev/health
# -> {"ok":true,"service":"trcloud-proxy"}
```

---

## ทางเลือก: Deploy บน Google Cloud Run

โปรเจกต์ production ปัจจุบันชี้ `VITE_TRCLOUD_PROXY_BASE` ไปที่ Cloud Run
(`https://trcloud-proxy-ytlwqebtha-as.a.run.app`) โดยใช้ `main.ts` ตัวเดียวกันผ่าน `Dockerfile`

> **สำคัญ:** URL ของ Cloud Run เป็นค่าคงที่ (deterministic) ต่อ *ชื่อ service + project + region*
> ถ้า deploy service ชื่อ `trcloud-proxy` ที่ region `asia-southeast1` ใน project เดิม
> จะได้ URL เดิมกลับมา — เว็บที่ build ไว้แล้วจะกลับมาทำงานทันทีโดยไม่ต้อง build ใหม่

### ขั้นตอน

รันจากโฟลเดอร์ `deno-proxy/` (มี `Dockerfile`):

```bash
gcloud run deploy trcloud-proxy \
  --source . \
  --region asia-southeast1 \
  --allow-unauthenticated \
  --set-env-vars TRCLOUD_USERNAME=<username>,TRCLOUD_PASSWORD=<password>,TRCLOUD_DEVICE_ID=<device_id>
```

- ค่า `<username>` / `<password>` / `<device_id>` ดูจาก `.env` ในเครื่อง (ห้าม commit ค่าจริงลง repo)
- `--allow-unauthenticated` จำเป็น เพราะ browser เรียก proxy แบบ public
- `--region asia-southeast1` → URL ลงท้าย `-as` (ตรงกับ URL เดิม)
- ชื่อ service ต้องเป็น `trcloud-proxy` เพื่อให้ได้ URL prefix เดิม

หลัง deploy เสร็จ `gcloud` จะพิมพ์ **Service URL**:
- ถ้าตรงกับ `https://trcloud-proxy-ytlwqebtha-as.a.run.app` → ไม่ต้องแก้อะไรเพิ่ม เว็บกลับมาใช้งานได้เลย
- ถ้าต่างออกไป (คนละ project) → ใส่ค่านั้นเป็น GitHub secret `VITE_TRCLOUD_PROXY_BASE` แล้ว re-run workflow **Deploy to GitHub Pages**

### ทดสอบ

```
curl https://<service-url>/health
# -> {"ok":true,"service":"trcloud-proxy"}
```
