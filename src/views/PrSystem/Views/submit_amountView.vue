<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useTrcloudStore } from '@/stores/trcloud'

const emit = defineEmits(['selectPage'])

const trcloudStore = useTrcloudStore()
const loading = computed(() => trcloudStore.loading)
const trcloudDateFrom = computed({
  get: () => trcloudStore.dateFrom,
  set: (val) => trcloudStore.dateFrom = val
})
const trcloudDateTo = computed({
  get: () => trcloudStore.dateTo,
  set: (val) => trcloudStore.dateTo = val
})

const activeFilter = ref('')
const selectedStaffName = ref(null)
const searchQuery = ref('')
const detailSearchQuery = ref('')
const displayDateRange = ref({ from: '', to: '' })
const trackingMode = ref(false)

const TRACKING_STATUSES = ['new', 'partial']
function isTrackingStatus(status) {
  if (!status) return false
  const s = String(status).toLowerCase()
  return TRACKING_STATUSES.some(t => s.includes(t))
}

const isOutOfSync = computed(() => {
  return displayDateRange.value.from !== trcloudDateFrom.value || 
         displayDateRange.value.to !== trcloudDateTo.value
})

const staffSummary = computed(() => {
  let rows = trcloudStore.poItemRows

  // Client-side Date Filter (Instant filtering from memory)
  if (displayDateRange.value.from && displayDateRange.value.to) {
    rows = rows.filter(r => {
      let docDate = r.issue_date || ''
      if (!docDate) return false
      
      // Extract only YYYY-MM-DD in case there's a time string
      if (docDate.includes(' ')) {
        docDate = docDate.split(' ')[0]
      } else if (docDate.includes('T')) {
        docDate = docDate.split('T')[0]
      }
      
      return docDate >= displayDateRange.value.from && docDate <= displayDateRange.value.to
    })
  }

  const summaryMap = {}

  rows.forEach(row => {
    const staffName = row.staff || 'ไม่ระบุชื่อ'
    const docId = row.doc_number || row.invoice_number || row.unique_id
    
    if (!summaryMap[staffName]) {
      summaryMap[staffName] = {
        name: staffName,
        uniqueDocIds: new Set(),
        uniquePoIds: new Set(),
        uniqueApIds: new Set(),
        trackingDocIds: new Set(),
        totalAmount: 0,
        items: []
      }
    }

    // เก็บรายการทั้งหมดลงใน items เสมอ (สำหรับแสดงในตารางรายละเอียด)
    summaryMap[staffName].items.push(row)

    // นับจำนวนแบบไม่ซ้ำตามเลขที่เอกสาร
    if (docId && !summaryMap[staffName].uniqueDocIds.has(docId)) {
      summaryMap[staffName].uniqueDocIds.add(docId)

      const hasAp = row.expense || row.status?.includes('ชำระแล้ว') || row.status?.includes('AP')
      if (hasAp) {
        summaryMap[staffName].uniqueApIds.add(docId)
      } else {
        summaryMap[staffName].uniquePoIds.add(docId)
      }
    }

    // นับเฉพาะ status new / partial สำหรับโหมดติดตาม
    if (docId && isTrackingStatus(row.status)) {
      summaryMap[staffName].trackingDocIds.add(docId)
    }

    // บวกมูลค่าจาก item_total เสมอสำหรับทุกแถวรายการ
    summaryMap[staffName].totalAmount += parseFloat(row.item_total || 0)
  })

  return Object.values(summaryMap).map(s => ({
    ...s,
    count: s.uniqueDocIds.size,
    passedCount: s.uniqueApIds.size,
    notPassedCount: s.uniquePoIds.size,
    trackingCount: s.trackingDocIds.size,
  })).sort((a, b) => {
    if (trackingMode.value) return b.trackingCount - a.trackingCount
    return b.count - a.count
  })
})

const filteredStaffSummary = computed(() => {
  if (!searchQuery.value) return staffSummary.value
  const q = searchQuery.value.toLowerCase().trim()
  
  return staffSummary.value.filter(s => {
    // ค้นหาจากชื่อ Staff
    if (s.name.toLowerCase().includes(q)) return true
    
    // ค้นหาจากข้อมูลภายใน (เช่น วันที่ YYYY-MM-DD, เลขที่เอกสาร)
    return s.items.some(item => {
      const dateStr = item.issue_date || item.date || ''
      const docNum = item.document_number || item.po_id || ''
      return dateStr.includes(q) || docNum.toLowerCase().includes(q)
    })
  })
})

const selectedStaff = computed(() => {
  if (!selectedStaffName.value) return null
  return staffSummary.value.find(s => s.name === selectedStaffName.value) || null
})

const staffDetails = computed(() => {
  if (!selectedStaff.value) return []
  let items = selectedStaff.value.items
  if (trackingMode.value) {
    items = items.filter(item => isTrackingStatus(item.status))
  }
  if (detailSearchQuery.value) {
    const q = detailSearchQuery.value.toLowerCase().trim()
    items = items.filter(item => JSON.stringify(item).toLowerCase().includes(q))
  }
  return items.sort((a, b) => {
    const dateA = a.issue_date || a.date || ''
    const dateB = b.issue_date || b.date || ''
    return dateB.localeCompare(dateA)
  })
})

const expandedGroups = ref(new Set())

function toggleGroup(docNumber) {
  if (expandedGroups.value.has(docNumber)) {
    expandedGroups.value.delete(docNumber)
  } else {
    expandedGroups.value.add(docNumber)
  }
}

const groupedStaffDetails = computed(() => {
  const details = staffDetails.value
  const groups = []
  const groupMap = {}
  
  details.forEach(item => {
    const docNum = item.doc_number || item.invoice_number || 'N/A'
    if (!groupMap[docNum]) {
      groupMap[docNum] = {
        doc_number: docNum,
        issue_date: item.issue_date,
        organization: item.organization,
        project: item.project,
        pr: item.pr,
        status: item.status,
        currency: item.currency || 'LAK',
        items: [],
        totalAmount: 0
      }
      groups.push(groupMap[docNum])
    }
    groupMap[docNum].items.push(item)
    groupMap[docNum].totalAmount += Number(item.item_total || 0)
  })
  
  return groups
})

async function fetchData() {
  await trcloudStore.fetchTrcloudData('po')
  displayDateRange.value = {
    from: trcloudDateFrom.value,
    to: trcloudDateTo.value
  }
}

function selectStaff(staff) {
  selectedStaffName.value = staff.name
  detailSearchQuery.value = ''
}

function setToday() {
  const now = new Date()
  const yyyy = now.getFullYear()
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const dd = String(now.getDate()).padStart(2, '0')
  const today = `${yyyy}-${mm}-${dd}`
  trcloudDateFrom.value = today
  trcloudDateTo.value = today
  displayDateRange.value = { from: today, to: today }
  activeFilter.value = 'today'
}

function setAllData(shouldFetch = false) {
  const now = new Date()
  const yyyy = now.getFullYear()
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const dd = String(now.getDate()).padStart(2, '0')
  const today = `${yyyy}-${mm}-${dd}`
  
  // ตั้งค่าเป็นค่าว่างเพื่อให้แสดง "ข้อมูลทั้งหมด" ใน UI
  trcloudDateFrom.value = ''
  trcloudDateTo.value = ''
  displayDateRange.value = { from: '', to: '' }
  activeFilter.value = 'all'
  
  // แต่ถ้าต้อง Fetch จาก Server ให้ใช้ช่วงวันที่กว้างๆ (2020) ไปขอข้อมูล
  if (shouldFetch) {
    const originalFrom = trcloudDateFrom.value
    const originalTo = trcloudDateTo.value
    
    trcloudStore.dateFrom = '2020-01-01'
    trcloudStore.dateTo = today
    fetchData().then(() => {
      // หลัง Fetch เสร็จ ให้ UI กลับมาเป็นค่าว่างเหมือนเดิมเพื่อความสวยงาม
      trcloudDateFrom.value = ''
      trcloudDateTo.value = ''
      displayDateRange.value = { from: '', to: '' }
    })
  }
}

// Watch for manual date changes to reset activeFilter
watch([trcloudDateFrom, trcloudDateTo], () => {
  const now = new Date()
  const yyyy = now.getFullYear()
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const dd = String(now.getDate()).padStart(2, '0')
  const today = `${yyyy}-${mm}-${dd}`

  if (trcloudDateFrom.value === today && trcloudDateTo.value === today) {
      activeFilter.value = 'today'
    } else if (!trcloudDateFrom.value && !trcloudDateTo.value) {
      activeFilter.value = 'all'
    } else {
      activeFilter.value = ''
    }
  
  // Auto-apply filter if user changes dates manually and it's within current memory range?
  // No, let them press search or just update displayRange
})

function goToTankpo() {
  emit('selectPage', { itemId: '/#/tankpo', itemLabel: 'สรุปตามคนเปิด PO (แผนภูมิ)' })
}

function formatNumber(value) {
  if (value === null || value === undefined || value === '') return '-'
  const n = Number(value)
  if (!Number.isFinite(n)) return '-'
  return n.toLocaleString('th-TH')
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
  if (s.includes('ชำระแล้ว') || s.includes('paid') || s.includes('complete') || s.includes('อนุมัติ')) {
    return { text: status, bg: 'rgba(16,185,129,0.1)', color: '#10b981' }
  }
  if (s.includes('ยังไม่') || s.includes('ค้าง') || s.includes('unpaid') || s.includes('cancel')) {
    return { text: status, bg: 'rgba(239,68,68,0.1)', color: '#ef4444' }
  }
  return { text: status, bg: 'rgba(245,158,11,0.1)', color: '#f59e0b' }
}

onMounted(async () => {
  // Always set to All Data range and fetch to ensure memory has everything
  setAllData(true)
})
</script>

<template>
  <div class="flex flex-col h-full">
    <div class="mb-6 flex justify-between items-end">
      <div>
        <h1 class="text-[20px] font-semibold" style="color: var(--color-text-primary)">รายงานสรุปตามคนเปิด PO</h1>
        <p class="text-[13px] mt-0.5" style="color: var(--color-text-muted)">แสดงจำนวนเลขที่เอกสารและรายละเอียดแยกตามรายชื่อคนเปิด PO</p>
      </div>
      <div v-if="displayDateRange.from" class="flex flex-col items-end gap-1">
        <div class="text-[11px] font-medium text-gray-400 uppercase tracking-wider">กำลังแสดงข้อมูลช่วงวันที่</div>
        <div class="text-[13px] px-4 py-1.5 rounded-lg bg-blue-50 dark:bg-blue-900/30 border border-blue-100 dark:border-blue-800 shadow-sm" style="color: var(--color-blue-600)">
          <i class="fa-solid fa-filter mr-2 opacity-70"></i>
          <span class="font-bold">{{ displayDateRange.from }}</span> 
          <span class="mx-2 opacity-50">ถึง</span> 
          <span class="font-bold">{{ displayDateRange.to }}</span>
        </div>
      </div>
      <div v-else class="flex flex-col items-end gap-1">
        <div class="text-[11px] font-medium text-gray-400 uppercase tracking-wider">กำลังแสดงข้อมูล</div>
        <div class="text-[13px] px-4 py-1.5 rounded-lg bg-green-50 dark:bg-green-900/30 border border-green-100 dark:border-green-800 shadow-sm text-green-600">
          <i class="fa-solid fa-list-check mr-2 opacity-70"></i>
          <span class="font-bold">ข้อมูลทั้งหมดในระบบ</span>
        </div>
      </div>
    </div>

    <!-- Filters -->
    <div class="flex flex-wrap items-center gap-4 mb-6 p-4 rounded-xl border" style="background: var(--color-bg-card); border-color: var(--color-border)">
      
      <div class="flex items-center gap-4">
        <div class="flex items-center gap-2">
          <label class="text-[12px] font-medium" style="color: var(--color-text-muted)">จาก</label>
          <input v-model="trcloudDateFrom" type="date" class="px-3 py-1.5 bg-transparent border rounded-lg text-[13px] focus:outline-none" style="border-color: var(--color-border); color: var(--color-text-primary)" />
        </div>
        <div class="flex items-center gap-2">
          <label class="text-[12px] font-medium" style="color: var(--color-text-muted)">ถึง</label>
          <input v-model="trcloudDateTo" type="date" class="px-3 py-1.5 bg-transparent border rounded-lg text-[13px] focus:outline-none" style="border-color: var(--color-border); color: var(--color-text-primary)" />
        </div>
      </div>

      <div class="flex items-center gap-2 mr-2">
        <button
          @click="setToday"
          :class="[
            'px-3 py-1.5 rounded-lg text-[12px] font-medium border transition-colors',
            activeFilter === 'today' ? 'bg-blue-600 text-white border-blue-600' : 'hover:bg-gray-100 dark:hover:bg-gray-800'
          ]"
          :style="activeFilter !== 'today' ? { borderColor: 'var(--color-border)', color: 'var(--color-text-primary)' } : {}"
        >
          วันนี้
        </button>
        <button
          @click="setAllData"
          :class="[
            'px-3 py-1.5 rounded-lg text-[12px] font-medium border transition-colors',
            activeFilter === 'all' ? 'bg-blue-600 text-white border-blue-600' : 'hover:bg-gray-100 dark:hover:bg-gray-800'
          ]"
          :style="activeFilter !== 'all' ? { borderColor: 'var(--color-border)', color: 'var(--color-text-primary)' } : {}"
        >
          ข้อมูลทั้งหมด
        </button>
      </div>

      <button
        @click="fetchData"
        :disabled="loading"
        :class="[
          'px-6 py-1.5 rounded-lg text-[13px] font-bold transition-all shadow-sm flex items-center gap-2',
          isOutOfSync ? 'bg-blue-600 hover:bg-blue-700 text-white shadow-blue-200' : 'bg-gray-100 dark:bg-gray-800 text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700'
        ]"
      >
        <i class="fa-solid fa-rotate" :class="loading ? 'fa-spin' : ''"></i>
        {{ isOutOfSync ? 'ดึงข้อมูลใหม่จาก Server' : 'อัปเดตข้อมูล' }}
      </button>
      <div class="relative flex-1 min-w-[200px]">
        <i class="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-[14px]" style="color: var(--color-text-muted)"></i>
        <input v-model="searchQuery" type="text" placeholder="ค้นหาชื่อ Staff..." class="w-full pl-9 pr-4 py-1.5 bg-transparent border rounded-lg text-[13px] focus:outline-none" style="border-color: var(--color-border); color: var(--color-text-primary)" />
      </div>
      <!-- ปุ่มโหมดติดตาม + ดูแผนภูมิ ชิดขวา -->
      <div class="ml-auto flex items-center gap-2">
        <button
          @click="trackingMode = !trackingMode"
          class="px-4 py-1.5 rounded-lg text-[13px] font-semibold border transition-all flex items-center gap-1.5"
          :style="trackingMode
            ? { background: '#f59e0b', borderColor: '#f59e0b', color: '#fff' }
            : { borderColor: 'var(--color-border)', color: '#f59e0b', background: 'var(--color-bg-card)' }"
        >
          <i class="fa-solid fa-crosshairs"></i>
          ติดตาม
          <span v-if="trackingMode" class="text-[10px] opacity-80">(new / partial)</span>
        </button>
        <button @click="goToTankpo" class="px-4 py-1.5 rounded-lg text-[13px] font-medium border hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors flex items-center gap-1.5" style="border-color: var(--color-border); color: var(--color-text-muted)">
          <i class="fa-solid fa-chart-bar"></i>
          ดูแผนภูมิ
          <i class="fa-solid fa-arrow-right text-[11px]"></i>
        </button>
      </div>
    </div>

    <div class="flex flex-1 gap-6 overflow-hidden min-h-0">
      <!-- Left Side: Staff List -->
      <div class="w-1/4 flex flex-col rounded-xl border overflow-hidden" style="background: var(--color-bg-card); border-color: var(--color-border)">
        <div class="p-3 font-semibold text-[14px] bg-gray-50 dark:bg-gray-900/50 flex justify-between items-center" style="color: var(--color-text-primary); border-bottom: 1px solid var(--color-border)">
          <span>รายชื่อคนเปิด PO ({{ filteredStaffSummary.length }})</span>
          <div class="flex gap-2 text-[10px]">
            <span class="flex items-center gap-1"><span class="w-2 h-2 bg-orange-400 rounded-full"></span> PO</span>
            <span class="flex items-center gap-1"><span class="w-2 h-2 bg-cyan-400 rounded-full"></span> AP</span>
          </div>
        </div>
        <div class="flex-1 overflow-auto">
          <div v-if="loading" class="p-8 text-center">
            <i class="fa-solid fa-circle-notch fa-spin text-2xl text-blue-500 mb-2"></i>
            <p class="text-[13px]" style="color: var(--color-text-muted)">กำลังโหลด...</p>
          </div>
          <div v-else-if="filteredStaffSummary.length === 0" class="p-8 text-center" style="color: var(--color-text-muted)">
            ไม่พบข้อมูล
          </div>
          <div
            v-for="staff in filteredStaffSummary"
            :key="staff.name"
            @click="selectStaff(staff)"
            :class="[
              'p-4 cursor-pointer border-b transition-all flex items-center gap-4',
              selectedStaff?.name === staff.name ? 'border-l-4 border-l-gray-900 dark:border-l-white' : 'border-l-4 border-l-transparent'
            ]"
            style="border-bottom-color: var(--color-border)"
          >
            <div class="flex items-end gap-1 h-10 w-8 flex-shrink-0">
              <div
                class="w-3 bg-orange-400 rounded-t-sm transition-all duration-500"
                :style="{ height: `${Math.max((staff.notPassedCount / staff.count) * 100, 10)}%` }"
                :title="`ไม่ผ่าน: ${staff.notPassedCount} รายการ`"
              ></div>
              <div
                class="w-3 bg-cyan-400 rounded-t-sm transition-all duration-500"
                :style="{ height: `${Math.max((staff.passedCount / staff.count) * 100, 10)}%` }"
                :title="`ผ่าน: ${staff.passedCount} รายการ`"
              ></div>
            </div>
            <div class="flex-1 min-w-0">
              <div class="flex justify-between items-start mb-1">
                <span class="font-semibold text-[13px] truncate mr-2" :style="{ color: selectedStaff?.name === staff.name ? 'var(--color-text-primary)' : 'var(--color-text-muted)' }">{{ staff.name }}</span>
                <span
                  class="px-2 py-0.5 rounded-full text-[10px] font-bold whitespace-nowrap"
                  :class="trackingMode ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400' : 'border border-gray-200 text-gray-500 dark:border-gray-700 dark:text-gray-400'"
                >
                  {{ trackingMode ? staff.trackingCount : staff.count }} รายการ
                </span>
              </div>
              <div class="flex justify-between items-center text-[11px]">
                <div style="color: var(--color-text-muted)">
                  <template v-if="trackingMode">
                    ทั้งหมด: <span class="font-mono font-medium">{{ staff.count }}</span>
                  </template>
                  <template v-else>
                    มูลค่ารวม: <span class="font-mono font-medium">{{ staff.totalAmount.toLocaleString('th-TH', {minimumFractionDigits:2}) }}</span>
                  </template>
                </div>
                <div class="flex gap-2 text-[10px] font-medium">
                  <template v-if="trackingMode">
                    <span class="text-amber-500">new/partial: {{ staff.trackingCount }}</span>
                  </template>
                  <template v-else>
                    <span class="text-orange-500">PO: {{ staff.notPassedCount }}</span>
                    <span class="text-cyan-600">AP: {{ staff.passedCount }}</span>
                  </template>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Right Side: Detail Table -->
      <div class="flex-1 flex flex-col rounded-xl border overflow-hidden" style="background: var(--color-bg-card); border-color: var(--color-border)">
        <div class="p-3 font-semibold text-[14px] bg-gray-50 dark:bg-gray-900/50 flex flex-col gap-3" style="color: var(--color-text-primary); border-bottom: 1px solid var(--color-border)">
          <div class="flex justify-between items-center">
            <span>รายละเอียดข้อมูล: {{ selectedStaff?.name || 'เลือก Staff เพื่อดูข้อมูล' }}</span>
            <div v-if="selectedStaff" class="flex items-center gap-3">
              <span class="text-[12px] font-normal" style="color: var(--color-text-muted)">
                จำนวนทั้งหมด <span class="font-bold text-orange-600">{{ staffDetails.length }}</span> รายการ
              </span>
            </div>
          </div>
          <div v-if="selectedStaff" class="relative">
            <i class="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-[12px]" style="color: var(--color-text-muted)"></i>
            <input
              v-model="detailSearchQuery"
              type="text"
              placeholder="ค้นหาในตารางรายละเอียด (เลขที่เอกสาร, โครงการ, สถานะ...)"
              class="w-full pl-8 pr-4 py-1.5 bg-white dark:bg-gray-800 border rounded-lg text-[12px] focus:outline-none transition-all focus:ring-1 focus:ring-black dark:focus:ring-white"
              style="border-color: var(--color-border); color: var(--color-text-primary)"
            />
          </div>
        </div>
        <div class="flex-1 overflow-auto">
          <table v-if="selectedStaff" class="w-full text-[13px] border-collapse">
            <thead class="sticky top-0 z-10 bg-gray-50 dark:bg-gray-900" style="border-bottom: 1px solid var(--color-border)">
              <tr>
                <th class="px-4 py-3 text-center font-medium w-10" style="color: var(--color-text-muted)"></th>
                <th class="px-4 py-3 text-left font-medium whitespace-nowrap" style="color: var(--color-text-muted)">เลขที่เอกสาร / วันที่</th>
                <th class="px-4 py-3 text-left font-medium" style="color: var(--color-text-muted)">โครงการ / คู่ค้า / อ้างอิง</th>
                <th class="px-4 py-3 text-right font-medium whitespace-nowrap" style="color: var(--color-text-muted)">ยอดรวมทั้งหมด</th>
                <th class="px-4 py-3 text-center font-medium whitespace-nowrap" style="color: var(--color-text-muted)">สถานะ</th>
              </tr>
            </thead>
            <tbody>
              <template v-for="group in groupedStaffDetails" :key="group.doc_number">
                <!-- Group Header Row -->
                <tr
                  class="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors cursor-pointer"
                  style="border-bottom: 1px solid var(--color-border)"
                  @click="toggleGroup(group.doc_number)"
                >
                  <td class="px-4 py-4 text-center">
                    <button 
                      class="w-6 h-6 rounded flex items-center justify-center transition-colors"
                      :class="expandedGroups.has(group.doc_number) ? 'bg-red-500 text-white' : 'bg-blue-500 text-white'"
                    >
                      <i :class="['fa-solid', expandedGroups.has(group.doc_number) ? 'fa-minus' : 'fa-plus', 'text-[10px]']"></i>
                    </button>
                  </td>
                  <td class="px-4 py-4">
                    <div class="font-bold text-[14px] text-blue-600 dark:text-blue-400 font-mono">{{ group.doc_number }}</div>
                    <div class="text-[11px] text-gray-500 mt-1">{{ group.issue_date }}</div>
                  </td>
                  <td class="px-4 py-4">
                    <div class="flex flex-col gap-1">
                      <div class="flex items-center gap-2">
                        <span class="text-orange-600 dark:text-orange-400 font-bold text-[12px]"><i class="fa-solid fa-folder-open mr-1"></i>{{ group.project || 'ไม่มีโครงการ' }}</span>
                        <span class="text-purple-600 dark:text-purple-400 font-medium text-[12px]"><i class="fa-solid fa-file-invoice mr-1"></i>{{ group.pr || '-' }}</span>
                      </div>
                      <div class="text-[13px] font-medium text-gray-700 dark:text-gray-200">{{ group.organization || '-' }}</div>
                    </div>
                  </td>
                  <td class="px-4 py-4 text-right">
                    <div class="text-[15px] font-bold text-black dark:text-white font-mono">
                      {{ group.totalAmount.toLocaleString('th-TH', {minimumFractionDigits:2}) }}
                    </div>
                    <div class="text-[10px] text-gray-400 uppercase">{{ group.currency }}</div>
                  </td>
                  <td class="px-4 py-4 text-center">
                    <span
                      class="px-3 py-1.5 rounded-lg text-[11px] font-bold"
                      :style="{ backgroundColor: getBadgeInfo(group.status).bg, color: getBadgeInfo(group.status).color }"
                    >
                      {{ getBadgeInfo(group.status).text }}
                    </span>
                  </td>
                </tr>

                <!-- Group Details Row (Expandable) -->
                <tr v-if="expandedGroups.has(group.doc_number)" class="bg-gray-50/50 dark:bg-gray-900/20">
                  <td colspan="5" class="px-8 py-4">
                    <div class="rounded-lg border overflow-hidden shadow-sm" style="border-color: var(--color-border)">
                      <table class="w-full text-[12px]">
                        <thead class="bg-red-500 text-white">
                          <tr>
                            <th class="px-4 py-2 text-left font-medium">ลำดับ</th>
                            <th class="px-4 py-2 text-left font-medium">รายการสินค้า / คำอธิบาย</th>
                            <th class="px-4 py-2 text-center font-medium">จำนวน</th>
                            <th class="px-4 py-2 text-right font-medium">ราคา/หน่วย</th>
                            <th class="px-4 py-2 text-right font-medium">ยอดรวม ({{ group.currency }})</th>
                          </tr>
                        </thead>
                        <tbody class="bg-white dark:bg-gray-800">
                          <tr v-for="(item, index) in group.items" :key="item.unique_id" class="border-b last:border-0" style="border-color: var(--color-border)">
                            <td class="px-4 py-2 text-gray-500 font-mono">{{ index + 1 }}</td>
                            <td class="px-4 py-2 font-medium">{{ item.item_name || '-' }}</td>
                            <td class="px-4 py-2 text-center font-mono">{{ formatNumber(item.quantity) }}</td>
                            <td class="px-4 py-2 text-right font-mono">{{ formatNumber(item.price) }}</td>
                            <td class="px-4 py-2 text-right font-bold font-mono text-black dark:text-white">
                              {{ Number(item.item_total || 0).toLocaleString('th-TH', {minimumFractionDigits:2}) }}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </td>
                </tr>
              </template>
            </tbody>
          </table>
          <div v-else class="h-full flex flex-col items-center justify-center p-12 text-center" style="color: var(--color-text-muted)">
            <i class="fa-solid fa-mouse-pointer text-4xl mb-4 opacity-20"></i>
            <p>กรุณาเลือกรายชื่อ Staff จากแถบด้านซ้ายมือ<br>เพื่อเรียกดูรายละเอียดเลขที่เอกสาร</p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.overflow-auto::-webkit-scrollbar { width: 6px; height: 6px; }
.overflow-auto::-webkit-scrollbar-track { background: transparent; }
.overflow-auto::-webkit-scrollbar-thumb { background: rgba(156,163,175,0.3); border-radius: 10px; }
.overflow-auto::-webkit-scrollbar-thumb:hover { background: rgba(156,163,175,0.5); }
</style>