// ============================================================================
// usePagination — ตัดตารางยาวเป็นหน้า ๆ (Tier C)
// ----------------------------------------------------------------------------
// ปัญหา: หน้าในกลุ่ม "ข้อมูลรายละเอียด" render ทุกแถวรวดเดียว (AP/PO ~2,500 แถว)
// → เบราว์เซอร์ต้องสร้าง DOM node หลายหมื่นตัวต่อการกรอง/ค้นหาหนึ่งครั้ง
// วิธีแก้: ให้ template วน `pagedRows` แทน source เดิม แล้ววาง <TablePager> ใต้ตาราง
//
// ใช้แบบนี้:
//   const { page, pageSize, pagedRows, total, totalPages, startIndex } =
//     usePagination(filteredRows)
// ============================================================================
import { computed, reactive, ref, watch, unref, isRef } from 'vue'

export const PAGE_SIZE_OPTIONS = [50, 100, 200, 500]
const DEFAULT_PAGE_SIZE = 100

/**
 * @param {import('vue').Ref<any[]>|(() => any[])} source แถวที่กรองแล้ว (ref/computed หรือ getter)
 * @param {{ pageSize?: number, storageKey?: string }} [opts]
 *   storageKey = จำ pageSize ที่ผู้ใช้เลือกไว้ข้ามการเปิดหน้า
 */
export function usePagination(source, opts = {}) {
  const { storageKey = '' } = opts

  const readStoredSize = () => {
    if (!storageKey) return null
    try {
      const n = parseInt(localStorage.getItem(`pager_size_${storageKey}`) || '', 10)
      return PAGE_SIZE_OPTIONS.includes(n) ? n : null
    } catch {
      return null
    }
  }

  const rows = computed(() => {
    const value = isRef(source) ? unref(source) : typeof source === 'function' ? source() : source
    return Array.isArray(value) ? value : []
  })

  const page = ref(1)
  const pageSize = ref(readStoredSize() ?? opts.pageSize ?? DEFAULT_PAGE_SIZE)

  const total = computed(() => rows.value.length)
  const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)))

  // กรอง/ค้นหาใหม่แล้วจำนวนหน้าหดลง → เด้งกลับหน้าที่ยังมีอยู่ (กันตารางว่างเปล่า)
  // จงใจ "ไม่" รีเซ็ตเป็นหน้า 1 ทุกครั้งที่ total เปลี่ยน: sync เบื้องหลังอัพเดทแถวเรื่อย ๆ
  // ถ้ารีเซ็ตตาม total ผู้ใช้ที่กำลังอ่านหน้า 5 จะถูกดีดกลับหน้า 1 เอง
  // (เคสค้นหาแล้วผลลัพธ์เหลือน้อย ตัว clamp ข้างล่างพากลับหน้าที่มีข้อมูลให้อยู่แล้ว)
  watch(totalPages, (n) => {
    if (page.value > n) page.value = n
  })

  const startIndex = computed(() => (page.value - 1) * pageSize.value)
  const pagedRows = computed(() => rows.value.slice(startIndex.value, startIndex.value + pageSize.value))

  const setPageSize = (n) => {
    const next = parseInt(n, 10)
    if (!PAGE_SIZE_OPTIONS.includes(next)) return
    pageSize.value = next
    page.value = 1
    if (storageKey) {
      try {
        localStorage.setItem(`pager_size_${storageKey}`, String(next))
      } catch {}
    }
  }

  const goTo = (n) => {
    const next = Math.min(Math.max(1, Math.trunc(Number(n) || 1)), totalPages.value)
    page.value = next
  }
  const next = () => goTo(page.value + 1)
  const prev = () => goTo(page.value - 1)

  // คืนเป็น reactive object (ไม่ใช่ก้อน ref) เพื่อให้ template เขียน `pager.pagedRows`
  // ได้ตรง ๆ — reactive() คลาย ref ให้ตอนอ่าน property จึงไม่ต้อง destructure ทุกไฟล์
  return reactive({
    page,
    pageSize,
    pagedRows,
    total,
    totalPages,
    startIndex,
    setPageSize,
    goTo,
    next,
    prev,
  })
}
