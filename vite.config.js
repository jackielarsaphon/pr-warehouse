// ============================================================================
// TRCloud AUTO-LOGIN (dev proxy) — สรุปกลไกกันลืม  (รายละเอียดเต็ม: docs/TRCLOUD_AUTH.md)
// ----------------------------------------------------------------------------
// ปัญหา: session cookie (PHPSESSID/trcloud) ของ TRCloud หมดอายุบ่อย ต้อง copy ใหม่เรื่อยๆ
// ทางแก้: ให้ dev server ล็อกอินเองทุกครั้งที่ start แล้วฉีด cookie เข้า proxy
//
// กลไกล็อกอินจริงของ TRCloud (อ่านจาก JS หน้า /application/login/) มี 2 สเต็ป:
//   1) GET  /application/login/                 -> รับ PHPSESSID สด
//   2) POST /application/login/login_engine.php -> body: json={username,password,cookie,remember}
//        โดย `cookie` = ค่า cookie `trcloud` = "device id" ของเครื่องที่ TRCloud อนุมัติแล้ว
//        (เครื่องใหม่ที่ยังไม่อนุมัติจะได้ message "wait"/"block" — ต้องให้แอดมินอนุมัติก่อน)
//   => สำเร็จแล้วได้ cookie: `trcloud=<device>; PHPSESSID=<session>` เอาไปยิง API ได้
//
// หมายเหตุ: โค้ดเดิม POST ไป /application/ ตรงๆ ซึ่งไม่ใช่ endpoint จริง เลยล็อกอินไม่ผ่าน
//
// เปิดใช้งานผ่าน .env (ดู .env.example):
//   TRCLOUD_USE_LOGIN_COOKIE=true
//   TRCLOUD_USERNAME / TRCLOUD_PASSWORD
//   TRCLOUD_DEVICE_ID=<ค่า trcloud ของเครื่องที่อนุมัติแล้ว>   (ถ้าไม่ตั้ง จะ parse จาก TRCLOUD_COOKIE)
//
// proxy มี 2 กติกาสำคัญ (ดู configure ด้านล่าง):
//   - เมื่อเปิด auto-login: ใช้ session ที่ล็อกอินไว้ "ก่อนเสมอ" (กัน cookie เก่าจาก localStorage
//     ที่ client ส่งมาทาง header X-TRCloud-Cookie มาเขียนทับ -> mismatched)
//   - ไม่ให้ Set-Cookie จาก response มาเขียนทับ PHPSESSID/trcloud ของ session (sticky session)
// ============================================================================
import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'
import https from 'node:https'
import querystring from 'node:querystring'

/** Promise wrapper around https.request returning { statusCode, headers, body }. */
function httpsRequest(options, postData) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let body = ''
      res.on('data', (chunk) => (body += chunk))
      res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body }))
    })
    req.on('error', reject)
    if (postData) req.write(postData)
    req.end()
  })
}

/** Read the value of a single cookie from an array of Set-Cookie headers. */
function readSetCookie(setCookie, name) {
  const arr = setCookie || []
  for (const c of arr) {
    const [pair] = c.split(';')
    const [k, ...v] = pair.split('=')
    if (k?.trim() === name) return v.join('=')
  }
  return null
}

/**
 * Log in to TRCloud the way the real login page does:
 *  1) GET /application/login/ to obtain a fresh PHPSESSID
 *  2) POST /application/login/login_engine.php with json={username,password,cookie:<deviceId>,remember}
 * The `deviceId` is the value of the `trcloud` cookie — it identifies an *approved* computer,
 * so reuse the one already authorised in TRCLOUD_COOKIE (or TRCLOUD_DEVICE_ID).
 * Returns a cookie header string: `trcloud=<deviceId>; PHPSESSID=<sessionId>`.
 */
async function trcloudLogin(username, password, deviceId) {
  if (!username || !password) throw new Error('ต้องมี TRCLOUD_USERNAME และ TRCLOUD_PASSWORD')
  if (!deviceId) throw new Error('ต้องมี device id (ค่า trcloud) ของเครื่องที่ได้รับอนุญาต')

  const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'

  // 1) Fresh PHPSESSID from the login page
  const page = await httpsRequest({
    hostname: 'thaidrill.trcloud.co',
    path: '/application/login/',
    method: 'GET',
    headers: { 'User-Agent': ua }
  })
  const sessionId = readSetCookie(page.headers['set-cookie'], 'PHPSESSID')
  if (!sessionId) throw new Error('Login failed: ไม่ได้รับ PHPSESSID จากหน้า login')

  const cookieHeader = `trcloud=${deviceId}; PHPSESSID=${sessionId}`

  // 2) Authenticate via login_engine.php
  const postData = querystring.stringify({
    json: JSON.stringify({ username, password, cookie: deviceId, remember: 'false' })
  })
  const res = await httpsRequest(
    {
      hostname: 'thaidrill.trcloud.co',
      path: '/application/login/login_engine.php',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData),
        'X-Requested-With': 'XMLHttpRequest',
        'User-Agent': ua,
        Origin: 'https://thaidrill.trcloud.co',
        Referer: 'https://thaidrill.trcloud.co/application/login/',
        Cookie: cookieHeader
      }
    },
    postData
  )

  let data
  try {
    data = JSON.parse(res.body)
  } catch {
    throw new Error(`Login failed: ตอบกลับไม่ใช่ JSON (${res.body.slice(0, 120)})`)
  }
  if (!data.success) {
    const reason =
      data.message === 'wrong' ? 'ชื่อผู้ใช้หรือรหัสผ่านผิด'
      : data.message === 'block' ? 'เครื่องนี้ถูกบล็อก'
      : data.message === 'wait' ? `เครื่องนี้ยังไม่ได้รับอนุมัติ (device id: ${deviceId})`
      : data.message || 'unknown'
    throw new Error(`Login failed: ${reason}`)
  }

  console.log('✅ TRCloud Login สำเร็จ:', data.message)
  return cookieHeader
}

/** Merge two cookie header strings into one (later wins per key). */
function mergeCookieHeaders(a, b) {
  const cookieMap = new Map()
  ;[a, b]
    .filter(Boolean)
    .join('; ')
    .split('; ')
    .forEach((pair) => {
      const [k, ...v] = pair.split('=')
      if (k?.trim()) cookieMap.set(k.trim(), v.join('='))
    })
  return [...cookieMap.entries()].map(([k, v]) => `${k}=${v}`).join('; ')
}

export default defineConfig(async ({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const useTrcloudLoginCookie = env.TRCLOUD_USE_LOGIN_COOKIE === 'true'
  const staticCookie = (env.TRCLOUD_COOKIE || '').trim()

  // device id (ค่า cookie `trcloud`) ของเครื่องที่ TRCloud อนุมัติแล้ว — จำเป็นตอน auto-login
  const deviceId =
    (env.TRCLOUD_DEVICE_ID || '').trim() ||
    (staticCookie.match(/(?:^|;\s*)trcloud=([^;]+)/)?.[1] || '').trim()

  let trcloudCookie = staticCookie

  // ── session ที่ล็อกอินไว้ + กลไก refresh ───────────────────────────────────
  // ปัญหาเดิม: dev proxy ล็อกอินครั้งเดียวตอน start แล้วไม่ต่ออายุ พอ PHPSESSID
  // หมดอายุ (TRCloud ~ไม่กี่สิบนาที) request จะวิ่งไปด้วย session ที่หมดอายุ →
  // TRCloud มองว่า "User" (จาก session) ไม่ตรงกับ passkey → "User and Passkey are mismatched!"
  // ทางแก้: ต่ออายุ session เป็นช่วงๆ + re-login ทันทีเมื่อเจอ mismatch
  const SESSION_TTL_MS = 15 * 60 * 1000
  let lastLoginAt = 0
  let loginInFlight = null

  async function refreshSession(reason = '') {
    if (!useTrcloudLoginCookie) return trcloudCookie
    if (loginInFlight) return loginInFlight // กัน login ซ้ำพร้อมกันหลาย request
    loginInFlight = (async () => {
      try {
        const cookie = await trcloudLogin(env.TRCLOUD_USERNAME, env.TRCLOUD_PASSWORD, deviceId)
        trcloudCookie = cookie
        lastLoginAt = Date.now()
        console.log(`🍪 TRCloud session refreshed${reason ? ` (${reason})` : ''}:`, cookie.slice(0, 60) + '…')
      } catch (err) {
        console.error('❌ TRCloud Login Error:', err.message)
        if (!staticCookie) console.warn('⚠️ ไม่มี TRCLOUD_COOKIE สำรอง — proxy จะไม่ส่ง session')
      } finally {
        loginInFlight = null
      }
      return trcloudCookie
    })()
    return loginInFlight
  }

  if (useTrcloudLoginCookie) {
    await refreshSession('startup')
    // ต่ออายุเชิงรุกเป็นช่วงๆ กัน session หมดอายุระหว่างใช้งาน
    const timer = setInterval(() => refreshSession('interval'), SESSION_TTL_MS)
    if (timer.unref) timer.unref()
  } else if (staticCookie) {
    console.log('ℹ️ TRCloud proxy ใช้ TRCLOUD_COOKIE จาก .env')
  } else if (mode !== 'production') {
    console.warn('⚠️ ไม่มี TRCLOUD_COOKIE และปิด login — API อาจตอบ mismatch')
  }

  return {
    plugins: [vue()],
    base: process.env.VITE_BASE_PATH || '/pr-warehouse/',
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url))
      }
    },
    server: {
      proxy: {
        '/trcloud-api': {
          target: 'https://thaidrill.trcloud.co',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/trcloud-api/, ''),
          configure: (proxy) => {
            proxy.on('proxyRes', (proxyRes) => {
              const setCookie = proxyRes.headers['set-cookie']
              if (setCookie) {
                // อย่าให้ response เขียนทับ session ที่ล็อกอินไว้ (PHPSESSID/trcloud):
                // บาง endpoint ที่ยังไม่ auth จะคืน PHPSESSID ใหม่ที่ไม่มีสิทธิ์ ทำให้ session ดีหาย
                const newCookies = setCookie
                  .map((c) => c.split(';')[0])
                  .filter((pair) => {
                    const key = pair.split('=')[0]?.trim()
                    return key !== 'PHPSESSID' && key !== 'trcloud'
                  })
                  .join('; ')
                if (newCookies) trcloudCookie = mergeCookieHeaders(trcloudCookie, newCookies)
              }

              // ตรวจคำตอบ: ถ้า TRCloud ตอบ mismatch แปลว่า session หมดอายุ → re-login ทันที
              // (แค่สังเกต body ไม่กระทบการ pipe กลับไป client)
              if (useTrcloudLoginCookie) {
                let peek = ''
                proxyRes.on('data', (c) => {
                  if (peek.length < 2000) peek += c.toString('utf8')
                })
                proxyRes.on('end', () => {
                  if (/mismatch|passkey/i.test(peek)) {
                    console.warn('⚠️ TRCloud ตอบ "User and Passkey are mismatched" — กำลัง re-login ใหม่…')
                    refreshSession('mismatch')
                  }
                })
              }
            })

            proxy.on('proxyReq', (proxyReq, req) => {
              // ถ้า session เก่ากว่า TTL ให้ต่ออายุแบบ background (request นี้ยังใช้ของเดิมไปก่อน)
              if (useTrcloudLoginCookie && Date.now() - lastLoginAt > SESSION_TTL_MS) {
                refreshSession('stale')
              }
              proxyReq.removeHeader('cookie')
              const clientCookie = String(req.headers['x-trcloud-cookie'] || '').trim()
              proxyReq.removeHeader('x-trcloud-cookie')
              // เมื่อเปิด auto-login ให้ใช้ session ที่ล็อกอินไว้ก่อนเสมอ —
              // กัน cookie เก่าใน localStorage (X-TRCloud-Cookie) มาเขียนทับแล้วทำให้ mismatched
              const cookieToSend = useTrcloudLoginCookie
                ? (trcloudCookie || clientCookie)
                : (clientCookie || trcloudCookie)
              if (cookieToSend) {
                proxyReq.setHeader('Cookie', cookieToSend)
              }
              proxyReq.setHeader('X-Requested-With', 'XMLHttpRequest')
              proxyReq.setHeader('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)')
              proxyReq.setHeader('Origin', 'https://thaidrill.trcloud.co')
              proxyReq.setHeader('Referer', 'https://thaidrill.trcloud.co/application/')
            })
          }
        }
      }
    }
  }
})
