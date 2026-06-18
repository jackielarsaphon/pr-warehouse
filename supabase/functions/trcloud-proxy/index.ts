// ============================================================================
// TRCloud Proxy — Supabase Edge Function (รันตลอดเวลา, โดเมน *.supabase.co)
// ----------------------------------------------------------------------------
// ทำไม Supabase Edge Function:
//   - เสิร์ฟจาก https://<ref>.supabase.co/functions/v1/trcloud-proxy — โดเมนเดียว
//     กับฐานข้อมูลที่แอปใช้อยู่แล้ว (ISP ไทยไม่บล็อก, ต่างจาก vercel/netlify/workers)
//   - โควต้าฟรีเยอะ ไม่ถูกพักการทำงานแบบ Deno Deploy free tier (USAGE_EXCEEDED)
//
// หน้าที่: CORS + auto-login TRCloud (cache session) + proxy ไป thaidrill.trcloud.co
//
// Deploy:
//   supabase functions deploy trcloud-proxy --no-verify-jwt --project-ref <ref>
// ตั้ง secrets (ครั้งเดียว):
//   supabase secrets set TRCLOUD_USERNAME=don TRCLOUD_PASSWORD=dw12345 \
//     TRCLOUD_DEVICE_ID=0e218c475357ad43e7bcc689924d3ce6 --project-ref <ref>
// ============================================================================

const BASE_URL = 'https://thaidrill.trcloud.co'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Requested-With, X-TRCloud-Cookie, apikey, authorization',
}

// ----- session cache (อยู่ใน isolate เดียวกัน) -----
let cachedCookie = ''
let cacheTime = 0
const SESSION_TTL_MS = 20 * 60 * 1000 // 20 นาที

function readSetCookie(headers: Headers, name: string): string {
  const raw = headers.get('set-cookie') || ''
  const regex = new RegExp(`(?:^|[,;\\s])${name}=([^;,\\s]+)`)
  const m = raw.match(regex)
  return m ? m[1] : ''
}

// ตั้งผ่าน `supabase secrets set` ได้ ถ้าไม่ตั้งจะใช้ค่า fallback (ค่าเดียวกับ Deno proxy เดิม)
const TR_USER = Deno.env.get('TRCLOUD_USERNAME') || 'don'
const TR_PASS = Deno.env.get('TRCLOUD_PASSWORD') || 'dw12345'
const TR_DEVICE = Deno.env.get('TRCLOUD_DEVICE_ID') || '0e218c475357ad43e7bcc689924d3ce6'

/** login TRCloud แล้วคืน cookie header `trcloud=<deviceId>; PHPSESSID=<sessionId>` */
async function trcloudLogin(): Promise<string> {
  const username = TR_USER
  const password = TR_PASS
  const deviceId = TR_DEVICE

  const page = await fetch(`${BASE_URL}/application/login/`, { headers: { 'User-Agent': UA } })
  await page.body?.cancel()
  const sessionId = readSetCookie(page.headers, 'PHPSESSID')
  if (!sessionId) throw new Error('Login failed: ไม่ได้รับ PHPSESSID จากหน้า login')

  const cookieHeader = `trcloud=${deviceId}; PHPSESSID=${sessionId}`
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

async function getSessionCookie(force = false): Promise<string> {
  if (!force && cachedCookie && Date.now() - cacheTime < SESSION_TTL_MS) return cachedCookie
  cachedCookie = await trcloudLogin()
  cacheTime = Date.now()
  return cachedCookie
}

function invalidateSession() {
  cachedCookie = ''
  cacheTime = 0
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url)
  // Supabase mount path = /functions/v1/trcloud-proxy → ตัด prefix ออกเหลือ path ภายใน
  const path = url.pathname.replace(/^\/functions\/v1\/trcloud-proxy/, '').replace(/^\/trcloud-proxy/, '')

  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: CORS_HEADERS })
  }

  // health check
  if (path === '' || path === '/' || path === '/health') {
    return new Response(JSON.stringify({ ok: true, service: 'trcloud-proxy', host: 'supabase' }), {
      status: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }

  // เส้นทาง proxy: /p?path=<encoded TRCloud path>  (เลี่ยง static layer)
  //              หรือ /trcloud-api/<path>
  let trcloudPath = ''
  if (path === '/p') {
    trcloudPath = (url.searchParams.get('path') || '').replace(/^\/+/, '')
  } else if (path.startsWith('/trcloud-api/')) {
    trcloudPath = path.replace(/^\/trcloud-api\//, '') + url.search
  } else {
    return new Response('Not found', { status: 404, headers: CORS_HEADERS })
  }

  try {
    const targetUrl = `${BASE_URL}/${trcloudPath}`
    const clientCookie = (req.headers.get('x-trcloud-cookie') || '').trim()
    const rawBody = req.method === 'POST' ? await req.arrayBuffer() : undefined

    async function callTrcloud(cookie: string) {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 20000)
      try {
        const response = await fetch(targetUrl, {
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
        return {
          status: response.status,
          text: await response.text(),
          contentType: response.headers.get('content-type') || 'application/json',
        }
      } finally {
        clearTimeout(timeout)
      }
    }

    let cookie = clientCookie || await getSessionCookie()
    let result = await callTrcloud(cookie)

    // session หมดอายุ (mismatch) → login ใหม่แล้วลองอีกครั้ง
    if (!clientCookie && /mismatch|passkey/i.test(result.text)) {
      console.warn('[trcloud-proxy] mismatch — re-login & retry')
      invalidateSession()
      cookie = await getSessionCookie(true)
      result = await callTrcloud(cookie)
    }

    console.log(`[trcloud-proxy] ${req.method} ${trcloudPath} -> ${result.status}`)
    return new Response(result.text, {
      status: result.status,
      headers: { ...CORS_HEADERS, 'Content-Type': result.contentType },
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
