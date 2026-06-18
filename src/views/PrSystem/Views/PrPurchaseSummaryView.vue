<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'
import { useTrcloudStore } from '@/stores/trcloud'

const auth = useAuthStore()
const trcloudStore = useTrcloudStore()

const TABLE = 'pr_purchase_tracking'
const UNASSIGNED = 'ยังไม่มอบหมาย'

const loading = computed(() => trcloudStore.loading)
const viewMode = ref('cost_center') // 'cost_center' | 'purchaser'
const statusFilter = ref('all') // 'all' | 'new' | 'partial' | 'tracking' (=New+Partial) — กรองสถานะในหน้าเดียว
const onlyOutstanding = ref(true)
const search = ref('')

const trcloudDateFrom = computed({ get: () => trcloudStore.dateFrom, set: (v) => (trcloudStore.dateFrom = v) })
const trcloudDateTo = computed({ get: () => trcloudStore.dateTo, set: (v) => (trcloudStore.dateTo = v) })

// pr_key -> { id, assignee, remark }
const trackingMap = ref({})
const savingKeys = ref(new Set())

const selectedCostCenter = ref(null)
const selectedPurchaser = ref(null)

// ─── helpers ──────────────────────────────────────────────────────────────
function isOutstanding(status) {
  const s = (status || '').toString().toLowerCase()
  return !s.includes('success') && !s.includes('เสร็จสิ้น') && !s.includes('เรียบร้อย') && !s.includes('สำเร็จ')
}

// จำแนกสถานะ PO/PR: New / Partial / อื่นๆ
function statusKind(status) {
  const s = (status || '').toString().toLowerCase()
  if (s.includes('partial') || s.includes('บางส่วน')) return 'partial'
  if (s.includes('new') || s.includes('ใหม่')) return 'new'
  return 'other'
}

function prKeyOf(row) {
  return String(row.document_number || row.pr_id || row.po_id || row.unique_id || '')
}

// "cost center" = โครงการ (project)
function costCenterOf(row) {
  return (row.project || '').toString().trim() || 'ไม่ระบุโครงการ'
}

function trackOf(row) {
  return trackingMap.value[prKeyOf(row)] || {}
}

function assigneeOf(row) {
  return trackOf(row).assignee || ''
}

function byDateDesc(a, b) {
  return String(b.issue_date || '').localeCompare(String(a.issue_date || ''))
}

function formatNumber(value) {
  if (value === null || value === undefined || value === '') return '-'
  const n = Number(value)
  if (!Number.isFinite(n)) return '-'
  return n.toLocaleString('th-TH')
}

function formatAmount(value) {
  const n = Number(value || 0)
  if (!Number.isFinite(n)) return '0'
  return n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function cleanNote(raw) {
  if (!raw) return ''
  return String(raw).replace(/\s*\n\s*/g, ' • ').replace(/\s+/g, ' ').trim()
}

function calculateDocAge(dateStr) {
  if (!dateStr) return '-'
  const docDate = new Date(dateStr)
  if (isNaN(docDate)) return '-'
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  docDate.setHours(0, 0, 0, 0)
  const diffDays = Math.floor((today - docDate) / (1000 * 60 * 60 * 24))
  return diffDays > 0 ? `${diffDays} วัน` : 'วันนี้'
}

function getBadgeInfo(status) {
  if (!status) return { text: '—', bg: 'rgba(148,163,184,0.1)', color: '#94a3b8' }
  const s = status.toString().toLowerCase()
  if (s.includes('success') || s.includes('เสร็จสิ้น') || s.includes('เรียบร้อย') || s.includes('สำเร็จ') || s.includes('อนุมัติ')) {
    return { text: status, bg: 'rgba(16,185,129,0.1)', color: '#10b981' }
  }
  if (s.includes('ยกเลิก') || s.includes('cancel') || s.includes('reject')) {
    return { text: status, bg: 'rgba(239,68,68,0.1)', color: '#ef4444' }
  }
  return { text: status, bg: 'rgba(245,158,11,0.1)', color: '#f59e0b' }
}

// ─── data: PR rows + filters ────────────────────────────────────────────────
const prRows = computed(() => trcloudStore.prRows)

const filteredRows = computed(() => {
  let rows = prRows.value
  if (onlyOutstanding.value) rows = rows.filter((r) => isOutstanding(r.status))
  if (statusFilter.value === 'tracking') {
    rows = rows.filter((r) => {
      const k = statusKind(r.status)
      return k === 'new' || k === 'partial'
    })
  } else if (statusFilter.value !== 'all') {
    rows = rows.filter((r) => statusKind(r.status) === statusFilter.value)
  }
  const q = search.value.trim().toLowerCase()
  if (q) {
    rows = rows.filter((r) => {
      const t = trackOf(r)
      const hay = [r.document_number, r.organization, r.project, r.staff, r.department, r.status, r.invoice_note, t.assignee, t.remark]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return hay.includes(q)
    })
  }
  return rows
})

const totals = computed(() => {
  let outstanding = 0
  let assigned = 0
  let newCount = 0
  let partialCount = 0
  for (const r of filteredRows.value) {
    if (isOutstanding(r.status)) outstanding++
    if (assigneeOf(r)) assigned++
    const kind = statusKind(r.status)
    if (kind === 'new') newCount++
    else if (kind === 'partial') partialCount++
  }
  return { total: filteredRows.value.length, outstanding, assigned, unassigned: filteredRows.value.length - assigned, newCount, partialCount }
})

// ─── cost-center (project) cards ────────────────────────────────────────────
const costCenterCards = computed(() => {
  const map = {}
  for (const r of filteredRows.value) {
    const cc = costCenterOf(r)
    if (!map[cc]) map[cc] = { name: cc, count: 0, outstanding: 0, amount: 0, assigned: 0, newCount: 0, partialCount: 0 }
    map[cc].count++
    if (isOutstanding(r.status)) map[cc].outstanding++
    map[cc].amount += parseFloat(r.grand_total || 0)
    if (assigneeOf(r)) map[cc].assigned++
    const kind = statusKind(r.status)
    if (kind === 'new') map[cc].newCount++
    else if (kind === 'partial') map[cc].partialCount++
  }
  return Object.values(map).sort((a, b) => b.outstanding - a.outstanding || b.count - a.count)
})

const selectedCostCenterRows = computed(() => {
  if (!selectedCostCenter.value) return []
  return filteredRows.value.filter((r) => costCenterOf(r) === selectedCostCenter.value).sort(byDateDesc)
})

// ─── purchaser list (เหมือนหน้าสรุปคนเปิด PO: ดึงคนเปิดจริงจาก PO items) ──────
const purchaserList = computed(() => {
  const map = {}
  for (const row of trcloudStore.poItemRows) {
    const name = row.staff || 'ไม่ระบุชื่อ'
    const docId = row.doc_number || row.invoice_number || row.unique_id
    if (!map[name]) map[name] = { name, docIds: new Set(), poIds: new Set(), apIds: new Set(), amount: 0, items: [] }
    const s = map[name]
    s.items.push(row)
    if (docId && !s.docIds.has(docId)) {
      s.docIds.add(docId)
      const hasAp = row.expense || (row.status || '').includes('ชำระแล้ว') || (row.status || '').includes('AP')
      if (hasAp) s.apIds.add(docId)
      else s.poIds.add(docId)
    }
    s.amount += parseFloat(row.item_total || 0)
  }
  let list = Object.values(map).map((s) => ({
    name: s.name,
    count: s.docIds.size,
    poCount: s.poIds.size,
    apCount: s.apIds.size,
    amount: s.amount,
    items: s.items,
  }))
  const q = search.value.trim().toLowerCase()
  if (q) {
    list = list.filter((s) => s.name.toLowerCase().includes(q) || s.items.some((it) => String(it.document_number || it.doc_number || '').toLowerCase().includes(q)))
  }
  return list.sort((a, b) => b.count - a.count)
})

// รายชื่อสำหรับ dropdown มอบหมาย = คนเปิด PO จริง (เรียงตามชื่อ)
const purchaserNames = computed(() =>
  [...new Set(trcloudStore.poItemRows.map((row) => (row.staff || '').trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, 'th')
  )
)

const selectedPurchaserData = computed(() => purchaserList.value.find((p) => p.name === selectedPurchaser.value) || null)

// จำนวน PR ที่มอบหมายให้แต่ละคน (นับจาก dropdown มอบหมาย)
const assignedCountByName = computed(() => {
  const m = {}
  for (const key in trackingMap.value) {
    const a = (trackingMap.value[key]?.assignee || '').trim()
    if (!a) continue
    m[a] = (m[a] || 0) + 1
  }
  return m
})

const expandedPurchaserDocs = ref(new Set())
function togglePurchaserDoc(docNumber) {
  const s = new Set(expandedPurchaserDocs.value)
  if (s.has(docNumber)) s.delete(docNumber)
  else s.add(docNumber)
  expandedPurchaserDocs.value = s
}

// เอกสารของผู้จัดซื้อที่เลือก จัดกลุ่มตามเลขที่เอกสาร
// ถ้าเลือกศูนย์ต้นทุนไว้ด้วย → กรองเฉพาะเอกสารของโครงการเดียวกัน (ตามชื่อเดียวกัน)
const purchaserGroups = computed(() => {
  const data = selectedPurchaserData.value
  if (!data) return []
  const cc = selectedCostCenter.value
  const items = cc ? data.items.filter((it) => costCenterOf(it) === cc) : data.items
  const groups = []
  const m = {}
  for (const it of items) {
    const dn = it.doc_number || it.invoice_number || 'N/A'
    if (!m[dn]) {
      m[dn] = { doc_number: dn, issue_date: it.issue_date, organization: it.organization, project: it.project, pr: it.pr, status: it.status, currency: it.currency || 'LAK', items: [], total: 0 }
      groups.push(m[dn])
    }
    m[dn].items.push(it)
    m[dn].total += Number(it.item_total || 0)
  }
  return groups.sort((a, b) => String(b.issue_date || '').localeCompare(String(a.issue_date || '')))
})

// active selection
const activeTitle = computed(() =>
  viewMode.value === 'cost_center' ? selectedCostCenter.value : selectedPurchaser.value
)

// ─── persistence ────────────────────────────────────────────────────────────
async function loadTracking() {
  try {
    const { data, error } = await supabase.from(TABLE).select('*')
    if (error) throw error
    const map = {}
    for (const row of data || []) {
      if (!row?.pr_key) continue
      map[row.pr_key] = { id: row.id, assignee: row.assignee || '', remark: row.remark || '' }
    }
    trackingMap.value = map
  } catch (e) {
    console.warn('load pr_purchase_tracking failed:', e?.message || e)
  }
}

async function saveTracking(prKey, patch) {
  if (!prKey) return
  const existing = trackingMap.value[prKey] || {}
  const next = { ...existing, ...patch }
  // optimistic local update
  trackingMap.value = { ...trackingMap.value, [prKey]: next }

  const keys = new Set(savingKeys.value)
  keys.add(prKey)
  savingKeys.value = keys

  try {
    const updated_by = auth.user?.fullname || auth.user?.username || null
    // upsert ตาม pr_key — กันชน unique index เวลามีหลาย user แก้ใบเดียวกัน
    // (insert ตรงๆ จะ error ถ้า user อื่นสร้างแถวนั้นไว้แล้ว → เคยทำให้ "มอบหมายแล้วหาย")
    const { data, error } = await supabase
      .from(TABLE)
      .upsert(
        { pr_key: prKey, assignee: next.assignee || null, remark: next.remark || null, updated_by, updated_at: new Date().toISOString() },
        { onConflict: 'pr_key' }
      )
      .select()
    if (error) throw error
    const saved = Array.isArray(data) ? data[0] : data
    if (saved?.id) {
      trackingMap.value = { ...trackingMap.value, [prKey]: { ...next, id: saved.id } }
    }
  } catch (e) {
    console.error('❌ บันทึกการมอบหมาย (pr_purchase_tracking) ไม่สำเร็จ:', e?.message || e)
  } finally {
    const k2 = new Set(savingKeys.value)
    k2.delete(prKey)
    savingKeys.value = k2
  }
}

function isSaving(row) {
  return savingKeys.value.has(prKeyOf(row))
}

function onAssign(row, value) {
  saveTracking(prKeyOf(row), { assignee: value })
}

function onRemark(row, value) {
  if ((trackOf(row).remark || '') === (value || '')) return
  saveTracking(prKeyOf(row), { remark: value })
}

// ─── interactions ────────────────────────────────────────────────────────────
// เลือกได้พร้อมกันทั้งศูนย์ต้นทุนและผู้จัดซื้อ (ไม่สลับซ่อนกัน)
function selectCostCenter(name) {
  // คลิกซ้ำการ์ดเดิม = ยกเลิกเลือก
  selectedCostCenter.value = selectedCostCenter.value === name ? null : name
}

function selectPurchaser(name) {
  selectedPurchaser.value = name
}

// คลิกจากแผงด้านข้าง → เลือกคนนั้น (คลิกซ้ำ = ยกเลิกเลือก)
function pickPurchaser(name) {
  selectedPurchaser.value = selectedPurchaser.value === name ? null : name
}

function setViewMode(mode) {
  viewMode.value = mode
}

async function refresh() {
  await Promise.all([
    trcloudStore.fetchTrcloudData('pr', { force: true }),
    trcloudStore.fetchTrcloudData('po', { force: true }),
  ])
  await loadTracking()
}

onMounted(async () => {
  await loadTracking()
  if (prRows.value.length === 0) trcloudStore.fetchTrcloudData('pr')
  if (trcloudStore.poItemRows.length === 0) trcloudStore.fetchTrcloudData('po')
})

// auto-select first card when list changes and nothing chosen
watch(costCenterCards, (cards) => {
  if (viewMode.value !== 'cost_center') return
  if (selectedCostCenter.value && cards.some((c) => c.name === selectedCostCenter.value)) return
  selectedCostCenter.value = cards[0]?.name || null
})
watch(purchaserList, (list) => {
  if (viewMode.value !== 'purchaser') return
  if (selectedPurchaser.value && list.some((p) => p.name === selectedPurchaser.value)) return
  selectedPurchaser.value = list[0]?.name || null
})
watch(viewMode, (mode) => {
  if (mode === 'cost_center' && !selectedCostCenter.value) selectedCostCenter.value = costCenterCards.value[0]?.name || null
  if (mode === 'purchaser' && !selectedPurchaser.value) selectedPurchaser.value = purchaserList.value[0]?.name || null
})
</script>

<template>
  <div class="flex flex-col h-full">
    <!-- Header -->
    <div class="mb-5">
      <h1 class="text-[20px] font-semibold" style="color: var(--color-text-primary)">สรุปงาน PR จัดซื้อ</h1>
      <p class="text-[13px] mt-0.5" style="color: var(--color-text-muted)">
        ตรวจ PR แยกตามศูนย์ต้นทุน (โครงการ) มอบหมายงานให้ผู้จัดซื้อ และจดโน้ตว่าติดอะไรบ้าง
      </p>
    </div>

    <!-- Toolbar -->
    <div class="flex flex-wrap items-center gap-3 mb-5 p-3 rounded-xl border" style="background: var(--color-bg-card); border-color: var(--color-border)">
      <!-- view mode switch -->
      <div class="flex items-center gap-1 p-1 rounded-lg border" style="border-color: var(--color-border)">
        <button
          @click="setViewMode('cost_center')"
          :class="['px-4 py-1.5 rounded-md text-[12px] font-medium transition-all', viewMode === 'cost_center' ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-500 hover:text-gray-700']"
        >
          <i class="fa-solid fa-layer-group mr-1.5"></i>ตามศูนย์ต้นทุน
        </button>
        <button
          @click="setViewMode('purchaser')"
          :class="['px-4 py-1.5 rounded-md text-[12px] font-medium transition-all', viewMode === 'purchaser' ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-500 hover:text-gray-700']"
        >
          <i class="fa-solid fa-user-tag mr-1.5"></i>ตามผู้จัดซื้อ
        </button>
      </div>

      <!-- โหมดติดตามงาน: กรองเฉพาะ New + Partial -->
      <button
        @click="statusFilter = statusFilter === 'tracking' ? 'all' : 'tracking'"
        :class="['px-4 py-1.5 rounded-lg text-[12px] font-semibold border transition-all', statusFilter === 'tracking' ? 'bg-orange-500 text-white border-orange-500 shadow-sm' : 'text-orange-600 border-orange-300 hover:bg-orange-50 dark:hover:bg-orange-900/20']"
      >
        <i class="fa-solid fa-clipboard-list mr-1.5"></i>โหมดติดตามงาน
      </button>

      <!-- กรองสถานะ (อยู่หน้าเดียวกัน) -->
      <div class="flex items-center gap-1 p-1 rounded-lg border" style="border-color: var(--color-border)">
        <button
          v-for="opt in [{ k: 'all', label: 'ทั้งหมด' }, { k: 'new', label: 'New' }, { k: 'partial', label: 'Partial' }]"
          :key="opt.k"
          @click="statusFilter = opt.k"
          :class="['px-3 py-1.5 rounded-md text-[12px] font-medium transition-all', statusFilter === opt.k ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-500 hover:text-gray-700']"
        >{{ opt.label }}</button>
      </div>

      <div class="flex items-center gap-2">
        <label class="text-[12px] font-medium" style="color: var(--color-text-muted)">จาก</label>
        <input v-model="trcloudDateFrom" type="date" class="px-3 py-1.5 bg-transparent border rounded-lg text-[12px] focus:outline-none" style="border-color: var(--color-border); color: var(--color-text-primary)" />
        <label class="text-[12px] font-medium" style="color: var(--color-text-muted)">ถึง</label>
        <input v-model="trcloudDateTo" type="date" class="px-3 py-1.5 bg-transparent border rounded-lg text-[12px] focus:outline-none" style="border-color: var(--color-border); color: var(--color-text-primary)" />
      </div>

      <button @click="refresh" :disabled="loading" class="px-4 py-1.5 rounded-lg text-[12px] font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
        <i class="fa-solid fa-rotate mr-1" :class="loading ? 'fa-spin' : ''"></i>ดึงข้อมูล
      </button>

      <label class="flex items-center gap-2 text-[12px] font-medium cursor-pointer" style="color: var(--color-text-primary)">
        <input type="checkbox" v-model="onlyOutstanding" class="w-4 h-4 accent-orange-500 cursor-pointer" />
        เฉพาะที่ค้าง
      </label>

      <div class="relative flex-1 min-w-[200px]">
        <i class="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-[13px]" style="color: var(--color-text-muted)"></i>
        <input v-model="search" type="text" placeholder="ค้นหา PR, โครงการ, ผู้จัดซื้อ, โน้ต..." class="w-full pl-9 pr-4 py-1.5 bg-transparent border rounded-lg text-[12px] focus:outline-none" style="border-color: var(--color-border); color: var(--color-text-primary)" />
      </div>
    </div>

    <!-- Cost-center cards (เต็มความกว้าง, แสดงทั้งสองโหมด) -->
    <div class="mb-5">
          <div class="flex items-center justify-between gap-3 flex-wrap mb-3">
            <div class="text-[13px] font-semibold" style="color: var(--color-text-primary)">
              ศูนย์ต้นทุน / โครงการ ({{ costCenterCards.length }})
            </div>
            <div class="flex items-center gap-2 text-[12px]">
              <span class="px-2.5 py-1 rounded-lg bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 font-semibold">New {{ totals.newCount }}</span>
              <span class="px-2.5 py-1 rounded-lg bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300 font-semibold">Partial {{ totals.partialCount }}</span>
              <span class="px-2.5 py-1 rounded-lg border font-semibold" style="border-color: var(--color-border); color: var(--color-text-muted)">รวม {{ totals.total }}</span>
            </div>
          </div>
          <div v-if="loading" class="p-8 text-center rounded-xl border" style="background: var(--color-bg-card); border-color: var(--color-border)">
            <i class="fa-solid fa-circle-notch fa-spin text-2xl text-blue-500 mb-2"></i>
            <p class="text-[13px]" style="color: var(--color-text-muted)">กำลังโหลด...</p>
          </div>
          <div v-else class="grid grid-cols-2 sm:grid-cols-3 2xl:grid-cols-4 gap-3">
            <div v-if="!costCenterCards.length" class="col-span-full p-8 text-center text-[13px]" style="color: var(--color-text-muted)">ไม่พบข้อมูล</div>
            <div
              v-for="c in costCenterCards"
              :key="c.name"
              @click="selectCostCenter(c.name)"
              :class="['rounded-xl border p-3 cursor-pointer transition-all', selectedCostCenter === c.name ? 'ring-2 ring-blue-500 border-blue-500' : 'hover:border-blue-300']"
              :style="{ background: 'var(--color-bg-card)', ...(selectedCostCenter === c.name ? {} : { borderColor: 'var(--color-border)' }) }"
            >
              <div class="font-semibold text-[13px] leading-tight line-clamp-2" style="color: var(--color-text-primary)">
                <i class="fa-solid fa-folder-open mr-1.5 text-orange-500"></i>{{ c.name }}
              </div>
              <div class="flex items-center flex-wrap gap-1.5 mt-2.5">
                <span class="px-2 py-0.5 rounded-lg text-[11px] font-bold bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">New {{ c.newCount }}</span>
                <span class="px-2 py-0.5 rounded-lg text-[11px] font-bold bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300">Partial {{ c.partialCount }}</span>
                <span class="px-2 py-0.5 rounded-lg text-[11px] font-bold border" style="border-color: var(--color-border); color: var(--color-text-primary)">รวม {{ c.newCount + c.partialCount }}</span>
              </div>
              <div class="flex items-center justify-between mt-2 text-[11px]" style="color: var(--color-text-muted)">
                <span class="font-mono">{{ formatAmount(c.amount) }} ฿</span>
                <span class="text-green-600">มอบแล้ว {{ c.assigned }}</span>
              </div>
            </div>
          </div>
    </div>

    <!-- Body: รายชื่อคนเปิด PO (ซ้าย) + รายการ PR (ขวา) -->
    <div class="flex flex-col lg:flex-row gap-5 flex-1 min-h-0">
      <!-- Detail -->
      <div class="flex-1 flex flex-col rounded-xl border overflow-hidden min-w-0 min-h-[320px]" style="background: var(--color-bg-card); border-color: var(--color-border)">
        <div class="p-3 font-semibold text-[13px] bg-gray-50 dark:bg-gray-900/50 flex items-center justify-between gap-3" style="color: var(--color-text-primary); border-bottom: 1px solid var(--color-border)">
          <span class="truncate">
            <i class="fa-solid fa-list-check mr-1.5 text-blue-500"></i>
            รายละเอียด
          </span>
        </div>

        <div class="flex-1 overflow-auto">
          <!-- COST CENTER: ตาราง PR + มอบหมาย + หมายเหตุ -->
          <div v-if="selectedCostCenter && selectedCostCenterRows.length" class="px-3 py-2 flex items-center justify-between gap-3 bg-orange-50/60 dark:bg-orange-900/10" style="border-bottom: 1px solid var(--color-border)">
            <span class="text-[12px] font-semibold" style="color: var(--color-text-primary)"><i class="fa-solid fa-folder-open mr-1.5 text-orange-500"></i>รายการ PR: {{ selectedCostCenter }}</span>
            <span class="text-[12px] font-normal whitespace-nowrap" style="color: var(--color-text-muted)"><b class="text-orange-600">{{ selectedCostCenterRows.length }}</b> รายการ</span>
          </div>
          <table v-if="selectedCostCenter && selectedCostCenterRows.length" class="w-full text-[12px] border-collapse min-w-[860px]">
            <thead class="sticky top-0 z-10 bg-gray-50 dark:bg-gray-900" style="border-bottom: 1px solid var(--color-border)">
              <tr>
                <th class="px-3 py-3 text-left font-medium whitespace-nowrap" style="color: var(--color-text-muted)">เลข PR / วันที่</th>
                <th class="px-3 py-3 text-left font-medium" style="color: var(--color-text-muted)">รายละเอียด / คู่ค้า</th>
                <th class="px-3 py-3 text-center font-medium whitespace-nowrap" style="color: var(--color-text-muted)">จำนวน</th>
                <th class="px-3 py-3 text-left font-medium whitespace-nowrap" style="color: var(--color-text-muted)">ผู้จัดซื้อ (มอบหมาย)</th>
                <th class="px-3 py-3 text-left font-medium" style="color: var(--color-text-muted)">หมายเหตุ (ติดอะไร)</th>
                <th class="px-3 py-3 text-center font-medium whitespace-nowrap" style="color: var(--color-text-muted)">สถานะ</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in selectedCostCenterRows" :key="prKeyOf(r)" style="border-bottom: 1px solid var(--color-border)" class="hover:bg-blue-50/40 dark:hover:bg-gray-800/40 transition-colors align-top">
                <td class="px-3 py-3 whitespace-nowrap">
                  <div class="font-bold font-mono text-blue-600 dark:text-blue-400">{{ r.document_number || r.pr_id || '-' }}</div>
                  <div class="text-[11px] mt-0.5" style="color: var(--color-text-muted)">{{ r.issue_date || '-' }}</div>
                  <div class="text-[11px] text-blue-500">{{ calculateDocAge(r.issue_date || r.date) }}</div>
                </td>
                <td class="px-3 py-3 max-w-[320px]">
                  <div class="font-medium" style="color: var(--color-text-primary)">{{ r.organization || r.email || '-' }}</div>
                  <div class="text-[11px] mt-0.5 line-clamp-2" style="color: var(--color-text-muted)">{{ cleanNote(r.invoice_note) || '-' }}</div>
                  <div v-if="r.staff" class="text-[11px] mt-0.5 text-purple-500"><i class="fa-solid fa-user-pen mr-1"></i>{{ r.staff }}</div>
                </td>
                <td class="px-3 py-3 text-center font-mono whitespace-nowrap" style="color: var(--color-text-primary)">{{ formatNumber(r.sum_quantity) }}</td>
                <td class="px-3 py-3 whitespace-nowrap">
                  <div class="flex items-center gap-1.5">
                    <select
                      :value="assigneeOf(r)"
                      @change="onAssign(r, $event.target.value)"
                      class="px-2 py-1.5 rounded-lg text-[12px] border min-w-[140px] focus:outline-none"
                      :style="{ borderColor: assigneeOf(r) ? '#22c55e' : 'var(--color-border)', background: 'var(--color-bg-card)', color: 'var(--color-text-primary)' }"
                    >
                      <option value="">— ยังไม่มอบหมาย —</option>
                      <!-- เก็บค่าที่เคยมอบหมายไว้ ถ้าไม่อยู่ในรายชื่อคนเปิด PO -->
                      <option v-if="assigneeOf(r) && !purchaserNames.includes(assigneeOf(r))" :value="assigneeOf(r)">{{ assigneeOf(r) }}</option>
                      <option v-for="u in purchaserNames" :key="u" :value="u">{{ u }}</option>
                    </select>
                    <i v-if="isSaving(r)" class="fa-solid fa-circle-notch fa-spin text-[12px] text-blue-500"></i>
                  </div>
                </td>
                <td class="px-3 py-3">
                  <input
                    :value="trackOf(r).remark || ''"
                    @change="onRemark(r, $event.target.value)"
                    type="text"
                    placeholder="พิมพ์โน้ตว่าติดอะไร..."
                    class="w-full min-w-[180px] px-2 py-1.5 rounded-lg text-[12px] border focus:outline-none focus:ring-1 focus:ring-blue-400"
                    style="border-color: var(--color-border); background: var(--color-bg-card); color: var(--color-text-primary)"
                  />
                </td>
                <td class="px-3 py-3 text-center whitespace-nowrap">
                  <div class="flex flex-col items-center gap-1">
                    <span class="px-2.5 py-1 rounded-lg text-[11px] font-bold" :style="{ backgroundColor: getBadgeInfo(r.status).bg, color: getBadgeInfo(r.status).color }">
                      {{ getBadgeInfo(r.status).text }}
                    </span>
                    <span
                      v-if="assigneeOf(r)"
                      class="px-2 py-0.5 rounded-lg text-[10px] font-bold bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300 whitespace-nowrap"
                      :title="`มอบหมายให้ ${assigneeOf(r)}`"
                    >
                      <i class="fa-solid fa-circle-check mr-0.5"></i>มอบหมายแล้ว
                    </span>
                    <span v-else class="px-2 py-0.5 rounded-lg text-[10px] font-medium text-gray-400 whitespace-nowrap">
                      <i class="fa-regular fa-circle mr-0.5"></i>ยังไม่มอบหมาย
                    </span>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>

          <!-- PURCHASER: เอกสาร PO/AP ของผู้จัดซื้อ (กดดูรายการสินค้า) -->
          <div v-if="selectedPurchaser && purchaserGroups.length" class="px-3 py-2 flex items-center justify-between gap-3 bg-blue-50/60 dark:bg-blue-900/10" style="border-top: 1px solid var(--color-border); border-bottom: 1px solid var(--color-border)">
            <span class="text-[12px] font-semibold" style="color: var(--color-text-primary)">
              <i class="fa-solid fa-user-tag mr-1.5 text-blue-500"></i>เอกสารของ: {{ selectedPurchaser }}
              <span v-if="selectedCostCenter" class="ml-1 font-normal" style="color: var(--color-text-muted)"><i class="fa-solid fa-folder-open mx-1 text-orange-500"></i>{{ selectedCostCenter }}</span>
            </span>
            <span class="text-[12px] font-normal whitespace-nowrap" style="color: var(--color-text-muted)"><b class="text-blue-600">{{ purchaserGroups.length }}</b> รายการ</span>
          </div>
          <table v-if="selectedPurchaser && purchaserGroups.length" class="w-full text-[12px] border-collapse">
            <thead class="sticky top-0 z-10 bg-gray-50 dark:bg-gray-900" style="border-bottom: 1px solid var(--color-border)">
              <tr>
                <th class="px-3 py-3 w-10"></th>
                <th class="px-3 py-3 text-left font-medium whitespace-nowrap" style="color: var(--color-text-muted)">เลขที่เอกสาร / วันที่</th>
                <th class="px-3 py-3 text-left font-medium" style="color: var(--color-text-muted)">โครงการ / คู่ค้า / อ้างอิง</th>
                <th class="px-3 py-3 text-right font-medium whitespace-nowrap" style="color: var(--color-text-muted)">ยอดรวม</th>
                <th class="px-3 py-3 text-center font-medium whitespace-nowrap" style="color: var(--color-text-muted)">สถานะ</th>
              </tr>
            </thead>
            <tbody>
              <template v-for="g in purchaserGroups" :key="g.doc_number">
                <tr class="cursor-pointer hover:bg-blue-50/40 dark:hover:bg-gray-800/40 transition-colors" style="border-bottom: 1px solid var(--color-border)" @click="togglePurchaserDoc(g.doc_number)">
                  <td class="px-3 py-3 text-center">
                    <button class="w-6 h-6 rounded flex items-center justify-center text-white" :class="expandedPurchaserDocs.has(g.doc_number) ? 'bg-red-500' : 'bg-blue-500'">
                      <i :class="['fa-solid', expandedPurchaserDocs.has(g.doc_number) ? 'fa-minus' : 'fa-plus', 'text-[10px]']"></i>
                    </button>
                  </td>
                  <td class="px-3 py-3 whitespace-nowrap">
                    <div class="font-bold font-mono text-blue-600 dark:text-blue-400">{{ g.doc_number }}</div>
                    <div class="text-[11px] mt-0.5" style="color: var(--color-text-muted)">{{ g.issue_date || '-' }}</div>
                  </td>
                  <td class="px-3 py-3">
                    <div class="flex items-center gap-2 flex-wrap">
                      <span class="text-orange-600 dark:text-orange-400 font-bold text-[11px]"><i class="fa-solid fa-folder-open mr-1"></i>{{ g.project || 'ไม่มีโครงการ' }}</span>
                      <span v-if="g.pr" class="text-purple-600 dark:text-purple-400 font-medium text-[11px]"><i class="fa-solid fa-file-invoice mr-1"></i>{{ g.pr }}</span>
                    </div>
                    <div class="text-[12px] mt-0.5" style="color: var(--color-text-primary)">{{ g.organization || '-' }}</div>
                  </td>
                  <td class="px-3 py-3 text-right">
                    <div class="font-bold font-mono" style="color: var(--color-text-primary)">{{ formatAmount(g.total) }}</div>
                    <div class="text-[10px] uppercase" style="color: var(--color-text-muted)">{{ g.currency }}</div>
                  </td>
                  <td class="px-3 py-3 text-center whitespace-nowrap">
                    <span class="px-2.5 py-1 rounded-lg text-[11px] font-bold" :style="{ backgroundColor: getBadgeInfo(g.status).bg, color: getBadgeInfo(g.status).color }">{{ getBadgeInfo(g.status).text }}</span>
                  </td>
                </tr>
                <tr v-if="expandedPurchaserDocs.has(g.doc_number)" class="bg-gray-50/60 dark:bg-gray-900/30">
                  <td colspan="5" class="px-6 py-3">
                    <div class="rounded-lg border overflow-hidden" style="border-color: var(--color-border)">
                      <table class="w-full text-[11px]">
                        <thead class="bg-gray-100 dark:bg-gray-800">
                          <tr>
                            <th class="px-3 py-2 text-left font-medium" style="color: var(--color-text-muted)">รายการสินค้า / คำอธิบาย</th>
                            <th class="px-3 py-2 text-center font-medium whitespace-nowrap" style="color: var(--color-text-muted)">จำนวน</th>
                            <th class="px-3 py-2 text-right font-medium whitespace-nowrap" style="color: var(--color-text-muted)">ราคา/หน่วย</th>
                            <th class="px-3 py-2 text-right font-medium whitespace-nowrap" style="color: var(--color-text-muted)">ยอดรวม ({{ g.currency }})</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr v-for="(item, idx) in g.items" :key="item.unique_id || idx" class="border-t" style="border-color: var(--color-border)">
                            <td class="px-3 py-2" style="color: var(--color-text-primary)">{{ item.item_name || '-' }}</td>
                            <td class="px-3 py-2 text-center font-mono" style="color: var(--color-text-secondary)">{{ formatNumber(item.quantity) }}</td>
                            <td class="px-3 py-2 text-right font-mono" style="color: var(--color-text-secondary)">{{ formatNumber(item.price) }}</td>
                            <td class="px-3 py-2 text-right font-mono font-bold" style="color: var(--color-text-primary)">{{ formatAmount(item.item_total) }}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </td>
                </tr>
              </template>
            </tbody>
          </table>

          <!-- คนเปิด PO ที่เลือกไม่มีเอกสารในโครงการที่กรองอยู่ -->
          <div v-if="selectedPurchaser && selectedCostCenter && !purchaserGroups.length" class="px-3 py-3 text-[12px]" style="color: var(--color-text-muted); border-top: 1px solid var(--color-border)">
            <i class="fa-solid fa-circle-info mr-1.5 text-blue-400"></i>{{ selectedPurchaser }} ไม่มีเอกสารในโครงการ {{ selectedCostCenter }}
          </div>

          <div v-if="!(selectedCostCenter && selectedCostCenterRows.length) && !(selectedPurchaser && purchaserGroups.length)" class="h-full flex flex-col items-center justify-center p-12 text-center" style="color: var(--color-text-muted)">
            <i class="fa-solid fa-arrow-up text-3xl mb-3 opacity-20"></i>
            <p>เลือกศูนย์ต้นทุนจากการ์ดด้านบน หรือผู้จัดซื้อจากแผงด้านขวา เพื่อดูรายการ (เลือกได้พร้อมกันทั้งคู่)</p>
          </div>
        </div>
      </div>

      <!-- SIDE PANEL: รายชื่อคนเปิด PO (อยู่ด้านหน้า/ซ้าย, เสมอกับกล่องรายการ PR) -->
      <aside class="order-first w-full lg:w-[380px] flex-shrink-0 flex flex-col rounded-xl border overflow-hidden min-h-[320px]" style="background: var(--color-bg-card); border-color: var(--color-border)">
        <div class="p-3 flex items-center justify-between gap-3 bg-gray-50 dark:bg-gray-900/50" style="border-bottom: 1px solid var(--color-border)">
          <span class="text-[13px] font-semibold" style="color: var(--color-text-primary)">รายชื่อคนเปิด PO ({{ purchaserList.length }})</span>
          <div class="flex gap-2 text-[10px]" style="color: var(--color-text-muted)">
            <span class="flex items-center gap-1"><span class="w-2 h-2 rounded-full bg-orange-400"></span> PO</span>
            <span class="flex items-center gap-1"><span class="w-2 h-2 rounded-full bg-cyan-400"></span> AP</span>
          </div>
        </div>
        <div class="flex-1 min-h-0 overflow-auto">
          <div v-if="loading" class="p-8 text-center">
            <i class="fa-solid fa-circle-notch fa-spin text-xl text-blue-500 mb-2"></i>
            <p class="text-[12px]" style="color: var(--color-text-muted)">กำลังโหลด...</p>
          </div>
          <div v-else-if="!purchaserList.length" class="p-8 text-center text-[12px]" style="color: var(--color-text-muted)">ไม่พบข้อมูล</div>
          <div
            v-for="p in purchaserList"
            :key="p.name"
            @click="pickPurchaser(p.name)"
            :class="['flex items-center gap-3 px-3 py-3 cursor-pointer transition-all border-b border-l-4', selectedPurchaser === p.name ? 'bg-blue-50/60 dark:bg-blue-900/20 border-l-blue-600' : 'border-l-transparent hover:bg-gray-50 dark:hover:bg-gray-800/40']"
            style="border-bottom-color: var(--color-border)"
          >
            <div class="flex items-end gap-1 h-9 w-7 flex-shrink-0">
              <div class="w-2.5 bg-orange-400 rounded-t-sm" :style="{ height: `${Math.max((p.poCount / (p.count || 1)) * 100, 8)}%` }" :title="`PO: ${p.poCount}`"></div>
              <div class="w-2.5 bg-cyan-400 rounded-t-sm" :style="{ height: `${Math.max((p.apCount / (p.count || 1)) * 100, 8)}%` }" :title="`AP: ${p.apCount}`"></div>
            </div>
            <div class="flex-1 min-w-0">
              <div class="flex justify-between items-start gap-2">
                <span class="font-semibold text-[12px] truncate" style="color: var(--color-text-primary)">{{ p.name }}</span>
                <span class="px-1.5 py-0.5 rounded-full text-[10px] font-bold border whitespace-nowrap" style="border-color: var(--color-border); color: var(--color-text-muted)">{{ p.count }}</span>
              </div>
              <div class="text-[10px] mt-0.5" style="color: var(--color-text-muted)">มูลค่ารวม: <span class="font-mono">{{ formatAmount(p.amount) }}</span></div>
              <div class="flex items-center gap-2 text-[10px] font-bold mt-0.5">
                <span class="text-orange-500">PO: {{ p.poCount }}</span>
                <span class="text-cyan-600">AP: {{ p.apCount }}</span>
                <span
                  class="px-1.5 py-0.5 rounded-full"
                  :class="(assignedCountByName[p.name] || 0) > 0 ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' : 'text-gray-400'"
                  :title="`PR ที่มอบหมายให้ ${p.name}`"
                >
                  <i class="fa-solid fa-clipboard-check mr-0.5"></i>มอบหมาย {{ assignedCountByName[p.name] || 0 }} PR
                </span>
              </div>
            </div>
          </div>
        </div>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.line-clamp-2 {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.overflow-auto::-webkit-scrollbar { width: 6px; height: 6px; }
.overflow-auto::-webkit-scrollbar-track { background: transparent; }
.overflow-auto::-webkit-scrollbar-thumb { background: rgba(156, 163, 175, 0.3); border-radius: 10px; }
.overflow-auto::-webkit-scrollbar-thumb:hover { background: rgba(156, 163, 175, 0.5); }
</style>
