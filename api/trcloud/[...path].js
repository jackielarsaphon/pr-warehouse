export const config = {
  api: { bodyParser: false },
}

const BASE_URL = 'https://thaidrill.trcloud.co'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

// Module-level session cache (survives within the same function instance/warm start)
let _cachedCookie = ''
let _cacheTime = 0
const SESSION_TTL_MS = 20 * 60 * 1000 // 20 minutes

function readSetCookie(headers, name) {
  const raw = headers.get('set-cookie') || ''
  for (const part of raw.split(',')) {
    const [pair] = part.trim().split(';')
    const [k, ...v] = pair.split('=')
    if (k?.trim() === name) return v.join('=')
  }
  return ''
}

async function trcloudLogin() {
  const username = process.env.TRCLOUD_USERNAME
  const password = process.env.TRCLOUD_PASSWORD
  const deviceId = process.env.TRCLOUD_DEVICE_ID

  if (!username || !password || !deviceId) {
    throw new Error('Missing TRCLOUD_USERNAME / TRCLOUD_PASSWORD / TRCLOUD_DEVICE_ID env vars')
  }

  // 1) Get fresh PHPSESSID
  const page = await fetch(`${BASE_URL}/application/login/`, {
    headers: { 'User-Agent': UA },
  })
  const setCookieHeader = page.headers.get('set-cookie') || ''
  const sessionId = readSetCookie(page.headers, 'PHPSESSID')
  if (!sessionId) throw new Error('Login failed: no PHPSESSID from login page')

  const cookieHeader = `trcloud=${deviceId}; PHPSESSID=${sessionId}`

  // 2) Authenticate
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

  const data = await res.json().catch(() => { throw new Error('Login: response not JSON') })
  if (!data.success) {
    const reason = data.message === 'wrong' ? 'wrong username/password'
      : data.message === 'block' ? 'device blocked'
      : data.message === 'wait' ? 'device not approved yet'
      : data.message || 'unknown'
    throw new Error(`Login failed: ${reason}`)
  }

  console.log('[trcloud-proxy] Login OK:', data.message)
  return cookieHeader
}

async function getSessionCookie() {
  if (_cachedCookie && Date.now() - _cacheTime < SESSION_TTL_MS) {
    return _cachedCookie
  }
  _cachedCookie = await trcloudLogin()
  _cacheTime = Date.now()
  return _cachedCookie
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Requested-With, X-TRCloud-Cookie')

  if (req.method === 'OPTIONS') return res.status(200).end()

  try {
    const pathParts = req.query.path
    const path = Array.isArray(pathParts) ? pathParts.join('/') : (pathParts || '')
    const targetUrl = `${BASE_URL}/${path}`

    // Use client cookie if provided, otherwise auto-login
    let cookie = (req.headers['x-trcloud-cookie'] || '').trim()
    if (!cookie) {
      cookie = await getSessionCookie()
    }

    const rawBody = await new Promise((resolve, reject) => {
      const chunks = []
      req.on('data', (chunk) => chunks.push(chunk))
      req.on('end', () => resolve(Buffer.concat(chunks)))
      req.on('error', reject)
    })

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 8000)

    let response
    try {
      response = await fetch(targetUrl, {
        method: req.method,
        headers: {
          'Content-Type': req.headers['content-type'] || 'application/x-www-form-urlencoded',
          'X-Requested-With': 'XMLHttpRequest',
          'User-Agent': UA,
          'Accept': 'application/json, text/plain, */*',
          'Accept-Language': 'th,en;q=0.9',
          'Origin': BASE_URL,
          'Referer': `${BASE_URL}/application/`,
          'Cookie': cookie,
        },
        body: rawBody.length > 0 ? rawBody : undefined,
        signal: controller.signal,
        redirect: 'follow',
      })
    } finally {
      clearTimeout(timeout)
    }

    const responseText = await response.text()
    console.log(`[trcloud-proxy] ${req.method} ${path} -> ${response.status}`)
    res.setHeader('Content-Type', response.headers.get('content-type') || 'application/json')
    return res.status(response.status).send(responseText)

  } catch (err) {
    console.error('[trcloud-proxy] Error:', err.message)
    return res.status(502).json({ success: 0, message: `Proxy error: ${err.message}` })
  }
}
