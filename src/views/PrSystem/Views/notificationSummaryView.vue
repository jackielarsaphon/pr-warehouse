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

const DOC_TYPES = [
  { key: 'pr', label: 'PR', icon: 'fa-file-lines', color: '#3b82f6' },
  { key: 'po', label: 'PO', icon: 'fa-file-invoice-dollar', color: '#8b5cf6' },
  { key: 'ap', label: 'AP', icon: 'fa-file-invoice', color: '#f59e0b' },
  { key: 'pv', label: 'PV', icon: 'fa-money-check-dollar', color: '#10b981' },
]

const WEEKDAYS = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส']

const QUICK_PRESETS = [
  { key: 'today', label: 'วันนี้' },
  { key: 'yesterday', label: 'เมื่อวาน' },
  { key: 'week', label: '7 วันล่าสุด' },
  { key: 'month', label: 'เดือนนี้' },
]

function ymd(d) {
  const x = new Date(d)
  const yyyy = String(x.getFullYear())
  const mm = String(x.getMonth() + 1).padStart(2, '0')
  const dd = String(x.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
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

const activePreset = computed(() => {
  const now = new Date()
  const today = ymd(now)
  const yesterday = ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1))
  const weekStart = ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6))
  const monthStart = ymd(new Date(now.getFullYear(), now.getMonth(), 1))
  if (filterFrom.value === today && filterTo.value === today) return 'today'
  if (filterFrom.value === yesterday && filterTo.value === yesterday) return 'yesterday'
  if (filterFrom.value === weekStart && filterTo.value === today) return 'week'
  if (filterFrom.value === monthStart && filterTo.value === today) return 'month'
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
    const date = new Date(calendarYear.value, calendarMonth.value - 1, day)
    cells.push(buildCalendarCell(date, true))
  }
  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(calendarYear.value, calendarMonth.value, day)
    cells.push(buildCalendarCell(date, false))
  }
  while (cells.length < 42) {
    const day = cells.length - startPad - daysInMonth + 1
    const date = new Date(calendarYear.value, calendarMonth.value + 1, day)
    cells.push(buildCalendarCell(date, true))
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
    month: 'long',
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
  if (!ymdStr) return '-'
  const d = parseYmd(ymdStr)
  if (!d) return ymdStr
  return d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' })
}

function formatThaiLongDate(ymdStr) {
  if (!ymdStr) return '-'
  const d = parseYmd(ymdStr)
  if (!d) return ymdStr
  return d.toLocaleDateString('th-TH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}

function isToday(key) {
  return key === ymd(new Date())
}

function isInRange(key) {
  return key >= filterFrom.value && key <= filterTo.value
}

function isRangeStart(key) {
  return key === filterFrom.value
}

function isRangeEnd(key) {
  return key === filterTo.value
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

function applyQuickPreset(key) {
  const now = new Date()
  const today = ymd(now)
  if (key === 'today') setRange(today, today)
  else if (key === 'yesterday') {
    const y = ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1))
    setRange(y, y)
  } else if (key === 'week') {
    const start = ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6))
    setRange(start, today)
  } else if (key === 'month') {
    const start = ymd(new Date(now.getFullYear(), now.getMonth(), 1))
    setRange(start, today)
  }
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

function goTodayMonth() {
  const now = new Date()
  calendarYear.value = now.getFullYear()
  calendarMonth.value = now.getMonth()
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

async function fetchDashboardData(force = false) {
  loading.value = true
  errorText.value = ''
  try {
    const from = filterFrom.value
    const to = filterTo.value
    const now = ymd(new Date())
    const monthStart = ymd(new Date(new Date().getFullYear(), new Date().getMonth(), 1))
    const fetchFrom = from < monthStart ? from : monthStart
    const fetchTo = to > now ? to : now

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

let rangeWatchReady = false

watch([filterFrom, filterTo], () => {
  if (!rangeWatchReady) return
  fetchDashboardData()
})

onMounted(() => {
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
    <div class="mb-5 flex flex-col md:flex-row md:items-end justify-between gap-4">
      <div>
        <h1 class="text-[20px] font-semibold flex items-center gap-2">
          <i class="fa-solid fa-bell"></i>
          สรุปข้อมูลแจ้งเตือน รายวัน
        </h1>
        <div class="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1">
          <p class="text-[13px]">
            <i class="fa-regular fa-calendar-check mr-1"></i>
            {{ formatCurrentDate(currentTime) }}
          </p>
          <span class="w-1 h-1 bg-gray-300 rounded-full hidden sm:block"></span>
          <p class="text-[13px]">
            <i class="fa-regular fa-clock mr-1"></i>
            อัปเดตล่าสุด: {{ formatCurrentTime(currentTime) }}
          </p>
        </div>
      </div>

      <button
        type="button"
        :disabled="loading"
        class="px-4 py-2 rounded-lg text-[13px] font-medium bg-white border border-gray-300 hover:bg-gray-50 disabled:opacity-50 transition-colors flex items-center gap-2 self-start"
        @click="fetchDashboardData(true)"
      >
        <i class="fa-solid fa-rotate" :class="loading ? 'fa-spin' : ''"></i>
        อัปเดตข้อมูล
      </button>
    </div>

    <div
      v-if="errorText"
      class="mb-4 rounded-xl border p-3 text-[13px]"
      style="border-color: rgba(0, 0, 0, 0.15); background: rgba(0, 0, 0, 0.04)"
    >
      {{ errorText }}
    </div>

    <!-- Calendar + range picker -->
    <div
      class="rounded-xl border p-4 mb-6"
      style="background: var(--color-bg-card); border-color: var(--color-border)"
    >
      <div class="flex flex-col lg:flex-row gap-6">
        <!-- Calendar -->
        <div class="flex-1 min-w-0">
          <div class="flex items-center justify-between mb-3">
            <h2 class="text-[14px] font-semibold">
              <i class="fa-solid fa-calendar-days mr-2"></i>
              เลือกวันที่
            </h2>
            <div class="flex items-center gap-1">
              <button
                type="button"
                class="w-8 h-8 rounded-lg border border-gray-300 hover:bg-gray-50 transition-colors inline-flex items-center justify-center"
                @click="prevMonth"
              >
                <i class="fa-solid fa-chevron-left text-[11px]"></i>
              </button>
              <button
                type="button"
                class="px-3 h-8 rounded-lg text-[12px] font-medium border border-gray-300 hover:bg-gray-50 transition-colors"
                @click="goTodayMonth"
              >
                {{ calendarMonthLabel }}
              </button>
              <button
                type="button"
                class="w-8 h-8 rounded-lg border border-gray-300 hover:bg-gray-50 transition-colors inline-flex items-center justify-center"
                @click="nextMonth"
              >
                <i class="fa-solid fa-chevron-right text-[11px]"></i>
              </button>
            </div>
          </div>

          <p class="text-[11px] mb-2">
            คลิกวันแรก แล้วคลิกวันที่สองเพื่อเลือกช่วง — คลิกวันเดียว = ดูเอกสารวันนั้น
          </p>

          <div class="grid grid-cols-7 gap-1 mb-1">
            <div
              v-for="wd in WEEKDAYS"
              :key="wd"
              class="text-center text-[11px] font-semibold py-1"
            >
              {{ wd }}
            </div>
          </div>

          <div class="grid grid-cols-7 gap-1">
            <button
              v-for="cell in calendarDays"
              :key="cell.key + '-' + cell.day"
              type="button"
              class="relative aspect-square rounded-lg text-[12px] font-medium transition-all flex flex-col items-center justify-center gap-0.5"
              :class="[
                cell.outside ? 'opacity-35' : '',
                isInRange(cell.key) ? 'cal-day-in-range' : 'hover:bg-gray-100',
                isRangeStart(cell.key) || isRangeEnd(cell.key) ? 'ring-2 ring-gray-400 ring-offset-1 z-10' : '',
                isToday(cell.key) && !isInRange(cell.key) ? 'ring-1 ring-gray-400' : '',
              ]"
              :style="{
                background: isInRange(cell.key)
                  ? isRangeStart(cell.key) || isRangeEnd(cell.key)
                    ? 'rgba(0, 0, 0, 0.12)'
                    : 'rgba(0, 0, 0, 0.06)'
                  : 'transparent',
              }"
              @click="onDayClick(cell.key)"
            >
              <span>{{ cell.day }}</span>
              <span
                v-if="cell.count > 0 && !isInRange(cell.key)"
                class="text-[9px] font-bold leading-none px-1 rounded-full bg-gray-200"
              >
                {{ cell.count }}
              </span>
            </button>
          </div>
        </div>

        <!-- Range controls -->
        <div class="lg:w-[280px] shrink-0 flex flex-col gap-4">
          <div>
            <p class="text-[12px] font-semibold mb-2">ช่วงที่เลือก</p>
            <p class="text-[14px] font-semibold leading-snug">
              {{ rangeLabel }}
            </p>
            <p class="text-[12px] mt-1">
              รวม {{ loading ? '—' : rangeTotal }} ฉบับ
              <span v-if="rangeAnchor"> — คลิกวันที่สองเพื่อกำหนดช่วง</span>
            </p>
          </div>

          <div class="space-y-2">
            <label class="block">
              <span class="text-[11px] font-medium mb-1 block">ตั้งแต่</span>
              <input
                v-model="filterFrom"
                type="date"
                class="w-full px-3 py-2 rounded-lg text-[13px] border border-gray-300 bg-white focus:outline-none focus:ring-1 focus:ring-gray-400"
                @change="onDateInputChange"
              />
            </label>
            <label class="block">
              <span class="text-[11px] font-medium mb-1 block">ถึง</span>
              <input
                v-model="filterTo"
                type="date"
                class="w-full px-3 py-2 rounded-lg text-[13px] border border-gray-300 bg-white focus:outline-none focus:ring-1 focus:ring-gray-400"
                @change="onDateInputChange"
              />
            </label>
          </div>

          <div>
            <p class="text-[11px] font-medium mb-2">เลือกเร็ว</p>
            <div class="flex flex-wrap gap-2">
              <button
                v-for="p in QUICK_PRESETS"
                :key="p.key"
                type="button"
                class="px-3 py-1.5 rounded-lg text-[12px] font-medium border border-gray-300 transition-colors hover:bg-gray-50"
                :class="activePreset === p.key ? 'bg-gray-200' : 'bg-white'"
                @click="applyQuickPreset(p.key)"
              >
                {{ p.label }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="py-16 text-center">
      <i class="fa-solid fa-circle-notch fa-spin text-3xl mb-4"></i>
      <p>กำลังดึงข้อมูลเอกสาร...</p>
    </div>

    <template v-else>
      <!-- Type summary cards -->
      <div class="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
        <button
          v-for="t in DOC_TYPES"
          :key="t.key"
          type="button"
          class="rounded-xl border p-4 text-left transition-all hover:shadow-md"
          :class="activeDocTab === t.key ? 'ring-2 ring-offset-1' : ''"
          :style="{
            background: 'var(--color-bg-card)',
            borderColor: activeDocTab === t.key ? '#000' : 'var(--color-border)',
            borderLeft: '4px solid #000',
          }"
          @click="activeDocTab = t.key"
        >
          <div class="flex items-center gap-2 mb-2">
            <i class="fa-solid" :class="t.icon"></i>
            <span class="text-[13px] font-semibold">{{ t.label }}</span>
          </div>
          <p class="text-[28px] font-bold leading-none">
            {{ typeCounts[t.key] }}
            <span class="text-[13px] font-normal">ฉบับ</span>
          </p>
          <p class="text-[11px] mt-2">
            {{ isSingleDay ? 'สร้างในวันนี้' : 'สร้างในช่วงที่เลือก' }}
          </p>
        </button>
      </div>

      <!-- Document tabs -->
      <div
        class="rounded-xl border overflow-hidden"
        style="background: var(--color-bg-card); border-color: var(--color-border)"
      >
        <div
          class="px-4 py-3 border-b flex flex-col sm:flex-row sm:items-center justify-between gap-3"
          style="border-color: var(--color-border)"
        >
          <div class="flex items-center gap-2 p-1 bg-gray-100 rounded-xl w-fit">
            <button
              v-for="t in DOC_TYPES"
              :key="t.key"
              type="button"
              class="px-4 py-1.5 rounded-lg text-[12px] font-semibold transition-all flex items-center gap-1.5"
              :class="activeDocTab === t.key ? 'bg-white shadow-sm' : ''"
              @click="activeDocTab = t.key"
            >
              <i class="fa-solid" :class="t.icon"></i>
              {{ t.label }}
              <span class="px-1.5 py-0.5 rounded-full text-[10px] bg-gray-200">
                {{ typeCounts[t.key] }}
              </span>
            </button>
          </div>
          <p class="text-[12px]">
            เอกสารที่ถูกสร้าง{{ isSingleDay ? ' วันที่' : ' ระหว่าง' }} {{ rangeLabel }}
          </p>
        </div>

        <div v-if="activeRows.length" class="overflow-x-auto max-h-[480px] overflow-y-auto">
          <table class="w-full text-[13px] border-collapse min-w-[720px]">
            <thead class="sticky top-0 z-10" style="background: var(--color-bg-card)">
              <tr style="border-bottom: 1px solid var(--color-border)">
                <th class="px-4 py-2.5 text-left font-medium">เลขที่เอกสาร</th>
                <th class="px-4 py-2.5 text-left font-medium">วันที่สร้าง</th>
                <th class="px-4 py-2.5 text-left font-medium">คู่ค้า / โครงการ</th>
                <th class="px-4 py-2.5 text-left font-medium">Staff</th>
                <th class="px-4 py-2.5 text-right font-medium">มูลค่า</th>
                <th class="px-4 py-2.5 text-right font-medium">สถานะ</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="row in activeRows"
                :key="getRowDocNo(row, activeDocTab) + getRowDate(row)"
                class="hover:bg-gray-50 transition-colors"
                style="border-bottom: 1px solid var(--color-border)"
              >
                <td class="px-4 py-2.5 font-mono font-medium">
                  {{ getRowDocNo(row, activeDocTab) }}
                </td>
                <td class="px-4 py-2.5 whitespace-nowrap">
                  {{ formatThaiShortDate(getRowDate(row)) }}
                </td>
                <td class="px-4 py-2.5 max-w-[200px] truncate" :title="row.organization || row.project || ''">
                  {{ row.organization || row.project || '-' }}
                </td>
                <td class="px-4 py-2.5">{{ row.staff || row.created_by || '-' }}</td>
                <td class="px-4 py-2.5 text-right font-mono whitespace-nowrap">
                  {{ Number(row.grand_total || row.total || row.item_total || 0).toLocaleString('th-TH', { minimumFractionDigits: 2 }) }}
                </td>
                <td class="px-4 py-2.5 text-right">
                  <span class="px-2 py-0.5 rounded-lg text-[11px] font-medium bg-gray-100">
                    {{ row.status || row.payment_status || '-' }}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div v-else class="py-16 text-center">
          <i class="fa-solid fa-inbox text-4xl mb-4 opacity-20"></i>
          <p class="text-[15px] font-medium">
            ไม่พบเอกสาร {{ DOC_TYPES.find((x) => x.key === activeDocTab)?.label }} ในช่วงที่เลือก
          </p>
        </div>
      </div>
    </template>
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
