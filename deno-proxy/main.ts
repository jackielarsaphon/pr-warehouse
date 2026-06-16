// ============================================================================
// TRCloud Proxy — Deno Deploy
// ----------------------------------------------------------------------------
// เหตุผลที่ใช้ Deno Deploy: ISP/เครือข่ายปลายทาง (ไทย) บล็อก *.vercel.app,
// *.netlify.app, *.workers.dev ฯลฯ — ทดสอบแล้วเข้าได้แค่ *.deno.dev สม่ำเสมอ
//
// หน้าที่:
//   1) จัดการ CORS (รวม OPTIONS preflight)
//   2) auto-login TRCloud ด้วย username/password (อ่านจาก env) แล้ว cache session
//   3) proxy ทุก request /trcloud-api/* ไปยัง https://thaidrill.trcloud.co/*
//
// Environment variables (ตั้งใน Deno Deploy dashboard → Settings → Environment Variables):
//   TRCLOUD_USERNAME   เช่น  don
//   TRCLOUD_PASSWORD   เช่น  dw12345
//   TRCLOUD_DEVICE_ID  เช่น  0e218c475357ad43e7bcc689924d3ce6  (ค่า cookie `trcloud` ของเครื่องที่อนุมัติแล้ว)
// ============================================================================

const BASE_URL = 'https://thaidrill.trcloud.co'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Requested-With, X-TRCloud-Cookie',
}

// ----- session cache (อยู่ใน isolate เดียวกัน) -----
let cachedCookie = ''
let cacheTime = 0
const SESSION_TTL_MS = 20 * 60 * 1000 // 20 นาที

/** อ่านค่า cookie หนึ่งตัวจาก Set-Cookie header */
function readSetCookie(headers: Headers, name: string): string {
  // Deno รวม Set-Cookie หลายค่าเป็น string เดียวคั่นด้วย ", " — split อย่างระวัง
  const raw = headers.get('set-cookie') || ''
  const regex = new RegExp(`(?:^|[,;\\s])${name}=([^;,\\s]+)`)
  const m = raw.match(regex)
  return m ? m[1] : ''
}

/** login TRCloud แล้วคืน cookie header `trcloud=<deviceId>; PHPSESSID=<sessionId>` */
async function trcloudLogin(): Promise<string> {
  const username = Deno.env.get('TRCLOUD_USERNAME')
  const password = Deno.env.get('TRCLOUD_PASSWORD')
  const deviceId = Deno.env.get('TRCLOUD_DEVICE_ID')

  if (!username || !password || !deviceId) {
    throw new Error('ขาด env: TRCLOUD_USERNAME / TRCLOUD_PASSWORD / TRCLOUD_DEVICE_ID')
  }

  // 1) ขอ PHPSESSID ใหม่
  const page = await fetch(`${BASE_URL}/application/login/`, {
    headers: { 'User-Agent': UA },
  })
  await page.body?.cancel()
  const sessionId = readSetCookie(page.headers, 'PHPSESSID')
  if (!sessionId) throw new Error('Login failed: ไม่ได้รับ PHPSESSID จากหน้า login')

  const cookieHeader = `trcloud=${deviceId}; PHPSESSID=${sessionId}`

  // 2) ยืนยันตัวตน
  const body = new URLSearchParams({
    json: JSON.stringify({ username, password, cookie: deviceId, remember: 'false' }),
  })
  const res = await fetch(`${BASE_URL}/application/login/login_engine.php`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-Requested-With': 'XMLHttpRequest',
      'User-Agent': UA,
      'Origin': BASE_URL,
      'Referer': `${BASE_URL}/application/login/`,
      'Cookie': cookieHeader,
    },
    body: body.toString(),
  })

  let data: { success?: number | boolean; message?: string }
  try {
    data = await res.json()
  } catch {
    throw new Error('Login failed: ตอบกลับไม่ใช่ JSON')
  }
  if (!data.success) {
    const reason =
      data.message === 'wrong' ? 'ชื่อผู้ใช้หรือรหัสผ่านผิด'
      : data.message === 'block' ? 'เครื่องนี้ถูกบล็อก'
      : data.message === 'wait' ? `เครื่องนี้ยังไม่ได้รับอนุมัติ (device id: ${deviceId})`
      : data.message || 'unknown'
    throw new Error(`Login failed: ${reason}`)
  }

  console.log('[trcloud-proxy] Login OK:', data.message)
  return cookieHeader
}

/** คืน cookie ที่ login แล้ว (cache) */
async function getSessionCookie(): Promise<string> {
  if (cachedCookie && Date.now() - cacheTime < SESSION_TTL_MS) return cachedCookie
  cachedCookie = await trcloudLogin()
  cacheTime = Date.now()
  return cachedCookie
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url)

  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: CORS_HEADERS })
  }

  // health check
  if (url.pathname === '/' || url.pathname === '/health') {
    return new Response(JSON.stringify({ ok: true, service: 'trcloud-proxy' }), {
      status: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }

  // proxy paths:
  //   /p?path=<encoded TRCloud path>      (production — เลี่ยง static layer ของ Deno ที่ดัก path เหมือนไฟล์)
  //   /trcloud-api/<path>                 (เผื่อ dev/legacy)
  let trcloudPath = ''
  if (url.pathname === '/p') {
    trcloudPath = (url.searchParams.get('path') || '').replace(/^\/+/, '')
  } else if (url.pathname.startsWith('/trcloud-api/')) {
    trcloudPath = url.pathname.replace(/^\/trcloud-api\//, '') + url.search
  } else {
    return new Response('Not found', { status: 404, headers: CORS_HEADERS })
  }

  try {
    const targetUrl = `${BASE_URL}/${trcloudPath}`

    // ใช้ cookie จาก client ถ้ามี ไม่งั้น auto-login
    let cookie = (req.headers.get('x-trcloud-cookie') || '').trim()
    if (!cookie) cookie = await getSessionCookie()

    const rawBody = req.method === 'POST' ? await req.arrayBuffer() : undefined

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 20000)

    let response: Response
    try {
      response = await fetch(targetUrl, {
        method: req.method,
        headers: {
          'Content-Type': req.headers.get('content-type') || 'application/x-www-form-urlencoded',
          'X-Requested-With': 'XMLHttpRequest',
          'User-Agent': UA,
          'Accept': 'application/json, text/plain, */*',
          'Accept-Language': 'th,en;q=0.9',
          'Origin': BASE_URL,
          'Referer': `${BASE_URL}/application/`,
          'Cookie': cookie,
        },
        body: rawBody && rawBody.byteLength > 0 ? rawBody : undefined,
        signal: controller.signal,
        redirect: 'follow',
      })
    } finally {
      clearTimeout(timeout)
    }

    const text = await response.text()
    console.log(`[trcloud-proxy] ${req.method} ${trcloudPath} -> ${response.status}`)
    return new Response(text, {
      status: response.status,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': response.headers.get('content-type') || 'application/json',
      },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[trcloud-proxy] Error:', msg)
    return new Response(JSON.stringify({ success: 0, message: `Proxy error: ${msg}` }), {
      status: 502,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }
})
