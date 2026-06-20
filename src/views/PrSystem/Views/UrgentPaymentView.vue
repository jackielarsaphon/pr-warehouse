<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useTrcloudStore } from '@/stores/trcloud'
import { supabase } from '@/lib/supabase'

const trcloudStore = useTrcloudStore()

const TABLE = 'urgent_payment_rows'
const RATE_KEY = 'mw-urgent-payment-rates-v1'

// exchange rates
const rates = ref({ KIP: 685, USD: 32 })
const showRates = ref(false)

function loadRates() {
  try {
    const r = JSON.parse(localStorage.getItem(RATE_KEY) || '{}')
    if (r.KIP) rates.value.KIP = r.KIP
    if (r.USD) rates.value.USD = r.USD
  } catch {}
}
function saveRates() {
  localStorage.setItem(RATE_KEY, JSON.stringify(rates.value))
}

// PURCHASERS list (เหมือนกับ PrPurchaseSummaryView — ลิ้งข้อมูลร่วมกัน)
const PURCHASERS = [
  { code: 'L2304126',  name: 'สินทะสอน อินทะวง' },
  { code: 'L26022053', name: 'คำกอง แก้วมะนี' },
  { code: 'L2602022',  name: 'พอนวิไลสัก ฟองสานุวง' },
  { code: 'L2605038',  name: 'เกียงสะไหม ไชยะพูมี' },
  { code: 'L2606013',  name: 'เจียง' },
  { code: 'L2509101',  name: 'ลัดสะหมี ลาดสะบันดิด' },
]
const PURCHASER_NAMES = PURCHASERS.map(p => p.name)

// staff ผู้ลงข้อมูล
const STAFF_LIST = ['Sone', 'Tam', 'Over', 'Tey', 'Chieng', 'LUCK', 'toey', 'lucky', 'chieng']
// STATUS: สถานะรับของ
const STATUS_LIST = ['ตามของ', 'ได้รับของ']

// ─── pr_purchase_tracking (shared table กับ PR Summary) ───────────────────
const PR_TRACKING_TABLE = 'pr_purchase_tracking'
const trackingMap = ref({}) // pr_key → { id, assignee }

async function loadTracking() {
  const { data } = await supabase.from(PR_TRACKING_TABLE).select('id, pr_key, assignee')
  const map = {}
  for (const row of data || []) {
    if (row.pr_key) map[row.pr_key] = { id: row.id, assignee: row.assignee || '' }
  }
  trackingMap.value = map
}

function purchaserOf(row) {
  return trackingMap.value[row.doc_number?.trim()]?.assignee || ''
}

async function savePurchaser(row, name) {
  const key = row.doc_number.trim()
  if (!key) return
  // optimistic update
  trackingMap.value = { ...trackingMap.value, [key]: { ...trackingMap.value[key], assignee: name } }
  const payload = { pr_key: key, assignee: name || null, updated_at: new Date().toISOString() }
  const existing = trackingMap.value[key]
  if (existing?.id) {
    await supabase.from(PR_TRACKING_TABLE).update(payload).eq('id', existing.id)
  } else {
    const { data } = await supabase.from(PR_TRACKING_TABLE).insert(payload).select('id').single()
    if (data?.id) trackingMap.value = { ...trackingMap.value, [key]: { id: data.id, assignee: name } }
  }
}

// row template — id เป็น UUID สำหรับ Supabase
function newRow(id) {
  return {
    id: id || crypto.randomUUID(),
    doc_number: '',
    vendor: '',
    items: '',
    cost_center: '',
    air_code: '',
    reason: '',
    due_site: '',
    due_finance: '',
    kip: '',
    thb: '',
    usd: '',
    staff: '',
    status: 'ตามของ',
    // UI only
    autofilled: false,
    searching: false,
    saving: false,
  }
}

function toDbPayload(row) {
  return {
    id: row.id,
    doc_number: row.doc_number,
    vendor: row.vendor,
    items: row.items,
    cost_center: row.cost_center,
    air_code: row.air_code,
    reason: row.reason,
    due_site: row.due_site || null,
    due_finance: row.due_finance || null,
    kip: row.kip,
    thb: row.thb,
    usd: row.usd,
    staff: row.staff,
    status: row.status,
    updated_at: new Date().toISOString(),
  }
}

const rows = ref([])
const search = ref('')
const paymentFilter = ref('all') // 'all' | 'paid' | 'unpaid'
const dbLoading = ref(false)
const dbError = ref('')

// debounce map: rowId → timeout
const saveTimers = {}

// --- Flag (สีแดง / เลื่อนขึ้นบน) ---
const FLAGGED_KEY = 'mw-urgent-payment-flagged-v1'
const flaggedIds = ref([]) // array ของ id ที่ flag (เรียงตามลำดับที่กด)

function loadFlagged() {
  try {
    const raw = localStorage.getItem(FLAGGED_KEY)
    if (raw) flaggedIds.value = JSON.parse(raw)
  } catch {}
}
function saveFlagged() {
  localStorage.setItem(FLAGGED_KEY, JSON.stringify(flaggedIds.value))
}
function isFlagged(id) { return flaggedIds.value.includes(id) }
function toggleFlag(row) {
  if (isFlagged(row.id)) {
    flaggedIds.value = flaggedIds.value.filter(id => id !== row.id)
  } else {
    flaggedIds.value = [...flaggedIds.value, row.id]
  }
  saveFlagged()
}
function unflag(id) {
  if (!isFlagged(id)) return
  flaggedIds.value = flaggedIds.value.filter(x => x !== id)
  saveFlagged()
}

async function loadRows() {
  dbLoading.value = true
  dbError.value = ''
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .order('created_at', { ascending: true })
  dbLoading.value = false
  if (error) {
    dbError.value = error.message
    return
  }
  rows.value = (data || []).map(r => ({
    ...r,
    due_site: r.due_site || '',
    due_finance: r.due_finance || '',
    status: STATUS_LIST.includes(r.status) ? r.status : 'ตามของ',
    autofilled: false,
    searching: false,
    saving: false,
  }))
}

async function addRow() {
  const row = newRow()
  rows.value.push(row)
  row.saving = true
  const { error } = await supabase.from(TABLE).insert(toDbPayload(row))
  row.saving = false
  if (error) dbError.value = error.message
}

async function deleteRow(id) {
  rows.value = rows.value.filter(r => r.id !== id)
  const { error } = await supabase.from(TABLE).delete().eq('id', id)
  if (error) dbError.value = error.message
}

function onFieldChange(row) {
  // debounce 600ms เพื่อไม่ upsert ทุก keystroke
  clearTimeout(saveTimers[row.id])
  saveTimers[row.id] = setTimeout(async () => {
    row.saving = true
    const { error } = await supabase.from(TABLE).upsert(toDbPayload(row))
    row.saving = false
    if (error) dbError.value = error.message
  }, 600)
}

// --- PV payment status ---
// PV rows have `reference` field containing the AP doc number
const paidApSet = computed(() => {
  const s = new Set()
  for (const pv of trcloudStore.pvRows) {
    const ref = String(pv.reference || '').trim()
    if (ref && ref !== '-') {
      ref.split(/[,;\s]+/).forEach(r => { if (r) s.add(r.toLowerCase()) })
    }
  }
  return s
})

function apPaymentStatus(docNumber) {
  const q = (docNumber || '').trim().toLowerCase()
  if (!q) return null
  if (paidApSet.value.has(q)) return 'จ่ายแล้ว'
  // fallback: apRows.payment_status (remain === 0 = ชำระแล้ว)
  const apRow = trcloudStore.apRows.find(r =>
    String(r.document_number || r.invoice_number || '').toLowerCase() === q
  )
  if (apRow) return apRow.payment_status === 'ชำระแล้ว' ? 'จ่ายแล้ว' : 'ยังไม่ได้จ่าย'
  return 'ยังไม่ได้จ่าย'
}

// --- AP / PO / EXP auto-fill ---

function docNumberOf(r, type) {
  if (type === 'po') return String(r.document_number || r.po_id || '').toLowerCase()
  if (type === 'exp') {
    const cf = r.company_format || ''
    const en = r.expense_number || r.invoice_number || r.doc_number || r.id || ''
    return String(cf ? `${cf}${en}` : en).toLowerCase()
  }
  // ap
  return String(r.document_number || r.invoice_number || '').toLowerCase()
}

function lookupDoc(q) {
  const needle = q.trim().toLowerCase()
  if (!needle) return null

  for (const [type, store] of [
    ['ap', trcloudStore.apRows],
    ['po', trcloudStore.poRows],
    ['exp', trcloudStore.expenseRows],
  ]) {
    const found = store.find(r => {
      const dn = docNumberOf(r, type)
      return dn === needle || dn.includes(needle) || needle.includes(dn)
    })
    if (found) return found
  }
  return null
}

async function onDocNumberInput(row) {
  const q = row.doc_number.trim()
  if (!q || q.length < 4) return
  row.searching = true

  // fetch แต่ละ type เฉพาะที่ยังไม่มีข้อมูล
  const fetches = []
  if (!trcloudStore.apRows.length) fetches.push(trcloudStore.fetchTrcloudData('ap'))
  if (!trcloudStore.poRows.length) fetches.push(trcloudStore.fetchTrcloudData('po'))
  if (!trcloudStore.expenseRows.length) fetches.push(trcloudStore.fetchTrcloudData('expense'))
  if (fetches.length) await Promise.all(fetches)

  row.searching = false
  const found = lookupDoc(q)
  if (!found) return

  row.vendor = found.organization || found.name || found.supplier || row.vendor
  row.items = found.invoice_note || found.remark || found.note || found.description || found.item_name || row.items
  row.cost_center = found.project || found.project_name || found.department || row.cost_center

  const cur = String(found.currency || found.fx || 'LAK').toUpperCase()
  const amt = parseFloat(found.grand_total || found.total || 0)
  if (amt > 0) {
    if (cur === 'LAK' || cur === 'KIP') row.kip = String(amt)
    else if (cur === 'THB') row.thb = String(amt)
    else if (cur === 'USD') row.usd = String(amt)
  }
  row.autofilled = true
  onFieldChange(row)
}

// --- Bulk paste from Excel ---
const showPasteModal = ref(false)
const pasteText = ref('')
const bulkProgress = ref({ total: 0, done: 0, running: false })

function parsePasteText(text) {
  // รองรับ copy จาก Excel: แต่ละบรรทัด = 1 เลขเอกสาร (ตัดช่องว่างและบรรทัดเปล่าออก)
  return text
    .split(/[\r\n]+/)
    .map(line => line.trim().split(/\t/)[0].trim()) // ถ้า paste มาหลาย col ให้เอาแค่ col แรก
    .filter(s => s.length >= 4)
}

async function applyFillToRow(row) {
  const q = row.doc_number.trim()
  if (!q) return
  const found = lookupDoc(q)
  if (!found) return
  row.vendor = found.organization || found.name || found.supplier || row.vendor
  row.items = found.invoice_note || found.remark || found.note || found.description || found.item_name || row.items
  row.cost_center = found.project || found.project_name || found.department || row.cost_center
  const cur = String(found.currency || found.fx || 'LAK').toUpperCase()
  const amt = parseFloat(found.grand_total || found.total || 0)
  if (amt > 0) {
    if (cur === 'LAK' || cur === 'KIP') row.kip = String(amt)
    else if (cur === 'THB') row.thb = String(amt)
    else if (cur === 'USD') row.usd = String(amt)
  }
  row.autofilled = true
}

async function confirmBulkPaste() {
  const docNumbers = parsePasteText(pasteText.value)
  if (!docNumbers.length) return

  // ตรวจสอบว่าข้อมูล TRCloud โหลดแล้วหรือยัง
  const fetches = []
  if (!trcloudStore.apRows.length) fetches.push(trcloudStore.fetchTrcloudData('ap'))
  if (!trcloudStore.poRows.length) fetches.push(trcloudStore.fetchTrcloudData('po'))
  if (!trcloudStore.expenseRows.length) fetches.push(trcloudStore.fetchTrcloudData('expense'))
  if (fetches.length) await Promise.all(fetches)

  showPasteModal.value = false
  pasteText.value = ''

  bulkProgress.value = { total: docNumbers.length, done: 0, running: true }

  // สร้างแถวและ insert ทีละรายการ (sequential เพื่อไม่ flood Supabase)
  for (const dn of docNumbers) {
    const row = newRow()
    row.doc_number = dn
    row.searching = true
    rows.value.push(row)

    await applyFillToRow(row)
    row.searching = false
    row.saving = true

    const { error } = await supabase.from(TABLE).insert(toDbPayload(row))
    row.saving = false
    if (error) dbError.value = error.message

    bulkProgress.value.done++
  }
  bulkProgress.value.running = false
}

// ประมาณการ THB per row
function estimatedThb(row) {
  const kip = parseFloat(row.kip || 0)
  const thb = parseFloat(row.thb || 0)
  const usd = parseFloat(row.usd || 0)
  const total = (kip / rates.value.KIP) + thb + (usd * rates.value.USD)
  if (!total) return ''
  return total.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// --- Column filter (Excel-style dropdown) ---
const columnFilters = ref({})       // { vendor: 'ABC', staff: 'Sone', ... }
const openDropdownCol = ref(null)   // column key ที่ dropdown กำลังเปิดอยู่
const dropdownPos = ref({ top: 0, left: 0 })

function toggleDropdown(col, event) {
  if (openDropdownCol.value === col) { openDropdownCol.value = null; return }
  const rect = event.currentTarget.getBoundingClientRect()
  dropdownPos.value = { top: rect.bottom + 4, left: rect.left }
  openDropdownCol.value = col
}
function closeDropdown() { openDropdownCol.value = null }

function setColumnFilter(col, val) {
  if (val === null) {
    const f = { ...columnFilters.value }
    delete f[col]
    columnFilters.value = f
  } else {
    columnFilters.value = { ...columnFilters.value, [col]: val }
  }
  closeDropdown()
}

function clearAllFilters() {
  columnFilters.value = {}
  paymentFilter.value = 'all'
  search.value = ''
  closeDropdown()
}

const hasActiveFilters = computed(() =>
  Object.keys(columnFilters.value).length > 0 ||
  paymentFilter.value !== 'all' ||
  search.value.trim() !== ''
)

function uniqueValuesFor(col) {
  const vals = new Set()
  for (const r of rows.value) {
    let v
    if (col === '_payment') v = r.doc_number.trim() ? apPaymentStatus(r.doc_number) : ''
    else if (col === '_purchaser') v = purchaserOf(r)
    else v = String(r[col] || '').trim()
    if (v) vals.add(v)
  }
  return [...vals].sort()
}

// filtered rows (search + payment filter + column filters)
const filteredRows = computed(() => {
  let result = rows.value
  const q = search.value.trim().toLowerCase()
  if (q) {
    result = result.filter(r =>
      [r.doc_number, r.vendor, r.items, r.cost_center, r.air_code, r.reason, r.staff, r.status]
        .join(' ').toLowerCase().includes(q)
    )
  }
  if (paymentFilter.value === 'paid') {
    result = result.filter(r => apPaymentStatus(r.doc_number) === 'จ่ายแล้ว')
  } else if (paymentFilter.value === 'unpaid') {
    result = result.filter(r => apPaymentStatus(r.doc_number) !== 'จ่ายแล้ว')
  }
  // column filters
  for (const [col, val] of Object.entries(columnFilters.value)) {
    if (!val) continue
    result = result.filter(r => {
      if (col === '_payment') return apPaymentStatus(r.doc_number) === val
      if (col === '_purchaser') return purchaserOf(r) === val
      return String(r[col] || '').trim() === val
    })
  }
  return result
})

// grand total
const grandTotalThb = computed(() => {
  let t = 0
  for (const r of filteredRows.value) {
    t += (parseFloat(r.kip || 0) / rates.value.KIP) + parseFloat(r.thb || 0) + (parseFloat(r.usd || 0) * rates.value.USD)
  }
  return t
})

// payment summary counts (over all rows, not filtered)
const paymentCounts = computed(() => {
  let paid = 0, unpaid = 0
  for (const r of rows.value) {
    if (!r.doc_number.trim()) continue
    if (apPaymentStatus(r.doc_number) === 'จ่ายแล้ว') paid++
    else unpaid++
  }
  return { paid, unpaid, all: rows.value.length }
})

// sortedRows: flagged rows first (ตามลำดับที่กด), ตามด้วยปกติ
const sortedRows = computed(() => {
  const flagged = filteredRows.value.filter(r => isFlagged(r.id))
  const normal = filteredRows.value.filter(r => !isFlagged(r.id))
  flagged.sort((a, b) => flaggedIds.value.indexOf(a.id) - flaggedIds.value.indexOf(b.id))
  return [...flagged, ...normal]
})

// เมื่อเปลี่ยนสถานะรับของเป็น "ได้รับของ" → auto-unflag
function onStatusChange(row) {
  if (row.status === 'ได้รับของ') unflag(row.id)
  onFieldChange(row)
}

onMounted(() => {
  loadRates()
  loadFlagged()
  loadRows()
  loadTracking()
  if (!trcloudStore.apRows.length) trcloudStore.fetchTrcloudData('ap')
  if (!trcloudStore.poRows.length) trcloudStore.fetchTrcloudData('po')
  if (!trcloudStore.expenseRows.length) trcloudStore.fetchTrcloudData('expense')
  if (!trcloudStore.pvRows.length) trcloudStore.fetchTrcloudData('pv')
})

// ล้าง debounce timers เมื่อ unmount
onUnmounted(() => {
  Object.values(saveTimers).forEach(clearTimeout)
})
</script>

<template>
  <div class="flex flex-col h-full gap-4">

    <!-- Header -->
    <div class="flex items-center justify-between flex-wrap gap-3">
      <div>
        <h1 class="text-[20px] font-semibold" style="color: var(--color-text-primary)">
          <i class="fa-solid fa-bolt mr-2 text-orange-500"></i>สรุปขอจ่ายด่วน
        </h1>
        <p class="text-[13px] mt-0.5" style="color: var(--color-text-muted)">
          บันทึกรายการ AP/PO/EXP ที่ขอจ่ายเงินด่วน — กรอกเลขเอกสารแล้วระบบดึงรายละเอียดให้อัตโนมัติ
        </p>
      </div>
      <div class="flex items-center gap-2 flex-wrap">
        <button
          @click="showRates = !showRates"
          class="px-3 py-1.5 rounded-lg text-[12px] font-medium border transition"
          style="border-color: var(--color-border); color: var(--color-text-muted); background: var(--color-bg-card)"
        >
          <i class="fa-solid fa-coins mr-1 text-yellow-500"></i>อัตราแลก
        </button>
        <div class="relative">
          <i class="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-[12px]" style="color: var(--color-text-muted)"></i>
          <input
            v-model="search"
            type="text"
            placeholder="ค้นหา..."
            class="pl-8 pr-3 py-1.5 rounded-lg text-[12px] border focus:outline-none w-44"
            style="border-color: var(--color-border); background: var(--color-bg-card); color: var(--color-text-primary)"
          />
        </div>
        <button
          v-if="hasActiveFilters"
          @click="clearAllFilters"
          class="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-[13px] font-semibold border border-red-300 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition"
          style="background: var(--color-bg-card)"
        >
          <i class="fa-solid fa-filter-circle-xmark"></i> ยกเลิก filter
        </button>
        <button
          @click="showPasteModal = true"
          class="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-[13px] font-semibold border transition"
          style="border-color: var(--color-border); color: var(--color-text-primary); background: var(--color-bg-card)"
        >
          <i class="fa-solid fa-file-excel text-green-600"></i> วางจาก Excel
        </button>
        <button
          @click="addRow"
          class="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-[13px] font-semibold bg-blue-600 text-white hover:bg-blue-700 transition"
        >
          <i class="fa-solid fa-plus"></i> เพิ่มรายการ
        </button>
      </div>
    </div>

    <!-- อัตราแลก panel -->
    <div v-if="showRates" class="flex items-center gap-4 px-4 py-3 rounded-xl border text-[12px]" style="background: var(--color-bg-card); border-color: var(--color-border)">
      <span class="font-semibold" style="color: var(--color-text-primary)"><i class="fa-solid fa-coins mr-1 text-yellow-500"></i>อัตราแลกเปลี่ยน (เป็น THB)</span>
      <label class="flex items-center gap-1.5" style="color: var(--color-text-muted)">
        1 THB =
        <input v-model.number="rates.KIP" @change="saveRates" type="number" class="w-20 px-2 py-1 rounded border focus:outline-none text-center" style="border-color: var(--color-border); background: var(--color-bg-card); color: var(--color-text-primary)" />
        KIP
      </label>
      <label class="flex items-center gap-1.5" style="color: var(--color-text-muted)">
        1 USD =
        <input v-model.number="rates.USD" @change="saveRates" type="number" class="w-16 px-2 py-1 rounded border focus:outline-none text-center" style="border-color: var(--color-border); background: var(--color-bg-card); color: var(--color-text-primary)" />
        THB
      </label>
      <span style="color: var(--color-text-muted)">ประมาณ THB = KIP÷{{ rates.KIP }} + THB + USD×{{ rates.USD }}</span>
    </div>

    <!-- Filter + stats bar -->
    <div class="flex items-center gap-3 flex-wrap">
      <!-- payment filter buttons -->
      <div class="flex items-center rounded-xl overflow-hidden border text-[12px] font-medium" style="border-color: var(--color-border)">
        <button
          @click="paymentFilter = 'all'"
          class="px-4 py-2 transition"
          :style="{
            background: paymentFilter === 'all' ? '#3b82f6' : 'var(--color-bg-card)',
            color: paymentFilter === 'all' ? '#fff' : 'var(--color-text-muted)'
          }"
        >
          ทั้งหมด
          <span class="ml-1.5 font-mono text-[11px] opacity-75">{{ paymentCounts.all }}</span>
        </button>
        <button
          @click="paymentFilter = 'paid'"
          class="px-4 py-2 border-l transition"
          :style="{
            borderColor: 'var(--color-border)',
            background: paymentFilter === 'paid' ? '#10b981' : 'var(--color-bg-card)',
            color: paymentFilter === 'paid' ? '#fff' : '#10b981'
          }"
        >
          จ่ายแล้ว
          <span class="ml-1.5 font-mono text-[11px] opacity-75">{{ paymentCounts.paid }}</span>
        </button>
        <button
          @click="paymentFilter = 'unpaid'"
          class="px-4 py-2 border-l transition"
          :style="{
            borderColor: 'var(--color-border)',
            background: paymentFilter === 'unpaid' ? '#f59e0b' : 'var(--color-bg-card)',
            color: paymentFilter === 'unpaid' ? '#fff' : '#f59e0b'
          }"
        >
          ยังไม่ได้จ่าย
          <span class="ml-1.5 font-mono text-[11px] opacity-75">{{ paymentCounts.unpaid }}</span>
        </button>
      </div>

      <!-- grand total -->
      <div v-if="rows.length" class="flex items-center gap-3 px-4 py-2 rounded-xl border text-[12px] ml-auto" style="background: var(--color-bg-card); border-color: var(--color-border)">
        <span style="color: var(--color-text-muted)">แสดง <b style="color: var(--color-text-primary)">{{ filteredRows.length }}</b> รายการ</span>
        <span class="font-semibold" style="color: var(--color-text-primary)">
          รวม:
          <span class="text-green-600 dark:text-green-400 font-mono ml-1">
            ฿{{ grandTotalThb.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }}
          </span>
        </span>
      </div>
    </div>

    <!-- DB error -->
    <div v-if="dbError" class="flex items-center gap-3 px-4 py-2.5 rounded-xl border border-red-300 bg-red-50 dark:bg-red-900/20 text-[12px] text-red-600">
      <i class="fa-solid fa-triangle-exclamation"></i>
      <span>{{ dbError }}</span>
      <button @click="dbError = ''" class="ml-auto text-red-400 hover:text-red-600"><i class="fa-solid fa-xmark"></i></button>
    </div>

    <!-- Table -->
    <div class="flex-1 min-h-0 rounded-xl border overflow-hidden" style="background: var(--color-bg-card); border-color: var(--color-border)">
      <div class="overflow-auto h-full">
        <table class="w-full text-[12px] border-collapse min-w-[1700px]">
          <thead class="sticky top-0 z-10" style="background: var(--color-bg-body); border-bottom: 2px solid var(--color-border)">
            <tr>
              <th class="px-2 py-3 text-left font-semibold w-10" style="color: var(--color-text-muted)">#</th>
              <th class="px-3 py-3 text-left font-semibold whitespace-nowrap" style="color: var(--color-text-muted)">เลขที่เอกสาร</th>

              <!-- ร้านค้า -->
              <th class="px-3 py-3 text-left font-semibold whitespace-nowrap">
                <button @click="toggleDropdown('vendor', $event)"
                  class="flex items-center gap-1 group"
                  :style="{ color: columnFilters.vendor ? '#3b82f6' : 'var(--color-text-muted)' }">
                  ร้านค้า
                  <i class="fa-solid fa-chevron-down text-[9px] opacity-60 group-hover:opacity-100 transition"
                    :class="columnFilters.vendor ? 'text-blue-500' : ''"></i>
                  <span v-if="columnFilters.vendor" class="text-[10px] text-blue-500 font-normal ml-0.5">({{ columnFilters.vendor }})</span>
                </button>
              </th>

              <th class="px-3 py-3 text-left font-semibold" style="color: var(--color-text-muted)">รายการ</th>

              <!-- Cost Center -->
              <th class="px-3 py-3 text-left font-semibold whitespace-nowrap">
                <button @click="toggleDropdown('cost_center', $event)"
                  class="flex items-center gap-1 group"
                  :style="{ color: columnFilters.cost_center ? '#3b82f6' : 'var(--color-text-muted)' }">
                  Cost Center
                  <i class="fa-solid fa-chevron-down text-[9px] opacity-60 group-hover:opacity-100 transition"
                    :class="columnFilters.cost_center ? 'text-blue-500' : ''"></i>
                  <span v-if="columnFilters.cost_center" class="text-[10px] text-blue-500 font-normal ml-0.5">({{ columnFilters.cost_center }})</span>
                </button>
              </th>

              <!-- Air Code -->
              <th class="px-3 py-3 text-left font-semibold whitespace-nowrap">
                <button @click="toggleDropdown('air_code', $event)"
                  class="flex items-center gap-1 group"
                  :style="{ color: columnFilters.air_code ? '#3b82f6' : 'var(--color-text-muted)' }">
                  Air Code
                  <i class="fa-solid fa-chevron-down text-[9px] opacity-60 group-hover:opacity-100 transition"
                    :class="columnFilters.air_code ? 'text-blue-500' : ''"></i>
                </button>
              </th>

              <th class="px-3 py-3 text-left font-semibold" style="color: var(--color-text-muted)">เหตุผล</th>
              <th class="px-3 py-3 text-center font-semibold whitespace-nowrap" style="color: var(--color-text-muted)">กำหนดชำระ<br/><span class="font-normal text-[10px]">(หน้างาน)</span></th>
              <th class="px-3 py-3 text-center font-semibold whitespace-nowrap" style="color: var(--color-text-muted)">การเงิน</th>
              <th class="px-3 py-3 text-right font-semibold whitespace-nowrap text-amber-600" style="border-left: 1px solid var(--color-border)"># KIP</th>
              <th class="px-3 py-3 text-right font-semibold whitespace-nowrap text-green-600"># THB</th>
              <th class="px-3 py-3 text-right font-semibold whitespace-nowrap text-blue-600"># USD</th>

              <!-- ผู้ลงข้อมูล -->
              <th class="px-3 py-3 text-left font-semibold whitespace-nowrap" style="border-left: 1px solid var(--color-border)">
                <button @click="toggleDropdown('staff', $event)"
                  class="flex items-center gap-1 group"
                  :style="{ color: columnFilters.staff ? '#3b82f6' : 'var(--color-text-muted)' }">
                  ผู้ลงข้อมูล
                  <i class="fa-solid fa-chevron-down text-[9px] opacity-60 group-hover:opacity-100 transition"></i>
                  <span v-if="columnFilters.staff" class="text-[10px] text-blue-500 font-normal ml-0.5">({{ columnFilters.staff }})</span>
                </button>
              </th>

              <!-- ผู้จัดซื้อ (ลิ้งกับ PR Summary) -->
              <th class="px-3 py-3 text-left font-semibold whitespace-nowrap">
                <button @click="toggleDropdown('_purchaser', $event)"
                  class="flex items-center gap-1 group"
                  :style="{ color: columnFilters._purchaser ? '#3b82f6' : 'var(--color-text-muted)' }">
                  ผู้จัดซื้อ
                  <i class="fa-solid fa-chevron-down text-[9px] opacity-60 group-hover:opacity-100 transition"></i>
                  <span v-if="columnFilters._purchaser" class="text-[10px] text-blue-500 font-normal ml-0.5">({{ columnFilters._purchaser }})</span>
                </button>
              </th>

              <!-- สถานะ -->
              <th class="px-3 py-3 text-center font-semibold whitespace-nowrap">
                <button @click="toggleDropdown('status', $event)"
                  class="flex items-center gap-1 group mx-auto"
                  :style="{ color: columnFilters.status ? '#3b82f6' : 'var(--color-text-muted)' }">
                  สถานะ
                  <i class="fa-solid fa-chevron-down text-[9px] opacity-60 group-hover:opacity-100 transition"></i>
                </button>
              </th>

              <th class="px-3 py-3 text-right font-semibold whitespace-nowrap" style="color: var(--color-text-primary)">ประมาณ THB</th>

              <!-- สถานะการจ่ายเงิน -->
              <th class="px-3 py-3 text-center font-semibold whitespace-nowrap" style="border-left: 1px solid var(--color-border)">
                <button @click="toggleDropdown('_payment', $event)"
                  class="flex items-center gap-1 group mx-auto"
                  :style="{ color: columnFilters._payment ? '#3b82f6' : 'var(--color-text-muted)' }">
                  สถานะการจ่ายเงิน
                  <i class="fa-solid fa-chevron-down text-[9px] opacity-60 group-hover:opacity-100 transition"></i>
                </button>
              </th>

              <th class="px-2 py-3 w-8"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="dbLoading">
              <td colspan="17" class="px-4 py-16 text-center">
                <i class="fa-solid fa-circle-notch fa-spin text-2xl text-blue-500 mb-3 block"></i>
                <span class="text-[13px]" style="color: var(--color-text-muted)">กำลังโหลดข้อมูลจาก Supabase...</span>
              </td>
            </tr>
            <tr v-else-if="!filteredRows.length">
              <td colspan="18" class="px-4 py-16 text-center" style="color: var(--color-text-muted)">
                <i class="fa-solid fa-table-list text-3xl mb-3 opacity-20 block"></i>
                <p class="text-[13px]">ยังไม่มีรายการ — กดปุ่ม <b class="text-blue-500">+ เพิ่มรายการ</b> เพื่อเริ่มบันทึก</p>
              </td>
            </tr>

            <tr
              v-for="(row, idx) in sortedRows"
              :key="row.id"
              class="transition-all align-top"
              :style="{
                borderBottom: '1px solid var(--color-border)',
                borderLeft: isFlagged(row.id) ? '3px solid #ef4444' : '3px solid transparent',
                background: isFlagged(row.id) ? 'rgba(239,68,68,0.05)' : (row.autofilled ? 'rgba(59,130,246,0.03)' : ''),
              }"
            >
              <!-- # — คลิกเพื่อ flag/unflag -->
              <td class="px-2 py-2.5 text-center text-[11px] cursor-pointer select-none" @click="toggleFlag(row)" title="กดเพื่อ mark ด่วน">
                <i v-if="row.saving" class="fa-solid fa-circle-notch fa-spin text-blue-400"></i>
                <span v-else
                  class="inline-flex items-center justify-center w-6 h-6 rounded-full font-bold transition-all"
                  :style="isFlagged(row.id)
                    ? { background: '#ef4444', color: '#fff', boxShadow: '0 0 0 2px rgba(239,68,68,0.3)' }
                    : { color: 'var(--color-text-muted)' }">
                  {{ idx + 1 }}
                </span>
              </td>

              <!-- เลขที่เอกสาร -->
              <td class="px-2 py-2 whitespace-nowrap">
                <div class="relative">
                  <input
                    v-model="row.doc_number"
                    @blur="onDocNumberInput(row)"
                    @keyup.enter="onDocNumberInput(row)"
                    type="text"
                    placeholder="AP26060xxx"
                    class="w-36 px-2 py-1.5 rounded-lg border focus:outline-none focus:ring-1 focus:ring-blue-400 font-mono text-[12px]"
                    style="background: var(--color-bg-card); color: var(--color-text-primary)"
                    :style="{ borderColor: row.autofilled ? '#22c55e' : 'var(--color-border)' }"
                  />
                  <i v-if="row.searching" class="fa-solid fa-circle-notch fa-spin absolute right-2 top-1/2 -translate-y-1/2 text-blue-500 text-[11px]"></i>
                  <i v-else-if="row.autofilled" class="fa-solid fa-check absolute right-2 top-1/2 -translate-y-1/2 text-green-500 text-[11px]"></i>
                </div>
              </td>

              <!-- ร้านค้า -->
              <td class="px-2 py-2">
                <input v-model="row.vendor" @change="onFieldChange(row)" type="text" placeholder="ชื่อร้านค้า"
                  class="w-44 px-2 py-1.5 rounded-lg border focus:outline-none focus:ring-1 focus:ring-blue-400 text-[12px]"
                  style="border-color: var(--color-border); background: var(--color-bg-card); color: var(--color-text-primary)" />
              </td>

              <!-- รายการ -->
              <td class="px-2 py-2">
                <textarea v-model="row.items" @change="onFieldChange(row)" placeholder="รายการสินค้า" rows="2"
                  class="w-52 px-2 py-1.5 rounded-lg border focus:outline-none focus:ring-1 focus:ring-blue-400 text-[12px] resize-none"
                  style="border-color: var(--color-border); background: var(--color-bg-card); color: var(--color-text-primary)" />
              </td>

              <!-- Cost Center -->
              <td class="px-2 py-2">
                <input v-model="row.cost_center" @change="onFieldChange(row)" type="text" placeholder="โครงการ"
                  class="w-32 px-2 py-1.5 rounded-lg border focus:outline-none focus:ring-1 focus:ring-blue-400 text-[12px]"
                  style="border-color: var(--color-border); background: var(--color-bg-card); color: var(--color-text-primary)" />
              </td>

              <!-- Air Code -->
              <td class="px-2 py-2">
                <input v-model="row.air_code" @change="onFieldChange(row)" type="text" placeholder="E-xxx"
                  class="w-24 px-2 py-1.5 rounded-lg border focus:outline-none focus:ring-1 focus:ring-blue-400 text-[12px] font-mono"
                  style="border-color: var(--color-border); background: var(--color-bg-card); color: var(--color-text-primary)" />
              </td>

              <!-- เหตุผล -->
              <td class="px-2 py-2">
                <textarea v-model="row.reason" @change="onFieldChange(row)" placeholder="เหตุผลที่ขอจ่าย" rows="2"
                  class="w-48 px-2 py-1.5 rounded-lg border focus:outline-none focus:ring-1 focus:ring-blue-400 text-[12px] resize-none"
                  style="border-color: var(--color-border); background: var(--color-bg-card); color: var(--color-text-primary)" />
              </td>

              <!-- กำหนดชำระ หน้างาน -->
              <td class="px-2 py-2 text-center">
                <input v-model="row.due_site" @change="onFieldChange(row)" type="date"
                  class="px-2 py-1.5 rounded-lg border focus:outline-none focus:ring-1 focus:ring-blue-400 text-[12px]"
                  style="border-color: var(--color-border); background: var(--color-bg-card); color: var(--color-text-primary)" />
              </td>

              <!-- การเงิน -->
              <td class="px-2 py-2 text-center">
                <input v-model="row.due_finance" @change="onFieldChange(row)" type="date"
                  class="px-2 py-1.5 rounded-lg border focus:outline-none focus:ring-1 focus:ring-blue-400 text-[12px]"
                  style="border-color: var(--color-border); background: var(--color-bg-card); color: var(--color-text-primary)" />
              </td>

              <!-- # KIP -->
              <td class="px-2 py-2 text-right" style="border-left: 1px solid var(--color-border)">
                <input v-model="row.kip" @change="onFieldChange(row)" type="text" placeholder="₭0"
                  class="w-28 px-2 py-1.5 rounded-lg border focus:outline-none focus:ring-1 focus:ring-amber-400 text-[12px] text-right font-mono"
                  style="border-color: var(--color-border); background: var(--color-bg-card); color: var(--color-text-primary)" />
              </td>

              <!-- # THB -->
              <td class="px-2 py-2 text-right">
                <input v-model="row.thb" @change="onFieldChange(row)" type="text" placeholder="฿0"
                  class="w-28 px-2 py-1.5 rounded-lg border focus:outline-none focus:ring-1 focus:ring-green-400 text-[12px] text-right font-mono"
                  style="border-color: var(--color-border); background: var(--color-bg-card); color: var(--color-text-primary)" />
              </td>

              <!-- # USD -->
              <td class="px-2 py-2 text-right">
                <input v-model="row.usd" @change="onFieldChange(row)" type="text" placeholder="$0"
                  class="w-24 px-2 py-1.5 rounded-lg border focus:outline-none focus:ring-1 focus:ring-blue-400 text-[12px] text-right font-mono"
                  style="border-color: var(--color-border); background: var(--color-bg-card); color: var(--color-text-primary)" />
              </td>

              <!-- ผู้ลงข้อมูล -->
              <td class="px-2 py-2" style="border-left: 1px solid var(--color-border)">
                <select v-model="row.staff" @change="onFieldChange(row)"
                  class="px-2 py-1.5 rounded-lg border focus:outline-none text-[12px] w-28"
                  style="border-color: var(--color-border); background: var(--color-bg-card); color: var(--color-text-primary)">
                  <option value="">— เลือก —</option>
                  <option v-for="s in STAFF_LIST" :key="s" :value="s">{{ s }}</option>
                </select>
              </td>

              <!-- ผู้จัดซื้อ (ลิ้งกับ PR Summary ผ่าน pr_purchase_tracking) -->
              <td class="px-2 py-2">
                <select
                  :value="purchaserOf(row)"
                  @change="savePurchaser(row, $event.target.value)"
                  class="px-2 py-1.5 rounded-lg border focus:outline-none text-[12px] w-40"
                  :style="{
                    borderColor: purchaserOf(row) ? '#8b5cf6' : 'var(--color-border)',
                    background: 'var(--color-bg-card)',
                    color: purchaserOf(row) ? '#8b5cf6' : 'var(--color-text-muted)',
                    fontWeight: purchaserOf(row) ? '600' : '400',
                  }">
                  <option value="">— เลือก —</option>
                  <option v-for="p in PURCHASERS" :key="p.code" :value="p.name">{{ p.name }}</option>
                </select>
              </td>

              <!-- สถานะ (รับของ) -->
              <td class="px-2 py-2 text-center">
                <select v-model="row.status" @change="onStatusChange(row)"
                  class="px-2 py-1.5 rounded-lg border focus:outline-none text-[12px] w-28 font-semibold"
                  :style="{
                    borderColor: row.status === 'ได้รับของ' ? '#22c55e' : '#f59e0b',
                    background: 'var(--color-bg-card)',
                    color: row.status === 'ได้รับของ' ? '#22c55e' : '#f59e0b',
                  }">
                  <option v-for="s in STATUS_LIST" :key="s" :value="s">{{ s }}</option>
                </select>
              </td>

              <!-- ประมาณ THB -->
              <td class="px-3 py-2 text-right whitespace-nowrap font-mono font-semibold">
                <span v-if="estimatedThb(row)" class="text-green-600 dark:text-green-400">฿{{ estimatedThb(row) }}</span>
                <span v-else class="text-[11px]" style="color: var(--color-text-muted)">—</span>
              </td>

              <!-- สถานะการจ่ายเงิน -->
              <td class="px-3 py-2 text-center whitespace-nowrap" style="border-left: 1px solid var(--color-border)">
                <template v-if="row.doc_number.trim()">
                  <span
                    class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold border"
                    :style="apPaymentStatus(row.doc_number) === 'จ่ายแล้ว'
                      ? { background: 'rgba(16,185,129,0.1)', color: '#10b981', borderColor: 'rgba(16,185,129,0.3)' }
                      : { background: 'rgba(245,158,11,0.1)', color: '#f59e0b', borderColor: 'rgba(245,158,11,0.3)' }"
                  >
                    <i :class="apPaymentStatus(row.doc_number) === 'จ่ายแล้ว' ? 'fa-solid fa-circle-check' : 'fa-solid fa-clock'"></i>
                    {{ apPaymentStatus(row.doc_number) }}
                  </span>
                </template>
                <span v-else class="text-[11px]" style="color: var(--color-text-muted)">—</span>
              </td>

              <!-- delete -->
              <td class="px-2 py-2 text-center">
                <button @click="deleteRow(row.id)"
                  class="w-7 h-7 flex items-center justify-center rounded-lg text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-600 transition">
                  <i class="fa-solid fa-trash text-[11px]"></i>
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Bulk progress bar -->
    <div v-if="bulkProgress.running || bulkProgress.done > 0 && bulkProgress.done < bulkProgress.total"
      class="flex items-center gap-3 px-4 py-2.5 rounded-xl border text-[12px]"
      style="background: var(--color-bg-card); border-color: var(--color-border)">
      <i class="fa-solid fa-circle-notch fa-spin text-blue-500"></i>
      <span style="color: var(--color-text-muted)">กำลัง auto-fill...</span>
      <div class="flex-1 rounded-full overflow-hidden h-2" style="background: var(--color-border)">
        <div class="h-2 bg-blue-500 transition-all"
          :style="{ width: bulkProgress.total ? (bulkProgress.done / bulkProgress.total * 100) + '%' : '0%' }"></div>
      </div>
      <span class="font-mono font-semibold" style="color: var(--color-text-primary)">
        {{ bulkProgress.done }} / {{ bulkProgress.total }}
      </span>
    </div>

    <!-- Add row shortcut at bottom -->
    <button @click="addRow"
      class="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl border-2 border-dashed text-[13px] font-medium transition hover:border-blue-400 hover:text-blue-500"
      style="border-color: var(--color-border); color: var(--color-text-muted)">
      <i class="fa-solid fa-plus"></i> เพิ่มรายการใหม่
    </button>

  </div>

  <!-- Column filter dropdown (teleport to avoid overflow clip) -->
  <Teleport to="body">
    <!-- overlay คลิกนอก dropdown ให้ปิด -->
    <div v-if="openDropdownCol" class="fixed inset-0 z-[199]" @click="closeDropdown"></div>

    <div v-if="openDropdownCol"
      class="fixed z-[200] rounded-xl shadow-xl border overflow-hidden min-w-[160px] max-w-[240px]"
      :style="{ top: dropdownPos.top + 'px', left: dropdownPos.left + 'px', background: 'var(--color-bg-card)', borderColor: 'var(--color-border)' }">

      <!-- Clear filter for this col -->
      <button
        v-if="columnFilters[openDropdownCol]"
        @click="setColumnFilter(openDropdownCol, null)"
        class="w-full flex items-center gap-2 px-3 py-2 text-[12px] text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 border-b transition"
        :style="{ borderColor: 'var(--color-border)' }">
        <i class="fa-solid fa-filter-circle-xmark"></i> ล้าง filter
      </button>

      <!-- ทั้งหมด -->
      <button
        @click="setColumnFilter(openDropdownCol, null)"
        class="w-full flex items-center gap-2 px-3 py-2 text-[12px] hover:bg-blue-50 dark:hover:bg-blue-900/20 transition font-medium"
        :style="{ color: !columnFilters[openDropdownCol] ? '#3b82f6' : 'var(--color-text-muted)' }">
        <i class="fa-solid fa-list text-[10px]"></i> ทั้งหมด
      </button>

      <div class="max-h-56 overflow-y-auto">
        <button
          v-for="val in uniqueValuesFor(openDropdownCol)"
          :key="val"
          @click="setColumnFilter(openDropdownCol, val)"
          class="w-full flex items-center justify-between gap-2 px-3 py-2 text-[12px] hover:bg-blue-50 dark:hover:bg-blue-900/20 transition text-left"
          :style="{ color: columnFilters[openDropdownCol] === val ? '#3b82f6' : 'var(--color-text-primary)', fontWeight: columnFilters[openDropdownCol] === val ? '600' : '400' }">
          <span class="truncate">{{ val }}</span>
          <i v-if="columnFilters[openDropdownCol] === val" class="fa-solid fa-check text-blue-500 text-[10px] flex-shrink-0"></i>
        </button>
        <div v-if="!uniqueValuesFor(openDropdownCol).length" class="px-3 py-3 text-[12px]" style="color: var(--color-text-muted)">
          ไม่มีข้อมูล
        </div>
      </div>
    </div>
  </Teleport>

  <!-- Paste from Excel Modal -->
  <Teleport to="body">
    <div v-if="showPasteModal"
      class="fixed inset-0 z-50 flex items-center justify-center"
      style="background: rgba(0,0,0,0.45)"
      @click.self="showPasteModal = false">
      <div class="rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden"
        style="background: var(--color-bg-card); border: 1px solid var(--color-border)">

        <!-- Modal header -->
        <div class="flex items-center justify-between px-6 py-4 border-b" style="border-color: var(--color-border)">
          <div>
            <h3 class="font-semibold text-[15px]" style="color: var(--color-text-primary)">
              <i class="fa-solid fa-file-excel text-green-500 mr-2"></i>วางจาก Excel
            </h3>
            <p class="text-[12px] mt-0.5" style="color: var(--color-text-muted)">
              Copy คอลัมน์เลขเอกสาร (AP / PO / EXP) จาก Excel แล้ววางลงด้านล่าง
            </p>
          </div>
          <button @click="showPasteModal = false"
            class="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition"
            style="color: var(--color-text-muted)">
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>

        <!-- Textarea -->
        <div class="px-6 py-4">
          <textarea
            v-model="pasteText"
            placeholder="วางเลขเอกสารที่นี่ (หนึ่งบรรทัดต่อหนึ่งรายการ)&#10;ตัวอย่าง:&#10;AP26060001&#10;AP26060002&#10;PO26060015"
            rows="10"
            class="w-full px-3 py-2.5 rounded-xl border text-[13px] font-mono focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none"
            style="border-color: var(--color-border); background: var(--color-bg-body); color: var(--color-text-primary)"
          ></textarea>
          <p class="text-[11px] mt-1.5" style="color: var(--color-text-muted)">
            พบ <b style="color: var(--color-text-primary)">{{ parsePasteText(pasteText).length }}</b> รายการ
            <span v-if="parsePasteText(pasteText).length"> — ระบบจะ auto-fill จาก TRCloud ให้อัตโนมัติ</span>
          </p>
        </div>

        <!-- Actions -->
        <div class="flex items-center justify-end gap-3 px-6 py-4 border-t" style="border-color: var(--color-border)">
          <button @click="showPasteModal = false"
            class="px-4 py-2 rounded-xl text-[13px] border transition"
            style="border-color: var(--color-border); color: var(--color-text-muted); background: var(--color-bg-card)">
            ยกเลิก
          </button>
          <button
            @click="confirmBulkPaste"
            :disabled="!parsePasteText(pasteText).length"
            class="flex items-center gap-2 px-5 py-2 rounded-xl text-[13px] font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition">
            <i class="fa-solid fa-wand-magic-sparkles"></i>
            นำเข้า {{ parsePasteText(pasteText).length }} รายการ
          </button>
        </div>
      </div>
    </div>
  </Teleport>

</template>

<style scoped>
.overflow-auto::-webkit-scrollbar { width: 6px; height: 6px; }
.overflow-auto::-webkit-scrollbar-track { background: transparent; }
.overflow-auto::-webkit-scrollbar-thumb { background: rgba(156,163,175,0.3); border-radius: 10px; }
.overflow-auto::-webkit-scrollbar-thumb:hover { background: rgba(156,163,175,0.5); }
</style>
