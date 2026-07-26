// ============================================================================
// searchBlob — ข้อความค้นหาต่อแถว แบบคำนวณครั้งเดียวแล้วจำไว้
// ----------------------------------------------------------------------------
// ปัญหาเดิม: ตัวกรองค้นหาเขียนว่า
//     rows.filter(r => (formatDocNo(r,'AP') + ' ' + JSON.stringify(r)).toLowerCase().includes(q))
// → JSON.stringify + toLowerCase ทำงาน "ใหม่ทุกแถว ทุกครั้งที่ค่าค้นหาเปลี่ยน"
//   แถว AP หนึ่งแถวใหญ่ ~3KB → 1,300 แถว = สร้างสตริงทิ้ง ~4MB ต่อการพิมพ์หนึ่งครั้ง
//
// วิธีแก้: cache blob ไว้กับตัว object ของแถวเอง (WeakMap → เก็บ/คืนหน่วยความจำ
// อัตโนมัติเมื่อ array ถูกโหลดใหม่) ค่าค้นหาเปลี่ยนก็แค่ .includes() บนสตริงเดิม
// ============================================================================

/** WeakMap<row, { key: string, blob: string }> — จำ blob ล่าสุดของแถวนั้น */
const cache = new WeakMap()

/**
 * คืนข้อความ (lowercase) ที่ใช้ค้นหาของแถวหนึ่ง — คำนวณครั้งแรกครั้งเดียว
 * @param {object} row แถวข้อมูลดิบ
 * @param {string} [extra] ข้อความเพิ่มที่อยากให้ค้นเจอด้วย เช่นเลขที่มี prefix (AP26070148)
 */
export function rowSearchBlob(row, extra = '') {
  if (!row || typeof row !== 'object') return String(extra || '').toLowerCase()

  const key = String(extra || '')
  const hit = cache.get(row)
  if (hit && hit.key === key) return hit.blob

  let blob
  try {
    blob = `${key} ${JSON.stringify(row)}`.toLowerCase()
  } catch {
    // มี circular reference (ไม่ควรเกิดกับ payload จาก TRCloud แต่กันไว้)
    blob = key.toLowerCase()
  }
  cache.set(row, { key, blob })
  return blob
}
