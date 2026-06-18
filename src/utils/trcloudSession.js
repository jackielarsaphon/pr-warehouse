const STORAGE_KEY = 'mw_trcloud_proxy_cookie'

/**
 * Cookie string สำหรับส่งผ่าน Vite dev proxy (header X-TRCloud-Cookie)
 * ไม่ควรใช้ prefix VITE_ — เก็บใน localStorage ของผู้ใช้เครื่องนั้นเท่านั้น
 */
export function getTrcloudProxyCookie() {
  if (typeof window === 'undefined') return ''
  try {
    return (localStorage.getItem(STORAGE_KEY) || '').trim()
  } catch {
    return ''
  }
}

export function setTrcloudProxyCookie(raw) {
  if (typeof window === 'undefined') return
  const v = String(raw || '').trim()
  if (v) localStorage.setItem(STORAGE_KEY, v)
  else localStorage.removeItem(STORAGE_KEY)
  window.dispatchEvent(new CustomEvent('mw-trcloud-proxy-cookie-changed'))
}

export function clearTrcloudProxyCookie() {
  setTrcloudProxyCookie('')
}

/** Header ที่ proxy อ่านแล้วแปลงเป็น Cookie ไปยัง TRCloud */
export function trcloudProxyExtraHeaders() {
  const c = getTrcloudProxyCookie()
  if (!c) return {}
  return { 'X-TRCloud-Cookie': c }
}

/**
 * สร้าง URL สำหรับเรียก TRCloud ผ่าน proxy ที่เหมาะกับ environment:
 *  - dev (ไม่มี VITE_TRCLOUD_PROXY_BASE): ใช้ path `/trcloud-api/<endpoint>` ให้ Vite dev proxy จัดการ
 *  - prod (มี proxy base = Deno Deploy): ส่ง endpoint เป็น query param `/p?path=<encoded>`
 *    เพราะ Deno Deploy ดัก request ที่ path หน้าตาเหมือนไฟล์ (เช่นลงท้าย .php) ที่ edge ก่อนถึงโค้ด —
 *    การใช้ path สั้นๆ `/p` แล้วยัด endpoint จริงไว้ใน query string จึงเลี่ยงปัญหานี้ได้
 *
 * @param {string} endpoint เช่น `/application/expense_report/api/engine-po/po_list.php`
 */
export function trcloudProxyUrl(endpoint) {
  const proxyBase = (import.meta.env.VITE_TRCLOUD_PROXY_BASE || '').trim()
  const clean = String(endpoint || '').replace(/^\/+/, '')
  if (proxyBase) {
    return `${proxyBase.replace(/\/+$/, '')}/p?path=${encodeURIComponent(clean)}`
  }
  return `/trcloud-api/${clean}`
}
