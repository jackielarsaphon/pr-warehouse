<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useTrcloudStore } from '@/stores/trcloud'

const trcloudStore = useTrcloudStore()
const loading = ref(true)
const errorText = ref('')
const currentTime = ref(new Date())
const selectedCell = ref(null) // { type, period }

let clockTimer = null

const DOC_TYPES = [
  { key: 'pr', label: 'PR', icon: 'fa-file-lines', color: '#3b82f6' },
  { key: 'po', label: 'PO', icon: 'fa-file-invoice-dollar', color: '#8b5cf6' },
  { key: 'ap', label: 'AP', icon: 'fa-file-invoice', color: '#f59e0b' },
  { key: 'pv', label: 'PV', icon: 'fa-money-check-dollar', color: '#10b981' },
]

const PERIODS = [
  { key: 'today', label: 'วันนี้', sub: 'เอกสารที่เปิดวันนี้', icon: 'fa-sun' },
  { key: 'yesterday', label: 'เมื่อวาน', sub: 'เอกสารที่เปิดเมื่อวาน', icon: 'fa-cloud-sun' },
  { key: 'week', label: '1 อาทิตย์ที่ผ่านมา', sub: '7 วันล่าสุด (รวมวันนี้)', icon: 'fa-calendar-week' },
  { key: 'month', label: 'เดือนนี้', sub: 'เอกสารที่เปิดทั้งหมดในเดือนนี้', icon: 'fa-calendar-days' },
]

function ymd(d) {
  const x = new Date(d)
  const yyyy = String(x.getFullYear())
  const mm = String(x.getMonth() + 1).padStart(2, '0')
  const dd = String(x.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function normalizeDocDate(value) {
  let raw = String(value || '').trim()
  if (!raw) return ''
  if (raw.includes(' ')) raw = raw.split(' ')[0]
  else if (raw.includes('T')) raw = raw.split('T')[0]
  if (raw.includes('/')) {
    const [d, m, y] = raw.split('/')
    if (y && m && d) return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
  }
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[1]}-${m[2]}-${m[3]}` : ''
}

function getRowDate(row) {
  return normalizeDocDate(row.issue_date || row.date || row.payment_date)
}

function getRowDocNo(row, type) {
  if (type === 'pr') return row.document_number || row.pr_id || row.reference || '-'
  if (type === 'po') return row.document_number || row.po_id || row.reference || '-'
  if (type === 'ap') return row.invoice_number || row.doc_number || row.expense_number || row.reference || '-'
  return row.document_number || row.pv_id || row.payment_number || row.reference || '-'
}

function getRowsByType(type) {
  if (type === 'pr') return trcloudStore.prRows
  if (type === 'po') return trcloudStore.poRows
  if (type === 'ap') return trcloudStore.apRows
  return trcloudStore.pvRows
}

const dateBounds = computed(() => {
  const now = new Date()
  const today = ymd(now)
  const yesterdayDate = new Date(now)
  yesterdayDate.setDate(yesterdayDate.getDate() - 1)
  const yesterday = ymd(yesterdayDate)
  const weekStartDate = new Date(now)
  weekStartDate.setDate(weekStartDate.getDate() - 6)
  const weekStart = ymd(weekStartDate)
  const monthStart = ymd(new Date(now.getFullYear(), now.getMonth(), 1))
  return { today, yesterday, weekStart, monthStart }
})

function isInPeriod(docDate, period) {
  if (!docDate) return false
  const { today, yesterday, weekStart, monthStart } = dateBounds.value
  if (period === 'today') return docDate === today
  if (period === 'yesterday') return docDate === yesterday
  if (period === 'week') return docDate >= weekStart && docDate <= today
  if (period === 'month') return docDate >= monthStart && docDate <= today
  return false
}

function filterRows(type, period) {
  return getRowsByType(type).filter((row) => isInPeriod(getRowDate(row), period))
}

const countMatrix = computed(() => {
  const matrix = {}
  for (const t of DOC_TYPES) {
    matrix[t.key] = {}
    for (const p of PERIODS) {
      matrix[t.key][p.key] = filterRows(t.key, p.key).length
    }
  }
  return matrix
})

const periodTotals = computed(() => {
  const totals = {}
  for (const p of PERIODS) {
    totals[p.key] = DOC_TYPES.reduce((sum, t) => sum + (countMatrix.value[t.key]?.[p.key] || 0), 0)
  }
  return totals
})

const typeTotals = computed(() => {
  const totals = {}
  for (const t of DOC_TYPES) {
    totals[t.key] = PERIODS.reduce((sum, p) => sum + (countMatrix.value[t.key]?.[p.key] || 0), 0)
  }
  return totals
})

const grandTotal = computed(() =>
  DOC_TYPES.reduce((sum, t) => sum + (typeTotals.value[t.key] || 0), 0)
)

const maxCellCount = computed(() => {
  let max = 0
  for (const t of DOC_TYPES) {
    for (const p of PERIODS) {
      max = Math.max(max, countMatrix.value[t.key]?.[p.key] || 0)
    }
  }
  return max || 1
})

const selectedRows = computed(() => {
  if (!selectedCell.value) return []
  const { type, period } = selectedCell.value
  return filterRows(type, period).sort((a, b) => getRowDate(b).localeCompare(getRowDate(a)))
})

const selectedLabel = computed(() => {
  if (!selectedCell.value) return ''
  const t = DOC_TYPES.find((x) => x.key === selectedCell.value.type)
  const p = PERIODS.find((x) => x.key === selectedCell.value.period)
  return `${t?.label || ''} — ${p?.label || ''}`
})

function cellIntensity(count) {
  if (!count) return 0
  return Math.max(0.12, Math.min(1, count / maxCellCount.value))
}

function selectCell(type, period) {
  const count = countMatrix.value[type]?.[period] || 0
  if (!count) {
    selectedCell.value = null
    return
  }
  if (selectedCell.value?.type === type && selectedCell.value?.period === period) {
    selectedCell.value = null
  } else {
    selectedCell.value = { type, period }
  }
}

function isCellSelected(type, period) {
  return selectedCell.value?.type === type && selectedCell.value?.period === period
}

function formatCurrentDate(date) {
  return date.toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })
}

function formatCurrentTime(date) {
  return date.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', hour12: false }) + ' น.'
}

function formatThaiShortDate(ymdStr) {
  if (!ymdStr) return '-'
  const [y, m, d] = ymdStr.split('-').map(Number)
  if (!y || !m || !d) return ymdStr
  return new Date(y, m - 1, d).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' })
}

function getMonthRangeLabel() {
  const { monthStart, today } = dateBounds.value
  return `${formatThaiShortDate(monthStart)} – ${formatThaiShortDate(today)}`
}

function getWeekRangeLabel() {
  const { weekStart, today } = dateBounds.value
  return `${formatThaiShortDate(weekStart)} – ${formatThaiShortDate(today)}`
}

async function fetchDashboardData(force = false) {
  loading.value = true
  errorText.value = ''
  try {
    const now = new Date()
    const monthStart = ymd(new Date(now.getFullYear(), now.getMonth(), 1))
    const today = ymd(now)
    trcloudStore.dateFrom = monthStart
    trcloudStore.dateTo = today

    const isCacheFresh =
      trcloudStore.lastFetched && Date.now() - new Date(trcloudStore.lastFetched).getTime() < 5 * 60 * 1000
    const isAnyMissing =
      !trcloudStore.prRows.length ||
      !trcloudStore.poRows.length ||
      !trcloudStore.apRows.length ||
      !trcloudStore.pvRows.length

    if (force || !isCacheFresh || isAnyMissing) {
      await trcloudStore.fetchAll({ force, skipApStatusSync: true })
    }
    selectedCell.value = null
  } catch (err) {
    console.error('Failed to fetch notification dashboard:', err)
    errorText.value = 'ไม่สามารถดึงข้อมูลได้ กรุณาลองใหม่อีกครั้ง'
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  fetchDashboardData()
  clockTimer = setInterval(() => {
    currentTime.value = new Date()
  }, 60000)
})

onUnmounted(() => {
  if (clockTimer) clearInterval(clockTimer)
})
</script>

<template>
  <div class="flex flex-col h-full">
    <!-- Header -->
    <div class="mb-6 flex flex-col md:flex-row md:items-end justify-between gap-4">
      <div>
        <h1 class="text-[20px] font-semibold flex items-center gap-2" style="color: var(--color-text-primary)">
          <i class="fa-solid fa-bell text-gray-800 dark:text-white"></i>
          สรุปข้อมูลแจ้งเตือน รายวัน
        </h1>
        <div class="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1">
          <p class="text-[13px]" style="color: var(--color-text-muted)">
            <i class="fa-regular fa-calendar-check mr-1"></i>
            {{ formatCurrentDate(currentTime) }}
          </p>
          <span class="w-1 h-1 bg-gray-300 rounded-full hidden sm:block"></span>
          <p class="text-[13px]" style="color: var(--color-text-muted)">
            <i class="fa-regular fa-clock mr-1"></i>
            อัปเดตล่าสุด: {{ formatCurrentTime(currentTime) }}
          </p>
        </div>
      </div>

      <button
        type="button"
        :disabled="loading"
        class="px-4 py-2 rounded-lg text-[13px] font-medium bg-gray-900 dark:bg-white text-white dark:text-gray-900 hover:opacity-90 disabled:opacity-50 transition-colors flex items-center gap-2 self-start"
        @click="fetchDashboardData(true)"
      >
        <i class="fa-solid fa-rotate" :class="loading ? 'fa-spin' : ''"></i>
        อัปเดตข้อมูล
      </button>
    </div>

    <div
      v-if="errorText"
      class="mb-4 rounded-xl border p-3 text-[13px]"
      style="border-color: rgba(239, 68, 68, 0.35); background: rgba(239, 68, 68, 0.06); color: #b91c1c"
    >
      {{ errorText }}
    </div>

    <!-- Period summary cards -->
    <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
      <div
        v-for="p in PERIODS"
        :key="p.key"
        class="rounded-xl border p-4 transition-shadow hover:shadow-md"
        style="background: var(--color-bg-card); border-color: var(--color-border)"
      >
        <div class="flex items-start justify-between gap-2">
          <div>
            <p class="text-[12px] font-medium" style="color: var(--color-text-muted)">{{ p.label }}</p>
            <p class="text-[11px] mt-0.5" style="color: var(--color-text-muted)">{{ p.sub }}</p>
          </div>
          <div
            class="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
            style="background: rgba(59, 130, 246, 0.1)"
          >
            <i class="fa-solid text-[14px] text-blue-600" :class="p.icon"></i>
          </div>
        </div>
        <p class="text-[28px] font-bold mt-3 leading-none" style="color: var(--color-text-primary)">
          {{ loading ? '—' : periodTotals[p.key] }}
          <span class="text-[13px] font-normal" style="color: var(--color-text-muted)">ฉบับ</span>
        </p>
        <p v-if="p.key === 'week' && !loading" class="text-[11px] mt-2" style="color: var(--color-text-muted)">
          {{ getWeekRangeLabel() }}
        </p>
        <p v-else-if="p.key === 'month' && !loading" class="text-[11px] mt-2" style="color: var(--color-text-muted)">
          {{ getMonthRangeLabel() }}
        </p>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="py-20 text-center">
      <i class="fa-solid fa-circle-notch fa-spin text-3xl text-gray-400 mb-4"></i>
      <p style="color: var(--color-text-muted)">กำลังดึงข้อมูลเอกสาร...</p>
    </div>

    <template v-else>
      <!-- Matrix table -->
      <div
        class="rounded-xl border overflow-hidden mb-6"
        style="background: var(--color-bg-card); border-color: var(--color-border)"
      >
        <div class="px-4 py-3 border-b flex items-center justify-between" style="border-color: var(--color-border)">
          <h2 class="text-[14px] font-semibold" style="color: var(--color-text-primary)">
            <i class="fa-solid fa-table-columns mr-2 text-gray-500"></i>
            สรุปจำนวนเอกสารแยกตามประเภทและช่วงเวลา
          </h2>
          <span class="text-[12px]" style="color: var(--color-text-muted)">
            คลิกตัวเลขเพื่อดูรายละเอียด
          </span>
        </div>

        <div class="overflow-x-auto">
          <table class="w-full text-[13px] border-collapse min-w-[640px]">
            <thead>
              <tr style="background: var(--color-bg-muted, rgba(0,0,0,0.02)); border-bottom: 1px solid var(--color-border)">
                <th class="px-4 py-3 text-left font-semibold w-[140px]" style="color: var(--color-text-muted)">ประเภท</th>
                <th
                  v-for="p in PERIODS"
                  :key="p.key"
                  class="px-4 py-3 text-center font-semibold"
                  style="color: var(--color-text-muted)"
                >
                  {{ p.label }}
                </th>
                <th class="px-4 py-3 text-center font-semibold" style="color: var(--color-text-muted)">รวม</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="t in DOC_TYPES"
                :key="t.key"
                style="border-bottom: 1px solid var(--color-border)"
              >
                <td class="px-4 py-3">
                  <div class="flex items-center gap-2 font-semibold" style="color: var(--color-text-primary)">
                    <i class="fa-solid w-4 text-center" :class="t.icon" :style="{ color: t.color }"></i>
                    {{ t.label }}
                  </div>
                </td>
                <td
                  v-for="p in PERIODS"
                  :key="p.key"
                  class="px-4 py-3 text-center"
                >
                  <button
                    type="button"
                    class="inline-flex items-center justify-center min-w-[48px] px-3 py-1.5 rounded-lg font-bold text-[15px] transition-all"
                    :class="isCellSelected(t.key, p.key) ? 'ring-2 ring-blue-500 ring-offset-1' : 'hover:scale-105'"
                    :style="{
                      backgroundColor: countMatrix[t.key][p.key]
                        ? `rgba(${t.key === 'pr' ? '59,130,246' : t.key === 'po' ? '139,92,246' : t.key === 'ap' ? '245,158,11' : '16,185,129'}, ${cellIntensity(countMatrix[t.key][p.key])})`
                        : 'rgba(148,163,184,0.08)',
                      color: countMatrix[t.key][p.key] ? (t.key === 'ap' ? '#92400e' : t.color) : 'var(--color-text-muted)',
                      cursor: countMatrix[t.key][p.key] ? 'pointer' : 'default',
                    }"
                    :disabled="!countMatrix[t.key][p.key]"
                    @click="selectCell(t.key, p.key)"
                  >
                    {{ countMatrix[t.key][p.key] }}
                  </button>
                </td>
                <td class="px-4 py-3 text-center font-bold" style="color: var(--color-text-primary)">
                  {{ typeTotals[t.key] }}
                </td>
              </tr>
              <tr style="background: rgba(0,0,0,0.02); border-top: 2px solid var(--color-border)">
                <td class="px-4 py-3 font-bold" style="color: var(--color-text-primary)">รวมทั้งหมด</td>
                <td
                  v-for="p in PERIODS"
                  :key="p.key"
                  class="px-4 py-3 text-center font-bold text-[15px]"
                  style="color: var(--color-text-primary)"
                >
                  {{ periodTotals[p.key] }}
                </td>
                <td class="px-4 py-3 text-center font-bold text-[16px] text-blue-600">
                  {{ grandTotal }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Type breakdown bars -->
      <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
        <div
          v-for="t in DOC_TYPES"
          :key="t.key"
          class="rounded-xl border p-4"
          style="background: var(--color-bg-card); border-color: var(--color-border); border-left: 4px solid"
          :style="{ borderLeftColor: t.color }"
        >
          <div class="flex items-center gap-2 mb-3">
            <i class="fa-solid" :class="t.icon" :style="{ color: t.color }"></i>
            <span class="text-[13px] font-semibold" style="color: var(--color-text-primary)">{{ t.label }}</span>
            <span class="ml-auto text-[18px] font-bold" :style="{ color: t.color }">{{ typeTotals[t.key] }}</span>
          </div>
          <div class="space-y-2">
            <div v-for="p in PERIODS" :key="p.key" class="flex items-center gap-2">
              <span class="text-[11px] w-[72px] shrink-0 truncate" style="color: var(--color-text-muted)">{{ p.label }}</span>
              <div class="flex-1 h-2 rounded-full overflow-hidden" style="background: rgba(148,163,184,0.15)">
                <div
                  class="h-full rounded-full transition-all duration-500"
                  :style="{
                    width: periodTotals[p.key] ? `${(countMatrix[t.key][p.key] / Math.max(...PERIODS.map(x => periodTotals[x.key]), 1)) * 100}%` : '0%',
                    backgroundColor: t.color,
                    opacity: countMatrix[t.key][p.key] ? 0.85 : 0.2,
                  }"
                ></div>
              </div>
              <span class="text-[12px] font-semibold w-6 text-right" style="color: var(--color-text-primary)">
                {{ countMatrix[t.key][p.key] }}
              </span>
            </div>
          </div>
        </div>
      </div>

      <!-- Drill-down detail -->
      <div
        v-if="selectedCell && selectedRows.length"
        class="rounded-xl border overflow-hidden"
        style="background: var(--color-bg-card); border-color: var(--color-border)"
      >
        <div
          class="px-4 py-3 border-b flex items-center justify-between gap-3"
          style="border-color: var(--color-border)"
        >
          <h3 class="text-[14px] font-semibold" style="color: var(--color-text-primary)">
            <i class="fa-solid fa-list mr-2 text-gray-500"></i>
            รายละเอียด {{ selectedLabel }} ({{ selectedRows.length }} ฉบับ)
          </h3>
          <button
            type="button"
            class="text-[12px] px-3 py-1 rounded-lg border hover:bg-gray-50 transition-colors"
            style="border-color: var(--color-border); color: var(--color-text-muted)"
            @click="selectedCell = null"
          >
            <i class="fa-solid fa-xmark mr-1"></i>ปิด
          </button>
        </div>
        <div class="overflow-x-auto max-h-[360px] overflow-y-auto">
          <table class="w-full text-[13px] border-collapse min-w-[700px]">
            <thead class="sticky top-0 z-10" style="background: var(--color-bg-card)">
              <tr style="border-bottom: 1px solid var(--color-border)">
                <th class="px-4 py-2.5 text-left font-medium" style="color: var(--color-text-muted)">เลขที่เอกสาร</th>
                <th class="px-4 py-2.5 text-left font-medium" style="color: var(--color-text-muted)">วันที่เปิด</th>
                <th class="px-4 py-2.5 text-left font-medium" style="color: var(--color-text-muted)">คู่ค้า / โครงการ</th>
                <th class="px-4 py-2.5 text-left font-medium" style="color: var(--color-text-muted)">Staff</th>
                <th class="px-4 py-2.5 text-right font-medium" style="color: var(--color-text-muted)">สถานะ</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="row in selectedRows"
                :key="getRowDocNo(row, selectedCell.type) + getRowDate(row)"
                class="hover:bg-gray-50 dark:hover:bg-gray-800/40 transition-colors"
                style="border-bottom: 1px solid var(--color-border)"
              >
                <td class="px-4 py-2.5 font-mono font-medium" style="color: var(--color-text-primary)">
                  {{ getRowDocNo(row, selectedCell.type) }}
                </td>
                <td class="px-4 py-2.5 whitespace-nowrap" style="color: var(--color-text-muted)">
                  {{ formatThaiShortDate(getRowDate(row)) }}
                </td>
                <td class="px-4 py-2.5 max-w-[200px] truncate" :title="row.organization || row.project || ''">
                  {{ row.organization || row.project || '-' }}
                </td>
                <td class="px-4 py-2.5">{{ row.staff || row.created_by || '-' }}</td>
                <td class="px-4 py-2.5 text-right">
                  <span
                    class="px-2 py-0.5 rounded-lg text-[11px] font-medium"
                    style="background: rgba(0,0,0,0.05); color: var(--color-text-secondary)"
                  >
                    {{ row.status || row.payment_status || '-' }}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div
        v-else-if="!loading && grandTotal === 0"
        class="rounded-xl border p-12 text-center"
        style="border-color: var(--color-border)"
      >
        <i class="fa-solid fa-inbox text-4xl mb-4 opacity-20"></i>
        <p class="text-[15px] font-medium" style="color: var(--color-text-muted)">ไม่พบเอกสารที่เปิดในเดือนนี้</p>
      </div>
    </template>
  </div>
</template>
