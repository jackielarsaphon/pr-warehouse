// ============================================================================
// เลขที่เอกสารพร้อม prefix บริษัท — เช่น AP + "26030244" → "AP26030244"
// ----------------------------------------------------------------------------
// prefix มาจากฟิลด์ `company_format` ในข้อมูล TRCloud (เช่น "AP", "PV")
// ถ้าไม่มี company_format ให้ใช้ fallbackPrefix ที่ส่งมา (เช่นหน้า PO ส่ง 'PO')
// มีกันเบิ้ล prefix ให้ด้วย (ถ้าเลขขึ้นต้นด้วย prefix อยู่แล้วจะไม่เติมซ้ำ)
// ============================================================================
export function formatDocNo(row, fallbackPrefix = '') {
  if (!row) return '-'
  const prefix = String(row.company_format || fallbackPrefix || '').trim()
  const num = String(
    row.invoice_number ||
    row.document_number ||
    row.po_id ||
    row.pr_id ||
    row.pr_number ||
    row.payment_id ||
    row.expense_number ||
    row.doc_number ||
    row.expense_id ||
    row.id ||
    ''
  ).trim()
  if (!num) return '-'
  if (!prefix) return num
  // กันเบิ้ล prefix ถ้าเลขมี prefix อยู่แล้ว (เช่นข้อมูลบางแถวเก็บมาเป็น "AP26..." อยู่แล้ว)
  if (num.toUpperCase().startsWith(prefix.toUpperCase())) return num
  return `${prefix}${num}`
}
