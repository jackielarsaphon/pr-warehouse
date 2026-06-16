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

  const pathParts = req.query.path
  const path = Array.isArray(pathParts) ? pathParts.join('/') : (pathParts || '')
  const targetUrl = `https://thaidrill.trcloud.co/${path}`

  const rawBody = await new Promise((resolve) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks)))
  })

  const response = await fetch(targetUrl, {
    method: req.method,
    headers: {
      'Content-Type': req.headers['content-type'] || 'application/x-www-form-urlencoded',
      'X-Requested-With': 'XMLHttpRequest',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      'Origin': 'https://thaidrill.trcloud.co',
      'Referer': 'https://thaidrill.trcloud.co/application/',
    },
    body: rawBody.length > 0 ? rawBody : undefined,
  })

  const responseText = await response.text()
  res.setHeader('Content-Type', response.headers.get('content-type') || 'application/json')
  return res.status(response.status).send(responseText)
}
