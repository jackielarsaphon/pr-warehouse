<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useTrcloudStore } from '@/stores/trcloud'

const trcloudStore = useTrcloudStore()
const loading = ref(true)
const errorText = ref('')
const currentTime = ref(new Date())

const filterFrom = ref(ymd(new Date()))
const filterTo = ref(ymd(new Date()))
const rangeAnchor = ref(null)
const activeDocTab = ref('pr')
const calendarYear = ref(new Date().getFullYear())
const calendarMonth = ref(new Date().getMonth())

let clockTimer = null
let rangeWatchReady = false

const DOC_TYPES = [
  { key: 'pr', label: 'PR', icon: 'fa-file-lines' },
  { key: 'po', label: 'PO', icon: 'fa-file-invoice-dollar' },
  { key: 'ap', label: 'AP', icon: 'fa-file-invoice' },
  { key: 'pv', label: 'PV', icon: 'fa-money-check-dollar' },
]

const KPI_PERIODS = [
  { key: 'today', label: 'วันนี้', sub: 'เอกสารที่สร้างวันนี้', icon: 'fa-sun' },
  { key: 'week', label: 'อาทิตย์ที่ผ่านมา', sub: '7 วันล่าสุด', icon: 'fa-calendar-week' },
  { key: 'month', label: 'เดือนที่ผ่านมา', sub: 'เดือนก่อนหน้า (ทั้งเดือน)', icon: 'fa-calendar-days' },
]

const WEEKDAYS = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส']

function ymd(d) {
  const x = new Date(d)
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
}

function parseYmd(value) {
  const m = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return null
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
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
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/)
  return match ? `${match[1]}-${match[2]}-${match[3]}` : ''
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

function getPeriodBounds(key) {
  const now = new Date()
  const today = ymd(now)
  if (key === 'today') return { from: today, to: today }
  if (key === 'week') {
    const start = ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6))
    return { from: start, to: today }
  }
  if (key === 'month') {
    const start = ymd(new Date(now.getFullYear(), now.getMonth() - 1, 1))
    const end = ymd(new Date(now.getFullYear(), now.getMonth(), 0))
    return { from: start, to: end }
  }
  return { from: today, to: today }
}

function countInRange(from, to) {
  const counts = {}
  let total = 0
  for (const t of DOC_TYPES) {
    const n = getRowsByType(t.key).filter((row) => {
      const d = getRowDate(row)
      return d && d >= from && d <= to
    }).length
    counts[t.key] = n
    total += n
  }
  return { counts, total }
}

const kpiData = computed(() => {
  const out = {}
  for (const p of KPI_PERIODS) {
    const { from, to } = getPeriodBounds(p.key)
    out[p.key] = { ...countInRange(from, to), from, to }
  }
  return out
})

function isInSelectedRange(docDate) {
  if (!docDate) return false
  return docDate >= filterFrom.value && docDate <= filterTo.value
}

function filterRowsByType(type) {
  return getRowsByType(type)
    .filter((row) => isInSelectedRange(getRowDate(row)))
    .sort((a, b) => getRowDate(b).localeCompare(getRowDate(a)))
}

const typeCounts = computed(() => {
  const counts = {}
  for (const t of DOC_TYPES) counts[t.key] = filterRowsByType(t.key).length
  return counts
})

const rangeTotal = computed(() =>
  DOC_TYPES.reduce((sum, t) => sum + (typeCounts.value[t.key] || 0), 0)
)

const activeRows = computed(() => filterRowsByType(activeDocTab.value))

const isSingleDay = computed(() => filterFrom.value === filterTo.value)

const rangeLabel = computed(() => {
  if (isSingleDay.value) return formatThaiLongDate(filterFrom.value)
  return `${formatThaiShortDate(filterFrom.value)} – ${formatThaiShortDate(filterTo.value)}`
})

const activeKpiKey = computed(() => {
  for (const p of KPI_PERIODS) {
    const { from, to } = getPeriodBounds(p.key)
    if (filterFrom.value === from && filterTo.value === to) return p.key
  }
  return ''
})

const calendarDays = computed(() => {
  const first = new Date(calendarYear.value, calendarMonth.value, 1)
  const startPad = first.getDay()
  const daysInMonth = new Date(calendarYear.value, calendarMonth.value + 1, 0).getDate()
  const daysInPrev = new Date(calendarYear.value, calendarMonth.value, 0).getDate()
  const cells = []

  for (let i = startPad - 1; i >= 0; i--) {
    const day = daysInPrev - i
    cells.push(buildCalendarCell(new Date(calendarYear.value, calendarMonth.value - 1, day), true))
  }
  for (let day = 1; day <= daysInMonth; day++) {
    cells.push(buildCalendarCell(new Date(calendarYear.value, calendarMonth.value, day), false))
  }
  while (cells.length < 42) {
    const day = cells.length - startPad - daysInMonth + 1
    cells.push(buildCalendarCell(new Date(calendarYear.value, calendarMonth.value + 1, day), true))
  }
  return cells
})

function buildCalendarCell(date, outside) {
  const key = ymd(date)
  let count = 0
  for (const t of DOC_TYPES) {
    count += getRowsByType(t.key).filter((r) => getRowDate(r) === key).length
  }
  return { key, day: date.getDate(), outside, count }
}

const calendarMonthLabel = computed(() =>
  new Date(calendarYear.value, calendarMonth.value, 1).toLocaleDateString('th-TH', {
    month: 'short',
    year: 'numeric',
  })
)

function formatCurrentDate(date) {
  return date.toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })
}

function formatCurrentTime(date) {
  return date.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', hour12: false }) + ' น.'
}

function formatThaiShortDate(ymdStr) {
  const d = parseYmd(ymdStr)
  if (!d) return ymdStr || '-'
  return d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' })
}

function formatThaiLongDate(ymdStr) {
  const d = parseYmd(ymdStr)
  if (!d) return ymdStr || '-'
  return d.toLocaleDateString('th-TH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}

function isToday(key) {
  return key === ymd(new Date())
}

function isInRange(key) {
  return key >= filterFrom.value && key <= filterTo.value
}

function isRangeEdge(key) {
  return key === filterFrom.value || key === filterTo.value
}

function setRange(from, to) {
  const a = from <= to ? from : to
  const b = from <= to ? to : from
  filterFrom.value = a
  filterTo.value = b
  rangeAnchor.value = null
  syncCalendarView(a)
}

function syncCalendarView(ymdStr) {
  const d = parseYmd(ymdStr)
  if (!d) return
  calendarYear.value = d.getFullYear()
  calendarMonth.value = d.getMonth()
}

function onDayClick(key) {
  if (!rangeAnchor.value) {
    rangeAnchor.value = key
    filterFrom.value = key
    filterTo.value = key
    return
  }
  setRange(rangeAnchor.value, key)
}

function applyKpiPeriod(key) {
  const { from, to } = getPeriodBounds(key)
  setRange(from, to)
}

function prevMonth() {
  if (calendarMonth.value === 0) {
    calendarMonth.value = 11
    calendarYear.value -= 1
  } else {
    calendarMonth.value -= 1
  }
}

function nextMonth() {
  if (calendarMonth.value === 11) {
    calendarMonth.value = 0
    calendarYear.value += 1
  } else {
    calendarMonth.value += 1
  }
}

function onDateInputChange() {
  const f = filterFrom.value
  const t = filterTo.value
  if (!f || !t) return
  if (f > t) filterTo.value = f
  else if (t < f) filterFrom.value = t
  rangeAnchor.value = null
  syncCalendarView(filterFrom.value)
}

function getFetchRange() {
  const now = ymd(new Date())
  const prevMonthStart = ymd(new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1))
  const weekStart = ymd(new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate() - 6))
  const candidates = [filterFrom.value, filterTo.value, prevMonthStart, weekStart, now]
  return {
    from: candidates.reduce((a, b) => (a < b ? a : b)),
    to: candidates.reduce((a, b) => (a > b ? a : b)),
  }
}

async function fetchDashboardData(force = false) {
  loading.value = true
  errorText.value = ''
  try {
    const { from: fetchFrom, to: fetchTo } = getFetchRange()
    const rangeChanged = trcloudStore.dateFrom !== fetchFrom || trcloudStore.dateTo !== fetchTo
    trcloudStore.dateFrom = fetchFrom
    trcloudStore.dateTo = fetchTo

    const isCacheFresh =
      trcloudStore.lastFetched && Date.now() - new Date(trcloudStore.lastFetched).getTime() < 5 * 60 * 1000
    const isAnyMissing =
      !trcloudStore.prRows.length ||
      !trcloudStore.poRows.length ||
      !trcloudStore.apRows.length ||
      !trcloudStore.pvRows.length

    if (force || rangeChanged || !isCacheFresh || isAnyMissing) {
      await trcloudStore.fetchAll({ force, skipApStatusSync: true })
    }
  } catch (err) {
    console.error('Failed to fetch notification dashboard:', err)
    errorText.value = 'ไม่สามารถดึงข้อมูลได้ กรุณาลองใหม่อีกครั้ง'
  } finally {
    loading.value = false
  }
}

watch([filterFrom, filterTo], () => {
  if (!rangeWatchReady) return
  fetchDashboardData()
})

onMounted(() => {
  applyKpiPeriod('today')
  fetchDashboardData().then(() => {
    rangeWatchReady = true
  })
  clockTimer = setInterval(() => {
    currentTime.value = new Date()
  }, 60000)
})

onUnmounted(() => {
  if (clockTimer) clearInterval(clockTimer)
})
</script>

<template>
  <div class="flex flex-col h-full ns-daily-page">
    <!-- Header -->
    <div class="mb-4 flex flex-col sm:flex-row sm:items-end justify-between gap-3">
      <div>
        <h1 class="text-[20px] font-semibold flex items-center gap-2">
          <i class="fa-solid fa-bell"></i>
          สรุปข้อมูลแจ้งเตือน รายวัน
        </h1>
        <p class="text-[12px] mt-0.5">
          <i class="fa-regular fa-clock mr-1"></i>
          อัปเดตล่าสุด {{ formatCurrentTime(currentTime) }} · {{ formatCurrentDate(currentTime) }}
        </p>
      </div>
      <button
        type="button"
        :disabled="loading"
        class="px-3 py-1.5 rounded-lg text-[12px] font-medium bg-white border border-gray-300 hover:bg-gray-50 disabled:opacity-50 transition-colors flex items-center gap-2 self-start"
        @click="fetchDashboardData(true)"
      >
        <i class="fa-solid fa-rotate" :class="loading ? 'fa-spin' : ''"></i>
        อัปเดต
      </button>
    </div>

    <div v-if="errorText" class="mb-4 rounded-lg border border-gray-300 bg-gray-50 p-3 text-[13px]">
      {{ errorText }}
    </div>

    <div class="flex flex-col xl:flex-row gap-5 flex-1 min-h-0">
      <!-- Main: KPI + data -->
      <div class="flex-1 min-w-0 flex flex-col gap-5">
        <!-- KPI cards -->
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
          <button
            v-for="p in KPI_PERIODS"
            :key="p.key"
            type="button"
            class="rounded-xl border p-4 text-left transition-all hover:shadow-md"
            :class="activeKpiKey === p.key ? 'border-black bg-gray-50 shadow-sm' : 'border-gray-200 bg-white'"
            @click="applyKpiPeriod(p.key)"
          >
            <div class="flex items-start justify-between gap-2 mb-3">
              <div>
                <p class="text-[13px] font-bold">{{ p.label }}</p>
                <p class="text-[11px] mt-0.5 opacity-70">{{ p.sub }}</p>
              </div>
              <i class="fa-solid text-[14px] opacity-60" :class="p.icon"></i>
            </div>
            <p class="text-[32px] font-bold leading-none mb-3">
              {{ loading ? '—' : kpiData[p.key].total }}
              <span class="text-[13px] font-normal">ฉบับ</span>
            </p>
            <div class="grid grid-cols-4 gap-1">
              <div
                v-for="t in DOC_TYPES"
                :key="t.key"
                class="text-center rounded-lg py-1.5 bg-gray-100"
              >
                <p class="text-[10px] font-medium opacity-70">{{ t.label }}</p>
                <p class="text-[14px] font-bold">{{ loading ? '—' : kpiData[p.key].counts[t.key] }}</p>
              </div>
            </div>
          </button>
        </div>

        <!-- Selected range banner -->
        <div class="rounded-lg border border-gray-200 bg-white px-4 py-2.5 flex flex-wrap items-center justify-between gap-2">
          <div class="flex items-center gap-2 text-[13px]">
            <i class="fa-solid fa-filter text-[12px]"></i>
            <span class="font-semibold">ช่วงที่แสดง:</span>
            <span>{{ rangeLabel }}</span>
            <span v-if="rangeAnchor" class="text-[11px] opacity-70">(คลิกวันที่สองในปฏิทิน)</span>
          </div>
          <span class="text-[13px] font-bold">
            รวม {{ loading ? '—' : rangeTotal }} ฉบับ
          </span>
        </div>

        <!-- Loading -->
        <div v-if="loading" class="py-16 text-center">
          <i class="fa-solid fa-circle-notch fa-spin text-2xl mb-3"></i>
          <p class="text-[13px]">กำลังดึงข้อมูล...</p>
        </div>

        <template v-else>
          <!-- Type cards for selected range -->
          <div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <button
              v-for="t in DOC_TYPES"
              :key="t.key"
              type="button"
              class="rounded-xl border p-3 text-left transition-all hover:shadow-sm"
              :class="activeDocTab === t.key ? 'border-black bg-gray-50' : 'border-gray-200 bg-white'"
              @click="activeDocTab = t.key"
            >
              <div class="flex items-center gap-2 mb-1">
                <i class="fa-solid text-[13px]" :class="t.icon"></i>
                <span class="text-[12px] font-semibold">{{ t.label }}</span>
              </div>
              <p class="text-[24px] font-bold leading-none">
                {{ typeCounts[t.key] }}
                <span class="text-[11px] font-normal">ฉบับ</span>
              </p>
            </button>
          </div>

          <!-- Document table -->
          <div class="rounded-xl border border-gray-200 bg-white overflow-hidden flex-1">
            <div class="px-4 py-2.5 border-b border-gray-200 flex items-center justify-between gap-2">
              <p class="text-[13px] font-semibold">
                รายการ {{ DOC_TYPES.find((x) => x.key === activeDocTab)?.label }}
              </p>
              <p class="text-[11px] opacity-70">
                {{ activeRows.length }} รายการ
              </p>
            </div>

            <div v-if="activeRows.length" class="overflow-x-auto max-h-[420px] overflow-y-auto">
              <table class="w-full text-[13px] border-collapse min-w-[680px]">
                <thead class="sticky top-0 z-10 bg-white">
                  <tr class="border-b border-gray-200">
                    <th class="px-4 py-2 text-left font-medium">เลขที่เอกสาร</th>
                    <th class="px-4 py-2 text-left font-medium">วันที่สร้าง</th>
                    <th class="px-4 py-2 text-left font-medium">คู่ค้า / โครงการ</th>
                    <th class="px-4 py-2 text-left font-medium">Staff</th>
                    <th class="px-4 py-2 text-right font-medium">มูลค่า</th>
                    <th class="px-4 py-2 text-right font-medium">สถานะ</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="row in activeRows"
                    :key="getRowDocNo(row, activeDocTab) + getRowDate(row)"
                    class="border-b border-gray-100 hover:bg-gray-50 transition-colors"
                  >
                    <td class="px-4 py-2 font-mono font-medium">{{ getRowDocNo(row, activeDocTab) }}</td>
                    <td class="px-4 py-2 whitespace-nowrap">{{ formatThaiShortDate(getRowDate(row)) }}</td>
                    <td class="px-4 py-2 max-w-[180px] truncate" :title="row.organization || row.project || ''">
                      {{ row.organization || row.project || '-' }}
                    </td>
                    <td class="px-4 py-2">{{ row.staff || row.created_by || '-' }}</td>
                    <td class="px-4 py-2 text-right font-mono whitespace-nowrap">
                      {{ Number(row.grand_total || row.total || row.item_total || 0).toLocaleString('th-TH', { minimumFractionDigits: 2 }) }}
                    </td>
                    <td class="px-4 py-2 text-right">
                      <span class="px-2 py-0.5 rounded text-[11px] bg-gray-100">
                        {{ row.status || row.payment_status || '-' }}
                      </span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div v-else class="py-12 text-center">
              <i class="fa-solid fa-inbox text-3xl mb-3 opacity-20"></i>
              <p class="text-[13px]">
                ไม่พบเอกสารในช่วง {{ rangeLabel }}
              </p>
            </div>
          </div>
        </template>
      </div>

      <!-- Right: compact date picker -->
      <aside class="xl:w-[260px] shrink-0">
        <div class="rounded-xl border border-gray-200 bg-white p-3 xl:sticky xl:top-4">
          <p class="text-[12px] font-bold mb-3 flex items-center gap-1.5">
            <i class="fa-solid fa-calendar-days text-[11px]"></i>
            เลือกช่วงวันที่
          </p>

          <!-- Mini calendar -->
          <div class="flex items-center justify-between mb-2">
            <button type="button" class="w-7 h-7 rounded border border-gray-300 hover:bg-gray-50 flex items-center justify-center" @click="prevMonth">
              <i class="fa-solid fa-chevron-left text-[9px]"></i>
            </button>
            <span class="text-[11px] font-semibold">{{ calendarMonthLabel }}</span>
            <button type="button" class="w-7 h-7 rounded border border-gray-300 hover:bg-gray-50 flex items-center justify-center" @click="nextMonth">
              <i class="fa-solid fa-chevron-right text-[9px]"></i>
            </button>
          </div>

          <div class="grid grid-cols-7 gap-0.5 mb-0.5">
            <div v-for="wd in WEEKDAYS" :key="wd" class="text-center text-[9px] font-semibold py-0.5 opacity-60">
              {{ wd }}
            </div>
          </div>

          <div class="grid grid-cols-7 gap-0.5 mb-3">
            <button
              v-for="cell in calendarDays"
              :key="cell.key + cell.day"
              type="button"
              class="relative h-7 rounded text-[10px] font-medium transition-colors flex items-center justify-center"
              :class="[
                cell.outside ? 'opacity-30' : '',
                isInRange(cell.key) ? '' : 'hover:bg-gray-100',
                isRangeEdge(cell.key) ? 'ring-1 ring-black font-bold' : '',
                isToday(cell.key) && !isInRange(cell.key) ? 'underline' : '',
              ]"
              :style="{
                background: isInRange(cell.key)
                  ? isRangeEdge(cell.key) ? 'rgba(0,0,0,0.15)' : 'rgba(0,0,0,0.07)'
                  : 'transparent',
              }"
              @click="onDayClick(cell.key)"
            >
              {{ cell.day }}
              <span
                v-if="cell.count > 0"
                class="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-black opacity-50"
              ></span>
            </button>
          </div>

          <p class="text-[10px] mb-2 opacity-60 leading-snug">
            คลิกวันแรก แล้วคลิกวันที่สองเพื่อเลือกช่วง
          </p>

          <div class="space-y-2">
            <label class="block">
              <span class="text-[10px] font-medium mb-0.5 block">ตั้งแต่</span>
              <input
                v-model="filterFrom"
                type="date"
                class="w-full px-2 py-1.5 rounded border border-gray-300 bg-white text-[12px] focus:outline-none focus:ring-1 focus:ring-gray-400"
                @change="onDateInputChange"
              />
            </label>
            <label class="block">
              <span class="text-[10px] font-medium mb-0.5 block">ถึง</span>
              <input
                v-model="filterTo"
                type="date"
                class="w-full px-2 py-1.5 rounded border border-gray-300 bg-white text-[12px] focus:outline-none focus:ring-1 focus:ring-gray-400"
                @change="onDateInputChange"
              />
            </label>
          </div>

          <div class="mt-3 pt-3 border-t border-gray-200">
            <p class="text-[10px] font-medium mb-1.5">ช่วงที่เลือก</p>
            <p class="text-[12px] font-semibold leading-snug">{{ rangeLabel }}</p>
            <p class="text-[11px] mt-1">{{ loading ? '—' : rangeTotal }} ฉบับ</p>
          </div>
        </div>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.ns-daily-page,
.ns-daily-page :deep(h1),
.ns-daily-page :deep(h2),
.ns-daily-page :deep(h3),
.ns-daily-page :deep(p),
.ns-daily-page :deep(span),
.ns-daily-page :deep(label),
.ns-daily-page :deep(th),
.ns-daily-page :deep(td),
.ns-daily-page :deep(button),
.ns-daily-page :deep(input),
.ns-daily-page :deep(i) {
  color: #000000;
}

.ns-daily-page :deep(input[type='date']) {
  color-scheme: light;
}
</style>
