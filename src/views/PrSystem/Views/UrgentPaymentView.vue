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

// PURCHASERS list
const STAFF_LIST = ['Sone', 'Tam', 'Over', 'Tey', 'Chieng', 'LUCK', 'toey', 'lucky', 'chieng']
// STATUS: สถานะรับของ
const STATUS_LIST = ['ตามของ', 'ได้รับของ']

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

// --- AP auto-fill ---
function lookupDoc(docNumber) {
  const q = docNumber.trim().toLowerCase()
  if (!q) return null
  const allRows = [
    ...trcloudStore.apRows,
    ...(trcloudStore.poRows || []),
    ...(trcloudStore.expenseRows || []),
  ]
  return allRows.find(r => {
    const dn = String(
      r.document_number || r.invoice_number || r.expense_number ||
      r.doc_number || r.po_number || r.pr_number || ''
    ).toLowerCase()
    return dn === q || dn.includes(q) || q.includes(dn.replace(/^(ap|po|pv|exp)\d*/i, ''))
  }) || null
}

async function onDocNumberInput(row) {
  const q = row.doc_number.trim()
  if (!q || q.length < 6) return
  row.searching = true
  if (!trcloudStore.apRows.length) {
    await Promise.all([
      trcloudStore.fetchTrcloudData('ap'),
      trcloudStore.fetchTrcloudData('po'),
      trcloudStore.fetchTrcloudData('expense'),
    ])
  }
  row.searching = false
  const found = lookupDoc(q)
  if (!found) return
  row.vendor = found.organization || found.name || found.supplier || row.vendor
  row.items = found.invoice_note || found.remark || found.note || found.description || found.item_name || row.items
  row.cost_center = found.project || found.project_name || found.department || row.cost_center
  const cur = (found.currency || found.fx || 'LAK').toString().toUpperCase()
  const amt = parseFloat(found.grand_total || found.total || 0)
  if (amt > 0) {
    if (cur === 'LAK' || cur === 'KIP') row.kip = String(amt)
    else if (cur === 'THB') row.thb = String(amt)
    else if (cur === 'USD') row.usd = String(amt)
  }
  row.autofilled = true
  onFieldChange(row)
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

// filtered rows (search + payment filter)
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

onMounted(() => {
  loadRates()
  loadRows()
  if (!trcloudStore.apRows.length) trcloudStore.fetchTrcloudData('ap')
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
              <th class="px-3 py-3 text-left font-semibold" style="color: var(--color-text-muted)">ร้านค้า</th>
              <th class="px-3 py-3 text-left font-semibold" style="color: var(--color-text-muted)">รายการ</th>
              <th class="px-3 py-3 text-left font-semibold whitespace-nowrap" style="color: var(--color-text-muted)">Cost Center</th>
              <th class="px-3 py-3 text-left font-semibold whitespace-nowrap" style="color: var(--color-text-muted)">Air Code</th>
              <th class="px-3 py-3 text-left font-semibold" style="color: var(--color-text-muted)">เหตุผล</th>
              <th class="px-3 py-3 text-center font-semibold whitespace-nowrap" style="color: var(--color-text-muted)">กำหนดชำระ<br/><span class="font-normal text-[10px]">(หน้างาน)</span></th>
              <th class="px-3 py-3 text-center font-semibold whitespace-nowrap" style="color: var(--color-text-muted)">การเงิน</th>
              <th class="px-3 py-3 text-right font-semibold whitespace-nowrap text-amber-600" style="border-left: 1px solid var(--color-border)"># KIP</th>
              <th class="px-3 py-3 text-right font-semibold whitespace-nowrap text-green-600"># THB</th>
              <th class="px-3 py-3 text-right font-semibold whitespace-nowrap text-blue-600"># USD</th>
              <th class="px-3 py-3 text-left font-semibold whitespace-nowrap" style="color: var(--color-text-muted); border-left: 1px solid var(--color-border)">ผู้ลงข้อมูล</th>
              <th class="px-3 py-3 text-center font-semibold whitespace-nowrap" style="color: var(--color-text-muted)">สถานะ</th>
              <th class="px-3 py-3 text-right font-semibold whitespace-nowrap" style="color: var(--color-text-primary)">ประมาณ THB</th>
              <th class="px-3 py-3 text-center font-semibold whitespace-nowrap" style="color: var(--color-text-muted); border-left: 1px solid var(--color-border)">สถานะการจ่ายเงิน</th>
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
              <td colspan="17" class="px-4 py-16 text-center" style="color: var(--color-text-muted)">
                <i class="fa-solid fa-table-list text-3xl mb-3 opacity-20 block"></i>
                <p class="text-[13px]">ยังไม่มีรายการ — กดปุ่ม <b class="text-blue-500">+ เพิ่มรายการ</b> เพื่อเริ่มบันทึก</p>
              </td>
            </tr>

            <tr
              v-for="(row, idx) in filteredRows"
              :key="row.id"
              class="transition-colors align-top"
              :class="row.autofilled ? 'bg-blue-50/30 dark:bg-blue-900/10' : ''"
              style="border-bottom: 1px solid var(--color-border)"
            >
              <!-- # -->
              <td class="px-2 py-2.5 text-center text-[11px]" style="color: var(--color-text-muted)">
                <i v-if="row.saving" class="fa-solid fa-circle-notch fa-spin text-blue-400"></i>
                <span v-else>{{ idx + 1 }}</span>
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

              <!-- สถานะ (รับของ) -->
              <td class="px-2 py-2 text-center">
                <select v-model="row.status" @change="onFieldChange(row)"
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

    <!-- Add row shortcut at bottom -->
    <button @click="addRow"
      class="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl border-2 border-dashed text-[13px] font-medium transition hover:border-blue-400 hover:text-blue-500"
      style="border-color: var(--color-border); color: var(--color-text-muted)">
      <i class="fa-solid fa-plus"></i> เพิ่มรายการใหม่
    </button>

  </div>
</template>

<style scoped>
.overflow-auto::-webkit-scrollbar { width: 6px; height: 6px; }
.overflow-auto::-webkit-scrollbar-track { background: transparent; }
.overflow-auto::-webkit-scrollbar-thumb { background: rgba(156,163,175,0.3); border-radius: 10px; }
.overflow-auto::-webkit-scrollbar-thumb:hover { background: rgba(156,163,175,0.5); }
</style>
