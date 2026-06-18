# TRCloud Proxy — Supabase Edge Function

แทน Deno Deploy (ที่โดนระงับเพราะ USAGE_EXCEEDED) — รันบนโดเมน `*.supabase.co`
ที่แอปใช้อยู่แล้วและ ISP ไทยเข้าถึงได้ โควต้าฟรีเยอะ ไม่ถูกพักการทำงาน

URL หลัง deploy:
`https://sowrzreodfzvipubqxwj.supabase.co/functions/v1/trcloud-proxy`

## Deploy (ครั้งแรก)

ต้องมี [Supabase CLI](https://supabase.com/docs/guides/cli) แล้ว login:

```bash
supabase login
cd pr-and-warehouse-tracking

# 1) ตั้ง secrets (ครั้งเดียว — ค่าเดียวกับ Deno proxy เดิม)
supabase secrets set TRCLOUD_USERNAME=don TRCLOUD_PASSWORD=dw12345 \
  TRCLOUD_DEVICE_ID=0e218c475357ad43e7bcc689924d3ce6 \
  --project-ref sowrzreodfzvipubqxwj

# 2) deploy (public function — ไม่ต้องมี JWT)
supabase functions deploy trcloud-proxy --no-verify-jwt \
  --project-ref sowrzreodfzvipubqxwj
```

## ทดสอบ

```bash
curl https://sowrzreodfzvipubqxwj.supabase.co/functions/v1/trcloud-proxy/health
# -> {"ok":true,"service":"trcloud-proxy","host":"supabase"}
```

## เชื่อมกับ frontend

ตั้งใน `.github/workflows/deploy.yml` → `VITE_TRCLOUD_PROXY_BASE`:
```
https://sowrzreodfzvipubqxwj.supabase.co/functions/v1/trcloud-proxy
```
แล้ว push เพื่อ rebuild GitHub Pages
