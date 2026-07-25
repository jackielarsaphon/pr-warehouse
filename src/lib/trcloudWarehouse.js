// ============================================================================
// TRCloud data warehouse — access layer สำหรับตาราง Supabase `trcloud_documents`
// ----------------------------------------------------------------------------
// flow ใหม่: TRCloud (proxy) → upsert ลง Supabase → หน้าเว็บอ่านจาก Supabase
//   • เก็บ payload ดิบทั้งก้อนไว้ที่คอลัมน์ jsonb `data` (หน้าเว็บอ่านไปใช้ตรง ๆ
//     ได้เหมือนเดิม — โครงสร้าง row ไม่เปลี่ยน)
//   • แยก `issue_date` / `unique_id` ออกมาเป็นคอลัมน์เพื่อ filter ช่วงวันที่ + กันซ้ำ
// schema: sql/2026-07-25_trcloud_warehouse.sql
// ============================================================================
import { supabase } from './supabase'

const TABLE = 'trcloud_documents'
const STATE_TABLE = 'trcloud_sync_state'
const READ_PAGE = 1000 // supabase-js คืนสูงสุด 1000 แถว/ครั้ง → ต้องวน range
const WRITE_CHUNK = 500 // upsert ทีละก้อนกัน payload ใหญ่เกิน

// โหมด mock (VITE_USE_MOCK_DB=true): mock client ไม่รองรับ .or() แบบซ้อน and()
// → อ่านทั้งชนิดแล้วค่อยกรองด้วย JS แทน
const MOCK = String(import.meta.env.VITE_USE_MOCK_DB || '').toLowerCase() === 'true'

/** normalize วันที่ให้เป็น 'YYYY-MM-DD' (หรือ null ถ้าแปลงไม่ได้) */
export function normalizeDate(raw) {
  if (!raw) return null
  const s = String(raw).trim()
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/) // YYYY-MM-DD
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/) // DD/MM/YYYY
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  return null
}

/** ดึงวันที่เอกสารจาก row (รองรับหลายชื่อฟิลด์ที่ TRCloud ใช้) */
function pickIssueDate(row) {
  return normalizeDate(
    row?.issue_date || row?.date || row?.payment_date || row?.issueDate || row?.tax_date
  )
}

/** แปลง row ดิบ → payload สำหรับ upsert ลงตาราง */
export function toDocPayload(type, row) {
  const payload = {
    doc_type: type,
    unique_id: String(row?.unique_id ?? ''),
    issue_date: pickIssueDate(row),
    data: row,
    synced_at: new Date().toISOString(),
  }
  // mock client dedupe บนคอลัมน์เดี่ยว → ใส่ key รวมให้ (ตาราง Supabase จริงไม่มีคอลัมน์นี้
  // ก็ไม่เป็นไร เพราะ onConflict จริงใช้ 'doc_type,unique_id')
  if (MOCK) payload.mock_key = `${type}::${payload.unique_id}`
  return payload
}

/** upsert เอกสารหลายแถว (กันซ้ำด้วย doc_type+unique_id) — วน chunk ให้เอง */
export async function upsertDocs(type, rows) {
  if (!Array.isArray(rows) || !rows.length) return { count: 0 }
  const payload = rows
    .map((r) => toDocPayload(type, r))
    .filter((p) => p.unique_id) // ต้องมี unique_id (เป็นส่วนหนึ่งของ PK)

  const onConflict = MOCK ? 'mock_key' : 'doc_type,unique_id'
  let count = 0
  for (let i = 0; i < payload.length; i += WRITE_CHUNK) {
    const chunk = payload.slice(i, i + WRITE_CHUNK)
    const { error } = await supabase.from(TABLE).upsert(chunk, { onConflict })
    if (error) throw new Error(`upsert ${type} ล้มเหลว: ${error.message}`)
    count += chunk.length
  }
  return { count }
}

/**
 * อ่านเอกสารช่วง [from,to] (inclusive) ของชนิดหนึ่ง
 * - คืน array ของ payload ดิบ (คอลัมน์ data) เรียงวันที่ล่าสุดก่อน
 * - รวมแถวที่ issue_date เป็น null ด้วย (เผื่อเอกสารที่ TRCloud ไม่ส่งวันที่มา)
 */
export async function loadDocs(type, from, to) {
  if (MOCK) return loadDocsMock(type, from, to)

  const out = []
  let offset = 0
  // วน range จนกว่าจะได้แถวน้อยกว่า READ_PAGE (หมดแล้ว)
  // eslint-disable-next-line no-constant-condition
  while (true) {
    let q = supabase.from(TABLE).select('data,issue_date').eq('doc_type', type)
    if (from && to) {
      q = q.or(`and(issue_date.gte.${from},issue_date.lte.${to}),issue_date.is.null`)
    } else if (from) {
      q = q.or(`issue_date.gte.${from},issue_date.is.null`)
    }
    q = q.order('issue_date', { ascending: false }).range(offset, offset + READ_PAGE - 1)

    const { data, error } = await q
    if (error) throw new Error(`โหลด ${type} จาก Supabase ล้มเหลว: ${error.message}`)
    const batch = data || []
    for (const r of batch) if (r?.data) out.push(r.data)
    if (batch.length < READ_PAGE) break
    offset += READ_PAGE
  }
  return out
}

/** เวอร์ชัน mock: ดึงทั้งชนิดแล้วกรอง+dedupe ด้วย JS (mock client ทำ or/range ซ้อนไม่ได้) */
async function loadDocsMock(type, from, to) {
  const { data, error } = await supabase.from(TABLE).select('*').eq('doc_type', type)
  if (error) throw new Error(`โหลด ${type} (mock) ล้มเหลว: ${error.message}`)
  const rows = data || []
  const byId = new Map()
  for (const r of rows) {
    const d = normalizeDate(r?.issue_date)
    const inRange = !from || !to || d === null || (d >= from && d <= to)
    if (!inRange) continue
    // เก็บอันล่าสุดต่อ unique_id (mock upsert อาจทิ้ง dup ไว้)
    byId.set(String(r?.unique_id ?? Math.random()), r?.data)
  }
  const out = [...byId.values()].filter(Boolean)
  out.sort((a, b) => String(pickIssueDate(b) || '').localeCompare(String(pickIssueDate(a) || '')))
  return out
}

/** นับจำนวนเอกสาร (ทั้งหมด หรือเฉพาะชนิด) */
export async function countDocs(type) {
  let q = supabase.from(TABLE).select('unique_id', { count: 'exact', head: true })
  if (type) q = q.eq('doc_type', type)
  const { count, error } = await q
  if (error) return 0
  return count || 0
}

/** อ่านสถานะ sync (แถว id=1) */
export async function getSyncState() {
  const { data, error } = await supabase
    .from(STATE_TABLE)
    .select('*')
    .eq('id', 1)
    .maybeSingle()
  if (error) {
    console.warn('อ่าน trcloud_sync_state ไม่ได้:', error.message)
    return null
  }
  return data
}

/** อัพเดตสถานะ sync (upsert แถว id=1) */
export async function setSyncState(patch) {
  const row = { id: 1, ...patch, updated_at: new Date().toISOString() }
  const onConflict = 'id'
  const { data, error } = await supabase
    .from(STATE_TABLE)
    .upsert(row, { onConflict })
    .select()
    .maybeSingle()
  if (error) {
    console.warn('เขียน trcloud_sync_state ไม่ได้:', error.message)
    return null
  }
  return data
}
