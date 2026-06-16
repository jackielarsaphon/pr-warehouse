export const config = {
  api: { bodyParser: false },
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Requested-With, X-TRCloud-Cookie')

  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }

  try {
    const pathParts = req.query.path
    const path = Array.isArray(pathParts) ? pathParts.join('/') : (pathParts || '')
    const targetUrl = `https://thaidrill.trcloud.co/${path}`

    const cookie = (req.headers['x-trcloud-cookie'] || '').trim()

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
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json, text/plain, */*',
          'Accept-Language': 'th,en;q=0.9',
          'Origin': 'https://thaidrill.trcloud.co',
          'Referer': 'https://thaidrill.trcloud.co/application/',
          ...(cookie ? { 'Cookie': cookie } : {}),
        },
        body: rawBody.length > 0 ? rawBody : undefined,
        signal: controller.signal,
        redirect: 'follow',
      })
    } finally {
      clearTimeout(timeout)
    }

    const responseText = await response.text()
    console.log(`[trcloud-proxy] ${req.method} ${path} -> ${response.status} (cookie: ${cookie ? 'yes' : 'no'})`)
    res.setHeader('Content-Type', response.headers.get('content-type') || 'application/json')
    return res.status(response.status).send(responseText)

  } catch (err) {
    console.error('[trcloud-proxy] Error:', err.message)
    return res.status(502).json({
      success: 0,
      message: `Proxy error: ${err.message}`,
    })
  }
}
