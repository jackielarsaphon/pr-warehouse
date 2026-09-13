/**
 * ตัวตนระดับ "ใบเอกสาร" — ที่เดียวของทั้งระบบ
 * ────────────────────────────────────────────────────────────────────────────
 * 🔴 ทำไมต้องมีไฟล์นี้
 *
 * ตัวซิงก์ (stores/trcloud.js) ตั้งกุญแจ `unique_id` ไม่เท่ากันตามชนิดเอกสาร:
 *     po / ap  →  it.item_id   ⇒ **1 แถว = 1 บรรทัดสินค้า**
 *     pr / pv  →  pr_id / payment_id / document_number ⇒ 1 แถว = 1 ใบ
 *
 * หน้า PO/AP เป็นหน้า "ระดับใบ" แต่เอา array ระดับบรรทัดมาวาดตรง ๆ
 * ⇒ ใบที่มี 103 บรรทัดก็โผล่ 103 แถว และ KPI ที่บวก grand_total ทุกแถว
 *   ก็บวกยอดของใบเดียวซ้ำ 103 ครั้ง
 *
 * วัดจริง 13 ก.ย. 2026 จากฐาน Supabase:
 *     PO  3,646 แถว → ใบจริง 1,374 ใบ · ยอดโชว์ 11,039,681,037 → จริง 4,143,832,628 (เฟ้อ 2.66 เท่า)
 *     AP  3,031 แถว → ใบจริง 1,719 ใบ · ยอดโชว์ 28,612,190,274 → จริง 19,491,274,515 (เฟ้อ 1.47 เท่า)
 *     PR / PV ไม่มีปัญหา (เก็บระดับใบอยู่แล้ว)
 *
 * 🔴 ห้ามสับสนกับ `getRowIdentity()` ที่อยู่ในแต่ละหน้า
 *    ตัวนั้นคือ "ตัวตนระดับบรรทัด" (unique_id) ใช้กับระบบติดตาม (trcloud_tracking)
 *    ซึ่งเก็บ doc_key ไว้แล้วในฐาน — เปลี่ยนนิยามมันเมื่อไรของที่ติดตามไว้หลุดทันที
 *    ไฟล์นี้เพิ่ม "ตัวตนระดับใบ" เข้ามาคู่กัน ไม่ได้ไปแทนที่
 *
 * 🔴 เลขเอกสารในข้อมูลดิบ **ไม่มี prefix** — `document_number` = "26080180"
 *    ส่วน "PO" อยู่ที่ `company_format` ⇒ ใช้เป็นกุญแจให้ใช้เลขดิบ
 *    ใช้แสดงผลค่อยต่อ prefix (กติกาเดียวกับ WH_K)
 */

/** เลขเอกสารดิบ (ไม่มี prefix) — ใช้เป็นกุญแจยุบระดับใบ */
export function docNumberOf(row, type) {
  if (!row) return ''
  const s = (v) => (v === null || v === undefined ? '' : String(v).trim())
  if (type === 'ap' || type === 'expense') {
    return s(row.invoice_number || row.expense_number || row.document_number || row.doc_number || row.expense_id || row.id)
  }
  if (type === 'pv') {
    return s(row.document_number || row.doc_number || row.payment_number || row.payment_id || row.id)
  }
  // pr / po และชนิดอื่น
  return s(row.document_number || row.doc_number || row.po_id || row.pr_id || row.id)
}

/** เลขที่แสดงบนหน้าจอ (ต่อ prefix จาก company_format ถ้ามี) */
export function docLabelOf(row, type) {
  const n = docNumberOf(row, type)
  const cf = row && row.company_format ? String(row.company_format) : ''
  return cf && n && !n.startsWith(cf) ? cf + n : n
}

/**
 * ยุบแถวระดับบรรทัด → ระดับใบ
 * เก็บแถวแรกเป็นตัวแทน (ฟิลด์ระดับใบเหมือนกันทุกแถวอยู่แล้ว — ตรวจแล้วว่า
 * ที่ต่างกันมีแต่ item_id / description / price / quantity / total / product_id)
 * แล้วแนบข้อมูลบรรทัดไว้ให้ระบบติดตามใช้ต่อ:
 *     _lineCount  จำนวนบรรทัดสินค้าในใบนี้
 *     _lineIds    unique_id ของทุกบรรทัด (ใช้ติ๊กติดตามทั้งใบได้ในคลิกเดียว)
 *
 * ⚠️ ไม่รวมยอดเงินให้ เพราะ `grand_total` เป็นยอด "ทั้งใบ" อยู่แล้วในทุกแถว
 *    (ตรวจแล้ว: AP26060075 มี 100 บรรทัด บรรทัดละ 964.7 และ grand_total = 96,470
 *     = 100 × 964.7 ⇒ ถ้าบวก grand_total ทุกแถวจะได้ 100 เท่าของความจริง)
 */
export function dedupeByDoc(rows, type) {
  if (!Array.isArray(rows)) return []
  const out = []
  const idx = new Map()
  for (const r of rows) {
    if (!r) continue
    const key = docNumberOf(r, type)
    // ไม่มีเลขเอกสาร = ยุบไม่ได้อย่างปลอดภัย ปล่อยผ่านเป็นแถวเดี่ยว
    if (!key) {
      out.push({ ...r, _lineCount: 1, _lineIds: [String(r.unique_id || '')].filter(Boolean) })
      continue
    }
    const at = idx.get(key)
    const lineId = String(r.unique_id || '')
    if (at === undefined) {
      idx.set(key, out.length)
      out.push({ ...r, _lineCount: 1, _lineIds: lineId ? [lineId] : [] })
    } else {
      const head = out[at]
      head._lineCount += 1
      if (lineId) head._lineIds.push(lineId)
    }
  }
  return out
}

/** ตัวช่วยตรวจ: คืนอัตราส่วน แถว/ใบ ไว้เตือนเมื่อหน้าระดับใบได้ข้อมูลระดับบรรทัดมา */
export function docRowRatio(rows, type) {
  const n = Array.isArray(rows) ? rows.length : 0
  if (!n) return { rows: 0, docs: 0, ratio: 1 }
  const docs = dedupeByDoc(rows, type).length
  return { rows: n, docs, ratio: docs ? n / docs : 1 }
}
