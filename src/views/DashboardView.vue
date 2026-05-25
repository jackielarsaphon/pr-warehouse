<script setup>
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from 'vue'
import { Chart, registerables } from 'chart.js'
import AppLayout from '@/components/layout/AppLayout.vue'
import StatCard from '@/components/ui/StatCard.vue'
import { supabase } from '@/lib/supabase'

Chart.register(...registerables)

// ─── State ────────────────────────────────────────────────────────────────────
const loading = ref(true)
const activeFilter = ref('this_month')
const customFrom = ref('')
const customTo = ref('')
const showCustomPicker = ref(false)

// KPI
const totalItems        = ref(0)
const totalCategories   = ref(0)
const importsInPeriod   = ref(0)
const txInPeriod        = ref(0)
const pendingOrders     = ref(0)
const approvedOrders    = ref(0)
const rejectedOrders    = ref(0)
const completedOrders   = ref(0)
const totalImportQty    = ref(0)
const totalTxQty        = ref(0)
const lowStockCount     = ref(0)
const outOfStockCount   = ref(0)
const uniqueRequesterCount = ref(0)

// Modal State
const isDetailModalOpen = ref(false)
const modalTitle = ref('')
const modalData = ref([])
const modalLoading = ref(false)
const modalSearchText = ref('')
const modalType = ref('')
const selectedCategoryName = ref('')

// Trend
const trendImports  = ref({ text: '—', type: 'neutral' })
const trendTx       = ref({ text: '—', type: 'neutral' })
const trendPending  = ref({ text: '—', type: 'neutral' })
const trendApproval = ref({ text: '—', type: 'neutral' })

// Table & List data
const recentTransactions  = ref([])
const lowStockItems       = ref([])
const topWithdrawItems    = ref([])
const recentOrders        = ref([])
const categoryProducts    = ref([])
const orderStatusItems    = ref([])
const topRequesters       = ref([])

// Search State
const summarySearchText = ref('')
const topWithdrawSearchText = ref('')
const requesterSearchText = ref('')

// Chart refs & instances
const lineChartRef   = ref(null)
const barChartRef    = ref(null)
let lineChart, barChart

const lineLabels         = ref([])
const lineImportsSeries  = ref([])
const lineTxSeries       = ref([])
const barLabels          = ref([])
const barSeries          = ref([])

const PALETTE = ['#64748B', '#94A3B8', '#475569', '#CBD5E1', '#334155', '#E2E8F0', '#1E293B', '#F1F5F9', '#0F172A', '#94A3B8']

// ─── Theme detection ─────────────────────────────────────────────────────────
function getChartColors() {
  const isDark = document.documentElement.classList.contains('dark')
  return {
    primaryText: isDark ? '#F1F5F9' : '#0F172A',
    secondaryText: isDark ? '#94A3B8' : '#475569',
    gridColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.04)'
  }
}

let themeObserver
function initThemeObserver() {
  themeObserver = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (mutation.attributeName === 'class') {
        buildCharts()
      }
    })
  })
  themeObserver.observe(document.documentElement, { attributes: true })
}

// ─── Date helpers ─────────────────────────────────────────────────────────────
function startOfDay(d) { const x=new Date(d); x.setHours(0,0,0,0); return x }
function endOfDay(d)   { const x=new Date(d); x.setHours(23,59,59,999); return x }
function startOfWeek(d) {
  const x = new Date(d)
  const day = x.getDay()
  x.setDate(x.getDate() - (day === 0 ? 6 : day - 1))
  x.setHours(0,0,0,0)
  return x
}
function endOfWeek(d) {
  const x = startOfWeek(d)
  x.setDate(x.getDate() + 6)
  x.setHours(23,59,59,999)
  return x
}
function fmtDate(d) {
  const x = new Date(d)
  return `${x.getDate()}/${x.getMonth()+1}`
}
function fmtDateFull(iso) {
  return new Date(iso).toLocaleDateString('th-TH', { day:'2-digit', month:'short', year:'numeric' })
}
function fmtDateTimeShort(iso) {
  const d = new Date(iso)
  return `${d.getDate()}/${d.getMonth()+1} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
}
function dayKey(d) {
  const x = new Date(d)
  return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}-${String(x.getDate()).padStart(2,'0')}`
}

// ─── Period resolver ──────────────────────────────────────────────────────────
function getDateRange() {
  const now = new Date()
  switch (activeFilter.value) {
    case 'this_week':
      return { from: startOfWeek(now), to: endOfWeek(now), prevFrom: startOfWeek(new Date(now - 7*86400000)), prevTo: endOfWeek(new Date(now - 7*86400000)), label: 'สัปดาห์นี้', days: 7 }
    case 'last_week': {
      const lw = new Date(now - 7*86400000)
      return { from: startOfWeek(lw), to: endOfWeek(lw), prevFrom: startOfWeek(new Date(now - 14*86400000)), prevTo: endOfWeek(new Date(now - 14*86400000)), label: 'สัปดาห์ที่แล้ว', days: 7 }
    }
    case 'last_month': {
      const lm = new Date(now.getFullYear(), now.getMonth()-1, 1)
      const lme = new Date(now.getFullYear(), now.getMonth(), 0)
      const llm = new Date(now.getFullYear(), now.getMonth()-2, 1)
      const llme = new Date(now.getFullYear(), now.getMonth()-1, 0)
      return { from: startOfDay(lm), to: endOfDay(lme), prevFrom: startOfDay(llm), prevTo: endOfDay(llme), label: 'เดือนที่แล้ว', days: lme.getDate() }
    }
    case 'custom': {
      const f = customFrom.value ? new Date(customFrom.value) : new Date()
      const t = customTo.value ? new Date(customTo.value) : new Date()
      return { from: startOfDay(f), to: endOfDay(t), prevFrom: null, prevTo: null, label: 'กำหนดเอง', days: Math.ceil((endOfDay(t)-startOfDay(f))/(86400000))+1 }
    }
    default: {
      const ms = new Date(now.getFullYear(), now.getMonth(), 1)
      const lms = new Date(now.getFullYear(), now.getMonth()-1, 1)
      const lme = new Date(now.getFullYear(), now.getMonth(), 0)
      return { from: startOfDay(ms), to: endOfDay(now), prevFrom: startOfDay(lms), prevTo: endOfDay(lme), label: 'เดือนนี้', days: now.getDate() }
    }
  }
}

function trendDelta(cur, prev, labelPrev) {
  if (prev === 0 && cur === 0) return { text: `เท่าเดิม`, type: 'neutral' }
  if (prev === 0) return { text: `+${cur} vs ${labelPrev}`, type: 'up' }
  const diff = cur - prev
  const pct = Math.round((diff / prev) * 100)
  if (diff > 0) return { text: `▲ ${diff} (+${pct}%) vs ${labelPrev}`, type: 'up' }
  if (diff < 0) return { text: `▼ ${Math.abs(diff)} (${pct}%) vs ${labelPrev}`, type: 'down' }
  return { text: `เท่าเดิม vs ${labelPrev}`, type: 'neutral' }
}

// ─── Fetch ────────────────────────────────────────────────────────────────────
async function fetchDashboardData() {
  loading.value = true
  destroyCharts()
  try {
    const { from, to, prevFrom, prevTo, label, days } = getDateRange()
    const fromISO = from.toISOString()
    const toISO   = to.toISOString()

    const dayKeys = []
    for (let i = 0; i < Math.min(days, 31); i++) {
      const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + i)
      if (d > to) break
      dayKeys.push(dayKey(d))
    }

    const queries = [
      supabase.from('items').select('*', { count: 'exact', head: true }),
      supabase.from('category').select('*', { count: 'exact', head: true }),
      supabase.from('inventory_imports').select('*', { count: 'exact', head: true }).gte('created_at', fromISO).lte('created_at', toISO),
      supabase.from('transactions').select('*', { count: 'exact', head: true }).gte('created_at', fromISO).lte('created_at', toISO),
      supabase.from('order_req').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
      supabase.from('order_req').select('*', { count: 'exact', head: true }).eq('status', 'approved').gte('created_at', fromISO).lte('created_at', toISO),
      supabase.from('order_req').select('*', { count: 'exact', head: true }).eq('status', 'rejected').gte('created_at', fromISO).lte('created_at', toISO),
      supabase.from('order_req').select('*', { count: 'exact', head: true }).eq('status', 'completed').gte('created_at', fromISO).lte('created_at', toISO),
      supabase.from('inventory_imports').select('amount').gte('created_at', fromISO).lte('created_at', toISO),
      supabase.from('transactions').select('amount, created_by').gte('created_at', fromISO).lte('created_at', toISO),
      supabase.from('items').select('id, item_name, current_stock, unit, category_id').lte('current_stock', 10).order('current_stock', { ascending: true }).limit(30),
      supabase.from('inventory_imports').select('created_at').gte('created_at', fromISO).lte('created_at', toISO),
      supabase.from('transactions').select('created_at, item_id, amount, created_by, creator:system_users!created_by(fullname)').gte('created_at', fromISO).lte('created_at', toISO),
      supabase.from('category').select('id, category_name').order('category_name'),
      supabase.from('items').select('category_id'),
      supabase.from('transactions').select('id, amount, unit, created_at, items(item_code, item_name), creator:system_users!created_by(fullname, emp_code)').order('created_at', { ascending: false }).limit(8),
      supabase.from('order_req').select('id, request_id, status, mr_number, company, created_at, amount, unit, items(item_code, item_name, usage_type, category(category_name)), creator:system_users!created_by(fullname)').order('created_at', { ascending: false }).limit(6),
      supabase.from('items').select('item_code, item_name, usage_type, current_stock, unit, category(category_name)').order('current_stock', { ascending: true }).limit(12),
    ]

    if (prevFrom) {
      queries.push(
        supabase.from('inventory_imports').select('*', { count: 'exact', head: true }).gte('created_at', prevFrom.toISOString()).lte('created_at', prevTo.toISOString()),
        supabase.from('transactions').select('*', { count: 'exact', head: true }).gte('created_at', prevFrom.toISOString()).lte('created_at', prevTo.toISOString()),
        supabase.from('order_req').select('*', { count: 'exact', head: true }).eq('status', 'pending').gte('created_at', prevFrom.toISOString()).lte('created_at', prevTo.toISOString()),
      )
    }

    const results = await Promise.all(queries)
    const [
      itemsRes, catCountRes, impCountRes, txCountRes,
      pendingRes, approvedRes, rejectedRes, completedRes,
      impAmtRes, txAmtRes, lowStockRes,
      impRowsRes, txRowsRes,
      catNamesRes, itemCatRes,
      recentTxRes, recentOrdersRes,
      catProductsRes,
      ...prevResults
    ] = results

    const [prevImpRes, prevTxRes, prevPendingRes] = prevFrom ? prevResults : [null, null, null]

    totalItems.value       = itemsRes.count ?? 0
    totalCategories.value  = catCountRes.count ?? 0
    importsInPeriod.value  = impCountRes.count ?? 0
    txInPeriod.value       = txCountRes.count ?? 0
    pendingOrders.value    = pendingRes.count ?? 0
    approvedOrders.value   = approvedRes.count ?? 0
    rejectedOrders.value   = rejectedRes.count ?? 0
    completedOrders.value  = completedRes.count ?? 0
    totalImportQty.value   = (impAmtRes.data || []).reduce((s,r) => s + (r.amount||0), 0)
    const txRows           = txAmtRes.data || []
    totalTxQty.value       = txRows.reduce((s,r) => s + (r.amount||0), 0)
    uniqueRequesterCount.value = new Set(txRows.map(r => r.created_by).filter(Boolean)).size

    const allLow = lowStockRes.data || []
    outOfStockCount.value = allLow.filter(i => i.current_stock === 0).length
    lowStockCount.value   = allLow.filter(i => i.current_stock > 0 && i.current_stock <= 10).length
    lowStockItems.value   = allLow.slice(0, 20)

    const prevLabel = label
    if (prevImpRes) trendImports.value = trendDelta(impCountRes.count??0, prevImpRes.count??0, prevLabel)
    if (prevTxRes)  trendTx.value      = trendDelta(txCountRes.count??0, prevTxRes.count??0, prevLabel)
    if (prevPendingRes) trendPending.value = trendDelta(pendingRes.count??0, prevPendingRes.count??0, prevLabel)
    const approvalRate = (approvedRes.count??0) + (rejectedRes.count??0) > 0
      ? Math.round(((approvedRes.count??0) / ((approvedRes.count??0) + (rejectedRes.count??0))) * 100)
      : 0
    trendApproval.value = { text: `เบิกแล้ว ${approvalRate}%`, type: approvalRate >= 70 ? 'up' : approvalRate >= 40 ? 'neutral' : 'down' }

    const impByDay = {}, txByDay = {}
    for (const k of dayKeys) { impByDay[k] = 0; txByDay[k] = 0 }
    for (const r of impRowsRes.data||[]) { const k=dayKey(r.created_at); if(impByDay[k]!==undefined) impByDay[k]++ }
    for (const r of txRowsRes.data||[])  { const k=dayKey(r.created_at); if(txByDay[k]!==undefined)  txByDay[k]++  }
    lineLabels.value        = dayKeys.map(k => { const[y,m,d]=k.split('-').map(Number); return fmtDate(new Date(y,m-1,d)) })
    lineImportsSeries.value = dayKeys.map(k => impByDay[k])
    lineTxSeries.value      = dayKeys.map(k => txByDay[k])

    const userMap = {}
    for (const r of txRowsRes.data||[]) {
      const uid = r.created_by
      if (!uid) continue
      if (!userMap[uid]) userMap[uid] = { name: r.creator?.fullname || '—', count: 0, uid }
      userMap[uid].count++
    }
    topRequesters.value = Object.values(userMap).sort((a,b) => b.count - a.count).slice(0, 5)

    const itemQty = {}
    for (const r of txRowsRes.data||[]) {
      const id = r.item_id
      if (!id) continue
      itemQty[id] = (itemQty[id] || 0) + (r.amount||0)
    }
    const topIds = Object.entries(itemQty).sort((a,b)=>b[1]-a[1]).slice(0,8).map(x=>x[0])
    let itemDetails = {}
    if (topIds.length > 0) {
      const { data: detailsRes } = await supabase.from('items').select('id, item_code, item_name, usage_type, current_stock, unit, category(category_name)').in('id', topIds)
      for (const i of detailsRes||[]) itemDetails[i.id] = i
    }
    const topEntries = topIds.map(id => {
      const d = itemDetails[id] || {}
      return {
        id,
        item_code: d.item_code || '—',
        name: d.item_name || id.slice(0,8),
        usage_type: d.usage_type || '—',
        category_name: d.category?.category_name || '—',
        current_stock: d.current_stock ?? 0,
        unit: d.unit || '—',
        qty: itemQty[id]
      }
    })
    topWithdrawItems.value = topEntries
    barLabels.value = topEntries.map(x => x.name.length > 14 ? x.name.slice(0,14)+'…' : x.name)
    barSeries.value = topEntries.map(x => x.qty)

    recentTransactions.value = (recentTxRes.data||[]).map(t => ({
      id: t.id,
      item_code: t.items?.item_code || '—',
      item_name: t.items?.item_name || '—',
      amount: t.amount,
      unit: t.unit,
      created_by_name: t.creator?.fullname || '—',
      emp_code: t.creator?.emp_code || '',
      created_at: t.created_at,
    }))

    recentOrders.value = (recentOrdersRes.data||[]).map(o => ({
      id: o.id,
      request_id: o.request_id,
      item_name: o.items?.item_name || '—',
      mr_number: o.mr_number || '—',
      company: o.company || '—',
      status: o.status,
      creator: o.creator?.fullname || '—',
      created_at: o.created_at,
    }))

    categoryProducts.value = (catProductsRes.data||[]).map(p => {
      let status = 'ปกติ'
      let color = 'var(--color-text-secondary)'
      if (p.current_stock === 0) {
        status = 'หมด'
        color = '#EF4444'
      } else if (p.current_stock <= 10) {
        status = 'ใกล้หมด'
        color = '#F59E0B'
      }
      return {
        item_code: p.item_code,
        item_name: p.item_name,
        usage_type: p.usage_type || '—',
        category_name: p.category?.category_name || '—',
        current_stock: p.current_stock,
        unit: p.unit,
        status,
        statusColor: color
      }
    })

    orderStatusItems.value = (recentOrdersRes.data||[]).map(o => ({
      id: o.id,
      item_code: o.items?.item_code || '—',
      item_name: o.items?.item_name || '—',
      category_name: o.items?.category?.category_name || '—',
      amount: o.amount || 0,
      unit: o.unit || '—'
    }))

  } catch(e) {
    console.error('Dashboard fetch error', e)
  } finally {
    loading.value = false
    await nextTick()
    buildCharts()
  }
}

// ─── Charts ───────────────────────────────────────────────────────────────────
function destroyCharts() {
  lineChart?.destroy(); barChart?.destroy()
  lineChart = barChart = null
}

function buildCharts() {
  const colors = getChartColors()
  destroyCharts()

  if (lineChartRef.value) {
    lineChart = new Chart(lineChartRef.value, {
      type: 'line',
      data: {
        labels: lineLabels.value.length ? lineLabels.value : ['—'],
        datasets: [
          { label: 'นำเข้า', data: lineImportsSeries.value.length ? lineImportsSeries.value : [0], borderColor: '#64748B', backgroundColor: 'rgba(100,116,139,0.07)', fill: true, tension: 0.4, pointRadius: 3, pointHoverRadius: 6 },
          { label: 'เบิกจ่าย', data: lineTxSeries.value.length ? lineTxSeries.value : [0], borderColor: '#94A3B8', backgroundColor: 'rgba(148,163,184,0.07)', fill: true, tension: 0.4, pointRadius: 3, pointHoverRadius: 6 },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { position: 'top', labels: { usePointStyle: true, padding: 16, font: { size: 11, weight: '700' }, color: colors.primaryText } }, tooltip: { padding: 10, cornerRadius: 8 } },
        scales: { 
          y: { beginAtZero: true, grid: { color: colors.gridColor }, ticks: { precision: 0, color: colors.secondaryText, font: { weight: '500' } } }, 
          x: { grid: { display: false }, ticks: { color: colors.secondaryText, font: { weight: '500' } } } 
        },
      },
    })
  }

  if (barChartRef.value && barSeries.value.length) {
    barChart = new Chart(barChartRef.value, {
      type: 'bar',
      data: {
        labels: barLabels.value,
        datasets: [{ label: 'จำนวนเบิก', data: barSeries.value, backgroundColor: PALETTE.slice(0, barSeries.value.length), borderRadius: 6, borderSkipped: false }],
      },
      options: {
        responsive: true, maintainAspectRatio: false, indexAxis: 'y',
        plugins: { legend: { display: false }, tooltip: { padding: 10, cornerRadius: 8 } },
        scales: { 
          x: { beginAtZero: true, grid: { color: colors.gridColor }, ticks: { precision: 0, color: colors.secondaryText, font: { weight: '500' } } }, 
          y: { grid: { display: false }, ticks: { font: { size: 11, weight: '500' }, color: colors.secondaryText } } 
        },
      },
    })
  }
}

// ─── Filter handlers ──────────────────────────────────────────────────────────
function setFilter(f) {
  if (f === 'custom') { showCustomPicker.value = true; return }
  showCustomPicker.value = false
  activeFilter.value = f
  fetchDashboardData()
}
function applyCustom() {
  if (!customFrom.value || !customTo.value) return
  activeFilter.value = 'custom'
  showCustomPicker.value = false
  fetchDashboardData()
}

// ─── Computed ─────────────────────────────────────────────────────────────────
const approvalRate = computed(() => {
  const total = (approvedOrders.value + rejectedOrders.value)
  return total > 0 ? Math.round((approvedOrders.value / total) * 100) : 0
})
const stockUtilRate = computed(() => {
  if (totalItems.value === 0) return 0
  return Math.round(((totalItems.value - outOfStockCount.value - lowStockCount.value) / totalItems.value) * 100)
})

const filteredSummaryProducts = computed(() => {
  if (!summarySearchText.value) return categoryProducts.value
  const s = summarySearchText.value.toLowerCase()
  return categoryProducts.value.filter(p => 
    p.item_code.toLowerCase().includes(s) || 
    p.item_name.toLowerCase().includes(s) || 
    p.category_name.toLowerCase().includes(s) ||
    p.usage_type.toLowerCase().includes(s)
  )
})

const filteredTopWithdrawItems = computed(() => {
  if (!topWithdrawSearchText.value) return topWithdrawItems.value
  const s = topWithdrawSearchText.value.toLowerCase()
  return topWithdrawItems.value.filter(p => 
    p.item_code.toLowerCase().includes(s) || 
    p.name.toLowerCase().includes(s) || 
    p.category_name.toLowerCase().includes(s) ||
    p.usage_type.toLowerCase().includes(s)
  )
})

const filteredTopRequesters = computed(() => {
  if (!requesterSearchText.value) return topRequesters.value
  const s = requesterSearchText.value.toLowerCase()
  return topRequesters.value.filter(u => u.name.toLowerCase().includes(s))
})

function statusColor(s) {
  const m = { pending: '#94A3B8', approved: '#64748B', rejected: '#CBD5E1', completed: '#475569' }
  return m[s] || '#64748B'
}
function statusLabel(s) {
  const m = { pending: 'รอเบิก', approved: 'เบิกแล้ว', rejected: 'ปฏิเสธ', completed: 'เบิกแล้ว' }
  return m[s] || s
}

// ─── Modal Computed ───────────────────────────────────────────────────────────
const filteredModalData = computed(() => {
  if (!modalSearchText.value) return modalData.value
  const search = modalSearchText.value.toLowerCase()
  return modalData.value.filter(item => {
    const itemCode = (item.item_code || item.items?.item_code || '').toLowerCase()
    const itemName = (item.item_name || item.items?.item_name || '').toLowerCase()
    const creator = (item.creator?.fullname || '').toLowerCase()
    const remark = (item.remark || '').toLowerCase()
    const company = (item.company || '').toLowerCase()
    const requestId = String(item.request_id || '').toLowerCase()
    return itemCode.includes(search) || itemName.includes(search) || creator.includes(search) || remark.includes(search) || company.includes(search) || requestId.includes(search)
  })
})

// ─── Modal Logic ──────────────────────────────────────────────────────────────
async function openDetailModal(type, filterId = null, filterName = '') {
  modalType.value = type
  isDetailModalOpen.value = true
  modalLoading.value = true
  modalData.value = []
  modalSearchText.value = ''
  selectedCategoryName.value = filterName

  const { from, to } = getDateRange()
  const fromISO = from.toISOString()
  const toISO = to.toISOString()

  try {
    let query
    switch (type) {
      case 'items':
        modalTitle.value = 'รายการสินค้าทั้งหมด'
        query = supabase.from('items').select('*, category(category_name), creator:system_users!created_by(fullname)').order('item_name')
        break
      case 'items_by_category':
        modalTitle.value = `รายการสินค้าในหมวด: ${filterName}`
        query = supabase.from('items').select('*, category(category_name), creator:system_users!created_by(fullname)').eq('category_id', filterId).order('item_name')
        break
      case 'imports':
        modalTitle.value = `รายการนำเข้า (${getDateRange().label})`
        query = supabase.from('inventory_imports').select('*, items(item_code, item_name), creator:system_users!created_by(fullname)').gte('created_at', fromISO).lte('created_at', toISO).order('created_at', { ascending: false })
        break
      case 'tx':
        modalTitle.value = `รายการเบิกจ่าย (${getDateRange().label})`
        query = supabase.from('transactions').select('*, items(item_code, item_name), creator:system_users!created_by(fullname)').gte('created_at', fromISO).lte('created_at', toISO).order('created_at', { ascending: false })
        break
      case 'pending':
        modalTitle.value = 'รายการคำขอรอเบิกสินค้า'
        query = supabase.from('order_req').select('*, items(item_name), creator:system_users!created_by(fullname)').eq('status', 'pending').order('created_at', { ascending: false })
        break
      case 'low_stock':
        modalTitle.value = 'สินค้าสต็อกต่ำ/หมด'
        query = supabase.from('items').select('*, category(category_name)').lte('current_stock', 10).order('current_stock', { ascending: true })
        break
      case 'approved':
        modalTitle.value = `คำขอที่อนุมัติ (${getDateRange().label})`
        query = supabase.from('order_req').select('*, items(item_name), creator:system_users!created_by(fullname)').eq('status', 'approved').gte('created_at', fromISO).lte('created_at', toISO).order('created_at', { ascending: false })
        break
      case 'rejected':
        modalTitle.value = `คำขอที่ปฏิเสธ (${getDateRange().label})`
        query = supabase.from('order_req').select('*, items(item_name), creator:system_users!created_by(fullname)').eq('status', 'rejected').gte('created_at', fromISO).lte('created_at', toISO).order('created_at', { ascending: false })
        break
      case 'completed':
        modalTitle.value = `คำขอที่เสร็จสิ้น (${getDateRange().label})`
        query = supabase.from('order_req').select('*, items(item_name), creator:system_users!created_by(fullname)').eq('status', 'completed').gte('created_at', fromISO).lte('created_at', toISO).order('created_at', { ascending: false })
        break
      case 'all_orders':
        modalTitle.value = `รายการคำขอทั้งหมด (${getDateRange().label})`
        query = supabase.from('order_req').select('*, items(item_code, item_name), creator:system_users!created_by(fullname)').gte('created_at', fromISO).lte('created_at', toISO).order('created_at', { ascending: false })
        break
      case 'picked_orders':
        modalTitle.value = `รายการที่เบิกแล้ว (${getDateRange().label})`
        query = supabase.from('order_req').select('*, items(item_code, item_name), creator:system_users!created_by(fullname)').in('status', ['approved', 'completed']).gte('created_at', fromISO).lte('created_at', toISO).order('created_at', { ascending: false })
        break
      case 'category_summary':
        modalTitle.value = 'สรุปรายการสินค้าตามหมวดหมู่'
        query = supabase.from('category').select('*, items(current_stock)')
        break
      case 'requester_tx':
        modalTitle.value = `รายการเบิกของ: ${filterName} (${getDateRange().label})`
        query = supabase.from('transactions').select('*, items(item_code, item_name), creator:system_users!created_by(fullname)').eq('created_by', filterId).gte('created_at', fromISO).lte('created_at', toISO).order('created_at', { ascending: false })
        break
    }

    const { data, error } = await query
    if (error) throw error

    if (type === 'category_summary') {
      modalData.value = data.map(cat => ({
        id: cat.id,
        category_name: cat.category_name,
        sku_count: cat.items?.length || 0,
        total_stock: (cat.items || []).reduce((sum, item) => sum + (item.current_stock || 0), 0),
        remark: cat.remark
      })).sort((a, b) => b.sku_count - a.sku_count)
    } else {
      modalData.value = data
    }
  } catch (err) {
    console.error('Error fetching modal data:', err.message)
  } finally {
    modalLoading.value = false
  }
}

onMounted(() => {
  initThemeObserver()
  fetchDashboardData()
})
onUnmounted(() => {
  if (themeObserver) themeObserver.disconnect()
  destroyCharts()
})
</script>

<template>
  <AppLayout>
    <!-- ── Header & Filter Bar ───────────────────────────────────────────── -->
    <div class="flex flex-wrap items-end justify-between gap-4 mb-6">
      <div>
        <h1 class="text-2xl font-extrabold tracking-tight" style="color: var(--color-text-primary)">
          <i class="fa-solid fa-chart-line mr-2" style="color: var(--color-primary)"></i>แดชบอร์ดภาพรวม
        </h1>
        <p class="text-[14px] font-bold mt-0.5" style="color: var(--color-text-primary)">ระบบจัดการคลังพัสดุ — ข้อมูลเชิงธุรกิจสำหรับผู้บริหาร</p>
      </div>

      <!-- Filter Tabs -->
      <div class="flex flex-wrap items-center gap-2">
        <div class="flex rounded-lg overflow-hidden border text-[13px] font-semibold" style="border-color: var(--color-border)">
          <button v-for="f in [
            { key:'this_week',  label:'สัปดาห์นี้' },
            { key:'last_week',  label:'สัปดาห์ก่อน' },
            { key:'this_month', label:'เดือนนี้' },
            { key:'last_month', label:'เดือนก่อน' },
          ]" :key="f.key"
            @click="setFilter(f.key)"
            class="px-3 py-1.5 transition-colors"
            :style="activeFilter === f.key
              ? 'background: var(--color-bg-blue); color: var(--color-text-primary)'
              : 'background: var(--color-bg-card); color: var(--color-text-secondary)'"
          >{{ f.label }}</button>
          <button @click="setFilter('custom')"
            class="px-3 py-1.5 transition-colors"
            :style="activeFilter === 'custom'
              ? 'background: var(--color-primary); color: var(--color-text-primary)'
              : 'background: var(--color-bg-card); color: var(--color-text-secondary)'"
          ><i class="fa-regular fa-calendar mr-1"></i>กำหนดเอง</button>
        </div>
        <button @click="fetchDashboardData" class="p-1.5 rounded-lg border text-[13px] transition-colors hover:opacity-70" style="border-color: var(--color-border); background: var(--color-bg-card); color: var(--color-text-secondary)">
          <i class="fa-solid fa-rotate-right"></i>
        </button>
      </div>
    </div>

    <!-- Custom Date Picker -->
    <div v-if="showCustomPicker" class="mb-5 flex flex-wrap items-end gap-3 p-4 rounded-xl border" style="background: var(--color-bg-card); border-color: var(--color-border)">
      <div>
        <label class="text-[13px] font-bold block mb-1" style="color: var(--color-text-primary)">วันที่เริ่มต้น</label>
        <input type="date" v-model="customFrom" class="rounded-lg border px-3 py-1.5 text-[13px]" style="border-color: var(--color-border); background: var(--color-bg); color: var(--color-text-primary)" />
      </div>
      <div>
        <label class="text-[13px] font-bold block mb-1" style="color: var(--color-text-primary)">วันที่สิ้นสุด</label>
        <input type="date" v-model="customTo" class="rounded-lg border px-3 py-1.5 text-[13px]" style="border-color: var(--color-border); background: var(--color-bg); color: var(--color-text-primary)" />
      </div>
      <button @click="applyCustom" class="px-4 py-1.5 rounded-lg text-[13px] font-bold text-white" style="background: var(--color-primary)">ดูข้อมูล</button>
      <button @click="showCustomPicker=false" class="px-3 py-1.5 rounded-lg text-[13px] font-semibold" style="color: var(--color-text-secondary)">ยกเลิก</button>
    </div>

    <!-- Loading overlay -->
    <div v-if="loading" class="flex items-center justify-center py-20">
      <div class="text-center">
        <i class="fa-solid fa-spinner fa-spin text-2xl mb-3" style="color: var(--color-primary)"></i>
        <p class="text-[14px] font-semibold" style="color: var(--color-text-secondary)">กำลังโหลดข้อมูล...</p>
      </div>
    </div>

    <template v-else>
      <!-- ── Row 1: KPI Cards ─────────────────────────────────────────────── -->
      <div class="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-3 mb-5">

        <div @click="openDetailModal('items')" class="col-span-1 rounded-xl border p-3 flex flex-col gap-1.5 cursor-pointer hover:shadow-md transition-all active:scale-95" style="background: var(--color-bg-card); border-color: var(--color-border)">
          <div class="flex items-center justify-between">
            <span class="text-[13px] font-bold" style="color: var(--color-text-primary)">สินค้าทั้งหมด</span>
            <div class="w-7 h-7 rounded-lg flex items-center justify-center" style="background: rgba(148,163,184,0.1)">
              <i class="fa-solid fa-boxes-stacked text-[12px]" style="color: var(--color-text-secondary)"></i>
            </div>
          </div>
          <p class="text-[30px] font-extrabold leading-none" style="color: var(--color-text-primary)">{{ totalItems.toLocaleString() }}</p>
          <p class="text-[12px] font-semibold" style="color: var(--color-text-secondary)">{{ totalCategories }} หมวดหมู่</p>
        </div>

        <div @click="openDetailModal('imports')" class="col-span-1 rounded-xl border p-3 flex flex-col gap-1.5 cursor-pointer hover:shadow-md transition-all active:scale-95" style="background: var(--color-bg-card); border-color: var(--color-border)">
          <div class="flex items-center justify-between">
            <span class="text-[13px] font-bold" style="color: var(--color-text-primary)">นำเข้าช่วงนี้</span>
            <div class="w-7 h-7 rounded-lg flex items-center justify-center" style="background: rgba(148,163,184,0.1)">
              <i class="fa-solid fa-arrow-down-to-bracket text-[12px]" style="color: var(--color-text-secondary)"></i>
            </div>
          </div>
          <p class="text-[30px] font-extrabold leading-none" style="color: var(--color-text-primary)">{{ importsInPeriod.toLocaleString() }}</p>
          <p class="text-[12px] font-semibold truncate" :style="trendImports.type==='down' ? 'color:#EF4444' : 'color: var(--color-text-secondary)'">{{ trendImports.text }}</p>
        </div>

        <div @click="openDetailModal('tx')" class="col-span-1 rounded-xl border p-3 flex flex-col gap-1.5 cursor-pointer hover:shadow-md transition-all active:scale-95" style="background: var(--color-bg-card); border-color: var(--color-border)">
          <div class="flex items-center justify-between">
            <span class="text-[13px] font-bold" style="color: var(--color-text-primary)">เบิกจ่ายช่วงนี้</span>
            <div class="w-7 h-7 rounded-lg flex items-center justify-center" style="background: rgba(148,163,184,0.1)">
              <i class="fa-solid fa-arrow-up-from-bracket text-[12px]" style="color: var(--color-text-secondary)"></i>
            </div>
          </div>
          <p class="text-[30px] font-extrabold leading-none" style="color: var(--color-text-primary)">{{ txInPeriod.toLocaleString() }}</p>
          <p class="text-[12px] font-semibold truncate" :style="trendTx.type==='down' ? 'color:#EF4444' : 'color: var(--color-text-secondary)'">{{ trendTx.text }}</p>
        </div>

        <div @click="openDetailModal('pending')" class="col-span-1 rounded-xl border p-3 flex flex-col gap-1.5 cursor-pointer hover:shadow-md transition-all active:scale-95" style="background: var(--color-bg-card); border-color: var(--color-border)">
          <div class="flex items-center justify-between">
            <span class="text-[13px] font-bold" style="color: var(--color-text-primary)">รอเบิกสินค้า</span>
            <div class="w-7 h-7 rounded-lg flex items-center justify-center" style="background: rgba(148,163,184,0.1)">
              <i class="fa-solid fa-clock text-[12px]" style="color: var(--color-text-secondary)"></i>
            </div>
          </div>
          <p class="text-[30px] font-extrabold leading-none" style="color: var(--color-text-primary)">{{ pendingOrders.toLocaleString() }}</p>
          <p class="text-[12px] font-semibold" style="color: var(--color-text-secondary)">คำขอรอเบิกสินค้า</p>
        </div>

        <div @click="openDetailModal('imports')" class="col-span-1 rounded-xl border p-3 flex flex-col gap-1.5 cursor-pointer hover:shadow-md transition-all active:scale-95" style="background: var(--color-bg-card); border-color: var(--color-border)">
          <div class="flex items-center justify-between">
            <span class="text-[13px] font-bold" style="color: var(--color-text-primary)">ปริมาณนำเข้า</span>
            <div class="w-7 h-7 rounded-lg flex items-center justify-center" style="background: rgba(148,163,184,0.1)">
              <i class="fa-solid fa-layer-group text-[12px]" style="color: var(--color-text-secondary)"></i>
            </div>
          </div>
          <p class="text-[30px] font-extrabold leading-none" style="color: var(--color-text-primary)">{{ totalImportQty.toLocaleString() }}</p>
          <p class="text-[12px] font-semibold" style="color: var(--color-text-secondary)">หน่วยรวม</p>
        </div>

        <div @click="openDetailModal('tx')" class="col-span-1 rounded-xl border p-3 flex flex-col gap-1.5 cursor-pointer hover:shadow-md transition-all active:scale-95" style="background: var(--color-bg-card); border-color: var(--color-border)">
          <div class="flex items-center justify-between">
            <span class="text-[13px] font-bold" style="color: var(--color-text-primary)">ปริมาณเบิก</span>
            <div class="w-7 h-7 rounded-lg flex items-center justify-center" style="background: rgba(148,163,184,0.1)">
              <i class="fa-solid fa-dolly text-[12px]" style="color: var(--color-text-secondary)"></i>
            </div>
          </div>
          <p class="text-[30px] font-extrabold leading-none" style="color: var(--color-text-primary)">{{ totalTxQty.toLocaleString() }}</p>
          <p class="text-[12px] font-semibold" style="color: var(--color-text-secondary)">{{ uniqueRequesterCount }} ผู้เบิก</p>
        </div>

        <div @click="openDetailModal('low_stock')" class="col-span-1 rounded-xl border p-3 flex flex-col gap-1.5 cursor-pointer hover:shadow-md transition-all active:scale-95" style="background: var(--color-bg-card); border-color: var(--color-border)">
          <div class="flex items-center justify-between">
            <span class="text-[13px] font-bold" style="color: var(--color-text-primary)">สต็อกต่ำ</span>
            <div class="w-7 h-7 rounded-lg flex items-center justify-center" style="background: rgba(148,163,184,0.1)">
              <i class="fa-solid fa-triangle-exclamation text-[12px]" style="color: var(--color-text-secondary)"></i>
            </div>
          </div>
          <p class="text-[30px] font-extrabold leading-none" style="color: var(--color-text-primary)">{{ lowStockCount }}</p>
          <p class="text-[12px] font-semibold" style="color: var(--color-text-secondary)">หมด {{ outOfStockCount }} รายการ</p>
        </div>

        <div @click="openDetailModal('all_orders')" class="col-span-1 rounded-xl border p-3 flex flex-col gap-1.5 cursor-pointer hover:shadow-md transition-all active:scale-95" style="background: var(--color-bg-card); border-color: var(--color-border)">
          <div class="flex items-center justify-between">
            <span class="text-[13px] font-bold" style="color: var(--color-text-primary)">อัตราอนุมัติ</span>
            <div class="w-7 h-7 rounded-lg flex items-center justify-center" style="background: rgba(148,163,184,0.1)">
              <i class="fa-solid fa-check-circle text-[12px]" style="color: var(--color-text-secondary)"></i>
            </div>
          </div>
          <p class="text-[30px] font-extrabold leading-none" style="color: var(--color-text-primary)">{{ approvalRate }}%</p>
          <p class="text-[12px] font-semibold" style="color: var(--color-text-secondary)">{{ approvedOrders }} / {{ approvedOrders+rejectedOrders }} รายการ</p>
        </div>
      </div>

      <!-- ── Row 2: Secondary KPI ─────────────────────────────────────────── -->
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">

        <div class="rounded-xl border p-3" style="background: var(--color-bg-card); border-color: var(--color-border)">
          <p class="text-[14px] font-bold mb-2" style="color: var(--color-text-primary)">สถานะ Order</p>
          <div class="overflow-hidden rounded-lg border" style="border-color: var(--color-border)">
            <table class="w-full text-[12px]">
              <thead class="bg-gray-50/50 dark:bg-slate-800/50">
                <tr class="border-b" style="border-color: var(--color-border)">
                  <th class="px-2 py-1 text-left font-bold" style="color: var(--color-text-primary)">รายการ</th>
                  <th class="px-2 py-1 text-right font-bold" style="color: var(--color-text-primary)">จำนวน</th>
                </tr>
              </thead>
              <tbody class="divide-y" style="border-color: var(--color-border)">
                <tr @click="openDetailModal('pending')" class="cursor-pointer hover:bg-slate-50/50 dark:hover:bg-slate-800/20 transition-colors">
                  <td class="px-2 py-1.5 font-bold" style="color: var(--color-text-secondary)">รอเบิก</td>
                  <td class="px-2 py-1.5 text-right font-bold" style="color: var(--color-text-primary)">{{ pendingOrders }}</td>
                </tr>
                <tr @click="openDetailModal('picked_orders')" class="cursor-pointer hover:bg-slate-50/50 dark:hover:bg-slate-800/20 transition-colors">
                  <td class="px-2 py-1.5 font-bold" style="color: var(--color-text-secondary)">เบิกแล้ว</td>
                  <td class="px-2 py-1.5 text-right font-bold" style="color: var(--color-text-primary)">{{ approvedOrders + completedOrders }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div class="rounded-xl border p-3" style="background: var(--color-bg-card); border-color: var(--color-border)">
          <p class="text-[14px] font-bold mb-2" style="color: var(--color-text-primary)">สุขภาพสต็อก</p>
          <div class="flex items-center gap-2 mb-2">
            <div class="flex-1 h-2 rounded-full overflow-hidden" style="background: var(--color-bg-base); border: 1px solid var(--color-border)">
              <div class="h-full rounded-full transition-all" :style="`width: ${stockUtilRate}%; background: var(--color-primary)`"></div>
            </div>
            <span class="text-[14px] font-extrabold" style="color: var(--color-text-primary)">{{ stockUtilRate }}%</span>
          </div>
          <div class="flex justify-between text-[12px] font-bold" style="color: var(--color-text-primary)">
            <span>ปกติ {{ totalItems - lowStockCount - outOfStockCount }}</span>
            <span style="color: var(--color-text-secondary)">ต่ำ {{ lowStockCount }}</span>
            <span style="color: var(--color-text-secondary)">หมด {{ outOfStockCount }}</span>
          </div>
        </div>

        <div class="rounded-xl border p-3" style="background: var(--color-bg-card); border-color: var(--color-border)">
          <p class="text-[14px] font-bold mb-2" style="color: var(--color-text-primary)">สัดส่วนนำเข้า/เบิก</p>
          <div class="flex items-end gap-2">
            <div class="flex-1">
              <p class="text-[12px] font-bold mb-1" style="color: var(--color-text-secondary)">นำเข้า</p>
              <div class="h-6 rounded overflow-hidden" style="background: var(--color-bg-base); border: 1px solid var(--color-border)">
                <div class="h-full flex items-center px-2 transition-all" :style="`width: ${totalImportQty+totalTxQty>0 ? Math.round(totalImportQty/(totalImportQty+totalTxQty)*100) : 50}%; background: #2563EB; min-width:24px`">
                  <span class="text-[11px] text-white font-bold">{{ totalImportQty }}</span>
                </div>
              </div>
            </div>
          </div>
          <div class="flex items-end gap-2 mt-1">
            <div class="flex-1">
              <p class="text-[12px] font-bold mb-1" style="color: var(--color-text-secondary)">เบิก</p>
              <div class="h-6 rounded overflow-hidden" style="background: var(--color-bg-base); border: 1px solid var(--color-border)">
                <div class="h-full flex items-center px-2 transition-all" :style="`width: ${totalImportQty+totalTxQty>0 ? Math.round(totalTxQty/(totalImportQty+totalTxQty)*100) : 50}%; background: #64748B; min-width:24px`">
                  <span class="text-[11px] text-white font-bold">{{ totalTxQty }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="rounded-xl border p-3" style="background: var(--color-bg-card); border-color: var(--color-border)">
          <div class="flex items-center justify-between mb-2">
            <p class="text-[14px] font-bold" style="color: var(--color-text-primary)">กิจกรรมการเบิก</p>
            <div class="relative">
              <i class="fa-solid fa-magnifying-glass absolute left-2 top-1/2 -translate-y-1/2 text-[10px]" style="color: var(--color-text-muted)"></i>
              <input v-model="requesterSearchText" type="text" placeholder="ค้นหาคนเบิก..." 
                class="pl-6 pr-2 py-1 border rounded-lg text-[11px] focus:outline-none focus:ring-1 transition-all w-28"
                style="border-color: var(--color-border); background: var(--color-bg-base); color: var(--color-text-primary)" />
            </div>
          </div>
          <div class="overflow-hidden rounded-lg border" style="border-color: var(--color-border)">
            <table class="w-full text-[12px]">
              <thead class="bg-gray-50/50 dark:bg-slate-800/50">
                <tr class="border-b" style="border-color: var(--color-border)">
                  <th class="px-2 py-1 text-left font-bold" style="color: var(--color-text-primary)">ผู้ขอเบิก</th>
                  <th class="px-2 py-1 text-right font-bold" style="color: var(--color-text-primary)">รายการ</th>
                </tr>
              </thead>
              <tbody class="divide-y" style="border-color: var(--color-border)">
                <tr v-if="filteredTopRequesters.length === 0">
                  <td colspan="2" class="px-2 py-6 text-center text-[11px]" style="color: var(--color-text-secondary)">ไม่พบข้อมูล</td>
                </tr>
                <tr v-for="u in filteredTopRequesters" :key="u.uid" @click="openDetailModal('requester_tx', u.uid, u.name)" class="cursor-pointer hover:bg-slate-50/50 dark:hover:bg-slate-800/20 transition-colors">
                  <td class="px-2 py-1.5 font-bold truncate max-w-[100px]" style="color: var(--color-text-secondary)" :title="u.name">{{ u.name }}</td>
                  <td class="px-2 py-1.5 text-right font-bold" style="color: var(--color-text-primary)">{{ u.count }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- ── Row 3: Charts ──────────────────────────────────────────────── -->
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-4 mb-5">
        <div class="lg:col-span-7 rounded-xl border p-4" style="background: var(--color-bg-card); border-color: var(--color-border)">
          <div class="flex items-center justify-between mb-4">
            <div>
              <p class="text-[15px] font-bold" style="color: var(--color-text-primary)">แนวโน้มการนำเข้า & เบิกจ่าย</p>
              <p class="text-[13px] font-bold" style="color: var(--color-text-primary)">จำนวนรายการแต่ละวัน</p>
            </div>
            <div class="flex gap-3 text-[12px] font-extrabold" style="color: var(--color-text-primary)">
              <span class="flex items-center gap-1"><span class="inline-block w-3 h-1 rounded" style="background:#64748B"></span>นำเข้า</span>
              <span class="flex items-center gap-1"><span class="inline-block w-3 h-1 rounded" style="background:#94A3B8"></span>เบิก</span>
            </div>
          </div>
          <div class="h-52"><canvas ref="lineChartRef"></canvas></div>
        </div>

        <div class="lg:col-span-5">
          <!-- ตารางสรุปสินค้าทั้งหมด (Single Table) -->
          <div class="rounded-xl border p-4 cursor-pointer hover:shadow-md transition-all active:scale-[0.99]" style="background: var(--color-bg-card); border-color: var(--color-border)">
            <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
              <div>
                <p class="text-[15px] font-bold" style="color: var(--color-text-primary)">สรุปสถานะสินค้า</p>
                <p class="text-[12px] font-semibold" style="color: var(--color-text-secondary)">รายการที่ต้องเฝ้าระวังและสินค้าล่าสุด</p>
              </div>
              <div class="flex items-center gap-2">
                <div class="relative">
                  <i class="fa-solid fa-magnifying-glass absolute left-2.5 top-1/2 -translate-y-1/2 text-[11px]" style="color: var(--color-text-muted)"></i>
                  <input v-model="summarySearchText" type="text" placeholder="ค้นหาพัสดุ..." 
                    @click.stop
                    class="pl-8 pr-3 py-1.5 border rounded-lg text-[12px] focus:outline-none focus:ring-1 transition-all w-32 sm:w-40"
                    style="border-color: var(--color-border); background: var(--color-bg-base); color: var(--color-text-primary)" />
                </div>
                <span class="text-[11px] font-bold px-2 py-1 rounded-full whitespace-nowrap" style="background: rgba(148,163,184,0.12); color: var(--color-text-secondary)">
                  {{ filteredSummaryProducts.length }} รายการ
                </span>
              </div>
            </div>
            
            <div class="overflow-auto max-h-[245px] scrollbar-thin">
              <table class="w-full text-[13px] table-fixed min-w-[750px]">
                <thead class="sticky top-0 z-10" style="background: var(--color-bg-card)">
                  <tr class="border-b" style="border-color: var(--color-border)">
                    <th class="text-left py-2 font-bold w-28" style="color: var(--color-text-primary)">รหัสสินค้า</th>
                    <th class="text-left py-2 font-bold" style="color: var(--color-text-primary)">ชื่อสินค้า</th>
                    <th class="text-left py-2 font-bold w-28" style="color: var(--color-text-primary)">ประเภท</th>
                    <th class="text-left py-2 font-bold w-28" style="color: var(--color-text-primary)">ประเภทที่ใช้</th>
                    <th class="text-right py-2 font-bold w-20" style="color: var(--color-text-primary)">คงเหลือ</th>
                    <th class="text-center py-2 font-bold w-24" style="color: var(--color-text-primary)">สถานะ</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-if="filteredSummaryProducts.length === 0">
                    <td colspan="6" class="py-10 text-center text-[12px] font-semibold" style="color: var(--color-text-secondary)">ไม่พบข้อมูลพัสดุ</td>
                  </tr>
                  <tr v-for="p in filteredSummaryProducts" :key="p.item_code" class="border-b last:border-0 hover:bg-slate-50/50 dark:hover:bg-slate-800/20 transition-colors" style="border-color: var(--color-border)">
                    <td class="py-2.5 truncate font-mono font-bold" style="color: var(--color-text-secondary)">{{ p.item_code }}</td>
                    <td class="py-2.5 truncate font-bold" style="color: var(--color-text-primary)" :title="p.item_name">{{ p.item_name }}</td>
                    <td class="py-2.5 truncate font-semibold text-[12px]" style="color: var(--color-text-secondary)">{{ p.category_name }}</td>
                    <td class="py-2.5 truncate font-semibold text-[12px]" style="color: var(--color-text-secondary)">{{ p.usage_type }}</td>
                    <td class="py-2.5 text-right">
                      <span class="font-bold text-[14px]" :style="`color: ${p.statusColor}`">{{ p.current_stock }}</span>
                      <span class="text-[11px] font-bold ml-1" style="color: var(--color-text-secondary)">{{ p.unit }}</span>
                    </td>
                    <td class="py-2.5 text-center">
                      <span class="px-2 py-0.5 rounded text-[11px] font-extrabold" 
                        :style="`background: ${p.statusColor}15; color: ${p.statusColor}; border: 1px solid ${p.statusColor}30`">
                        {{ p.status }}
                      </span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            
            <div class="mt-4 text-center border-t pt-3" style="border-color: var(--color-border)">
              <button class="text-[12px] font-bold hover:underline" style="color: var(--color-primary)">
                ดูรายการสินค้าทั้งหมด <i class="fa-solid fa-chevron-right ml-1"></i>
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- ── Row 4: Top Withdrawn Items (Split Chart & Table) ───────────── -->
      <div v-if="barSeries.length" class="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-5">
        <!-- Left: Chart -->
        <div class="rounded-xl border p-4" style="background: var(--color-bg-card); border-color: var(--color-border)">
          <div class="mb-3">
            <p class="text-[15px] font-bold" style="color: var(--color-text-primary)">Top สินค้าที่เบิกมากที่สุด (กราฟ)</p>
            <p class="text-[13px] font-bold" style="color: var(--color-text-primary)">เรียงตามปริมาณการเบิก</p>
          </div>
          <div class="h-80"><canvas ref="barChartRef"></canvas></div>
        </div>

        <!-- Right: Table -->
        <div class="rounded-xl border p-4 overflow-hidden" style="background: var(--color-bg-card); border-color: var(--color-border)">
          <div class="mb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <p class="text-[15px] font-bold" style="color: var(--color-text-primary)">รายละเอียดสินค้าที่เบิกมากที่สุด</p>
              <p class="text-[13px] font-bold" style="color: var(--color-text-primary)">ประเภท รหัส ชื่อ และจำนวนคงเหลือ</p>
            </div>
            <div class="flex items-center gap-2">
              <div class="relative">
                <i class="fa-solid fa-magnifying-glass absolute left-2.5 top-1/2 -translate-y-1/2 text-[11px]" style="color: var(--color-text-muted)"></i>
                <input v-model="topWithdrawSearchText" type="text" placeholder="ค้นหาสินค้า..." 
                  class="pl-8 pr-3 py-1.5 border rounded-lg text-[12px] focus:outline-none focus:ring-1 transition-all w-32 sm:w-40"
                  style="border-color: var(--color-border); background: var(--color-bg-base); color: var(--color-text-primary)" />
              </div>
              <span class="text-[11px] font-bold px-2 py-0.5 rounded-full" style="background: rgba(148,163,184,0.12); color: var(--color-text-secondary)">{{ filteredTopWithdrawItems.length }} รายการ</span>
            </div>
          </div>
          <div class="overflow-x-auto">
            <table class="w-full text-[12px] table-fixed min-w-[600px]">
              <thead>
                <tr class="border-b" style="border-color: var(--color-border)">
                  <th class="text-left py-2 font-bold w-28" style="color: var(--color-text-primary)">ประเภทที่ใช้</th>
                  <th class="text-left py-2 font-bold w-28" style="color: var(--color-text-primary)">รหัสสินค้า</th>
                  <th class="text-left py-2 font-bold" style="color: var(--color-text-primary)">ชื่อสินค้า</th>
                  <th class="text-left py-2 font-bold w-24" style="color: var(--color-text-primary)">หมวดหมู่</th>
                  <th class="text-right py-2 font-bold w-20" style="color: var(--color-text-primary)">จำนวนที่ใช้</th>
                  <th class="text-right py-2 font-bold w-20" style="color: var(--color-text-primary)">ยังคงเหลือ</th>
                </tr>
              </thead>
              <tbody>
                <tr v-if="filteredTopWithdrawItems.length === 0">
                  <td colspan="6" class="py-10 text-center text-[12px] font-semibold" style="color: var(--color-text-secondary)">ไม่พบข้อมูลพัสดุ</td>
                </tr>
                <tr v-for="item in filteredTopWithdrawItems" :key="item.id" class="border-b last:border-0 hover:bg-slate-50/50 dark:hover:bg-slate-800/20 transition-colors" style="border-color: var(--color-border)">
                  <td class="py-2.5 truncate font-semibold" style="color: var(--color-text-secondary)">{{ item.usage_type }}</td>
                  <td class="py-2.5 truncate font-mono font-bold" style="color: var(--color-text-secondary)">{{ item.item_code }}</td>
                  <td class="py-2.5 truncate font-bold" style="color: var(--color-text-primary)" :title="item.name">{{ item.name }}</td>
                  <td class="py-2.5 truncate font-semibold" style="color: var(--color-text-secondary)">{{ item.category_name }}</td>
                  <td class="py-2.5 text-right font-bold" style="color: var(--color-primary)">{{ item.qty.toLocaleString() }}</td>
                  <td class="py-2.5 text-right font-semibold" :style="item.current_stock <= 10 ? 'color: #EF4444' : 'color: var(--color-text-primary)'">{{ item.current_stock.toLocaleString() }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- ── Row 5: Tables ─────────────────────────────────────────────── -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-5">

        <div class="rounded-xl border overflow-hidden" style="background: var(--color-bg-card); border-color: var(--color-border)">
          <div class="px-4 py-3 flex items-center justify-between border-b" style="border-color: var(--color-border)">
            <div class="flex items-center gap-2">
              <span class="w-2 h-2 rounded-full" style="background: #94A3B8"></span>
              <p class="text-[15px] font-bold" style="color: var(--color-text-primary)">รายการเบิกล่าสุด</p>
            </div>
            <span class="text-[12px] font-bold px-2 py-0.5 rounded-full" style="background: rgba(148,163,184,0.12); color: var(--color-text-secondary)">{{ recentTransactions.length }} รายการ</span>
          </div>
          <div class="overflow-x-auto">
            <table class="w-full text-[13px]">
              <thead>
                <tr style="border-bottom: 1px solid var(--color-border)">
                  <th class="text-left px-3 py-2 font-bold" style="color: var(--color-text-primary)">สินค้า</th>
                  <th class="text-right px-3 py-2 font-bold" style="color: var(--color-text-primary)">จำนวน</th>
                  <th class="text-left px-3 py-2 font-bold hidden sm:table-cell" style="color: var(--color-text-primary)">ผู้เบิก</th>
                  <th class="text-left px-3 py-2 font-bold" style="color: var(--color-text-primary)">วันที่</th>
                </tr>
              </thead>
              <tbody>
                <tr v-if="recentTransactions.length===0">
                  <td colspan="4" class="px-3 py-6 text-center text-[13px] font-semibold" style="color: var(--color-text-secondary)">ไม่มีรายการ</td>
                </tr>
                <tr v-for="t in recentTransactions" :key="t.id" class="border-b last:border-b-0 hover:opacity-80 transition-opacity" style="border-color: var(--color-border)">
                  <td class="px-3 py-2">
                    <p class="font-bold leading-tight" style="color: var(--color-text-primary)">{{ t.item_name }}</p>
                    <p class="text-[11px] font-semibold font-mono" style="color: var(--color-text-secondary)">{{ t.item_code }}</p>
                  </td>
                  <td class="px-3 py-2 text-right">
                    <span class="font-bold" style="color: var(--color-text-primary)">{{ t.amount }}</span>
                    <span class="text-[11px] font-bold ml-0.5" style="color: var(--color-text-secondary)">{{ t.unit }}</span>
                  </td>
                  <td class="px-3 py-2 hidden sm:table-cell">
                    <p class="font-bold" style="color: var(--color-text-primary)">{{ t.created_by_name }}</p>
                    <p class="text-[11px] font-semibold font-mono" style="color: var(--color-text-secondary)">{{ t.emp_code }}</p>
                  </td>
                  <td class="px-3 py-2 text-[12px] font-semibold" style="color: var(--color-text-secondary)">{{ fmtDateTimeShort(t.created_at) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div class="rounded-xl border overflow-hidden" style="background: var(--color-bg-card); border-color: var(--color-border)">
          <div class="px-4 py-3 flex items-center justify-between border-b" style="border-color: var(--color-border)">
            <div class="flex items-center gap-2">
              <span class="w-2 h-2 rounded-full" style="background: #64748B"></span>
              <p class="text-[15px] font-bold" style="color: var(--color-text-primary)">คำขอเบิกล่าสุด</p>
            </div>
            <span class="text-[12px] font-bold px-2 py-0.5 rounded-full" style="background: rgba(100,116,139,0.12); color: var(--color-text-secondary)">{{ recentOrders.length }} รายการ</span>
          </div>
          <div class="overflow-x-auto">
            <table class="w-full text-[13px]">
              <thead>
                <tr style="border-bottom: 1px solid var(--color-border)">
                  <th class="text-left px-3 py-2 font-bold" style="color: var(--color-text-primary)">#</th>
                  <th class="text-left px-3 py-2 font-bold" style="color: var(--color-text-primary)">สินค้า</th>
                  <th class="text-left px-3 py-2 font-bold hidden sm:table-cell" style="color: var(--color-text-primary)">หน่วยงาน</th>
                  <th class="text-center px-3 py-2 font-bold" style="color: var(--color-text-primary)">สถานะ</th>
                  <th class="text-left px-3 py-2 font-bold" style="color: var(--color-text-primary)">วันที่</th>
                </tr>
              </thead>
              <tbody>
                <tr v-if="recentOrders.length===0">
                  <td colspan="5" class="px-3 py-6 text-center text-[13px] font-semibold" style="color: var(--color-text-secondary)">ไม่มีรายการ</td>
                </tr>
                <tr v-for="o in recentOrders" :key="o.id" class="border-b last:border-b-0 hover:opacity-80 transition-opacity" style="border-color: var(--color-border)">
                  <td class="px-3 py-2 font-mono text-[12px] font-bold" style="color: var(--color-text-secondary)">#{{ o.request_id }}</td>
                  <td class="px-3 py-2">
                    <p class="font-bold leading-tight" style="color: var(--color-text-primary)">{{ o.item_name }}</p>
                    <p class="text-[11px] font-semibold" style="color: var(--color-text-secondary)">{{ o.creator }}</p>
                  </td>
                  <td class="px-3 py-2 hidden sm:table-cell">
                    <p class="text-[12px] font-bold" style="color: var(--color-text-primary)">{{ o.company }}</p>
                    <p class="text-[11px] font-semibold font-mono" style="color: var(--color-text-secondary)">{{ o.mr_number }}</p>
                  </td>
                  <td class="px-3 py-2 text-center">
                    <span class="inline-block px-2 py-0.5 rounded-full text-[11px] font-bold" :style="`background: ${statusColor(o.status)}18; color: ${statusColor(o.status)}`">{{ statusLabel(o.status) }}</span>
                  </td>
                  <td class="px-3 py-2 text-[12px] font-semibold" style="color: var(--color-text-secondary)">{{ fmtDateTimeShort(o.created_at) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- ── Row 6: Low Stock Alert ─────────────────────────────────────── -->
      <div class="rounded-xl border" style="background: var(--color-bg-card); border-color: var(--color-border)">
        <div class="px-4 py-3 flex items-center justify-between border-b" style="border-color: var(--color-border)">
          <div class="flex items-center gap-2">
            <i class="fa-solid fa-triangle-exclamation" style="color: var(--color-text-muted)"></i>
            <p class="text-[15px] font-bold" style="color: var(--color-text-primary)">แจ้งเตือนสต็อกต่ำ <span class="text-[13px] font-semibold ml-1" style="color: var(--color-text-secondary)">(≤ 10 หน่วย)</span></p>
          </div>
          <div class="flex gap-2 text-[12px] font-bold">
            <span class="px-2 py-0.5 rounded-full" style="background: rgba(100,116,139,0.12); color: var(--color-text-primary)">วิกฤต (0-2): {{ lowStockItems.filter(i=>i.current_stock<=2).length }}</span>
            <span class="px-2 py-0.5 rounded-full" style="background: rgba(148,163,184,0.12); color: var(--color-text-secondary)">ต่ำ (3-10): {{ lowStockItems.filter(i=>i.current_stock>2&&i.current_stock<=10).length }}</span>
          </div>
        </div>
        <div v-if="lowStockItems.length === 0" class="px-4 py-6 text-center text-[14px] font-bold" style="color: var(--color-text-secondary)">
          <i class="fa-solid fa-check-circle mr-2" style="color: #64748B"></i>สต็อกทุกรายการอยู่ในระดับปกติ
        </div>
        <div v-else class="p-4">
          <div class="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10 gap-2">
            <div v-for="item in lowStockItems" :key="item.id"
              class="rounded-xl border p-3 text-center relative overflow-hidden"
              :style="`border-color: var(--color-border); background: ${item.current_stock === 0 ? 'rgba(100,116,139,0.08)' : 'rgba(148,163,184,0.05)'}`">
              <p class="text-[11px] font-bold leading-tight mb-1 line-clamp-2" style="color: var(--color-text-secondary); min-height:28px">{{ item.item_name }}</p>
              <p class="text-[28px] font-black leading-none" :style="`color: ${item.current_stock === 0 ? 'var(--color-text-primary)' : 'var(--color-text-secondary)'}`">{{ item.current_stock }}</p>
              <p class="text-[11px] font-bold mt-0.5" style="color: var(--color-text-secondary)">{{ item.unit }}</p>
              <span class="inline-block mt-1.5 px-1.5 py-0.5 rounded text-[10px] font-extrabold"
                :style="item.current_stock === 0
                  ? 'background: rgba(71,85,105,0.15); color: var(--color-text-primary)'
                  : item.current_stock <= 2
                    ? 'background: rgba(100,116,139,0.12); color: var(--color-text-secondary)'
                    : 'background: rgba(148,163,184,0.12); color: var(--color-text-secondary)'">
                {{ item.current_stock === 0 ? 'หมด' : item.current_stock <= 2 ? 'วิกฤต' : 'ต่ำ' }}
              </span>
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- ── Detail Modal ─────────────────────────────────────────────────── -->
    <div v-if="isDetailModalOpen" class="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div class="absolute inset-0 bg-black/40 backdrop-blur-sm" @click="isDetailModalOpen = false"></div>
      <div class="relative w-full max-w-5xl max-h-[85vh] shadow-2xl rounded-2xl flex flex-col overflow-hidden" style="background: var(--color-bg-card)">
        <div class="px-6 py-4 border-b flex items-center justify-between" style="border-color: var(--color-border)">
          <h2 class="text-[18px] font-extrabold" style="color: var(--color-text-primary)">
            <i class="fa-solid fa-list-ul mr-2" style="color: var(--color-text-secondary)"></i>{{ modalTitle }}
          </h2>
          <div class="flex items-center gap-4">
            <div v-if="!modalLoading && modalData.length > 0" class="relative">
              <i class="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-[12px]" style="color: var(--color-text-muted)"></i>
              <input v-model="modalSearchText" type="text" placeholder="ค้นหาในตาราง..."
                class="pl-9 pr-4 py-1.5 border rounded-lg text-[13px] focus:outline-none focus:ring-1 transition-all w-48 sm:w-64"
                style="border-color: var(--color-border); background: var(--color-bg-base); color: var(--color-text-primary)" />
            </div>
            <button @click="isDetailModalOpen = false" class="p-2 hover:bg-gray-100 dark:hover:bg-slate-700/50 rounded-lg transition-colors">
              <i class="fa-solid fa-xmark" style="color: var(--color-text-secondary)"></i>
            </button>
          </div>
        </div>

        <div class="flex-1 overflow-auto p-4 sm:p-6">
          <div v-if="modalLoading" class="flex flex-col items-center justify-center py-20">
            <i class="fa-solid fa-spinner fa-spin text-2xl mb-3" style="color: var(--color-text-muted)"></i>
            <p class="text-[14px] font-semibold" style="color: var(--color-text-secondary)">กำลังโหลดข้อมูล...</p>
          </div>

          <div v-else-if="filteredModalData.length === 0" class="flex flex-col items-center justify-center py-20">
            <i class="fa-solid fa-magnifying-glass text-2xl mb-3" style="color: var(--color-text-muted)"></i>
            <p class="text-[14px] font-semibold" style="color: var(--color-text-secondary)">ไม่พบข้อมูลที่ค้นหา</p>
          </div>

          <div v-else class="overflow-x-auto border rounded-xl" style="border-color: var(--color-border)">
            <table class="w-full text-[13px]">
              <thead class="bg-gray-50 dark:bg-slate-800/50">
                <tr style="border-bottom: 1px solid var(--color-border)">
                  <template v-if="modalType === 'items' || modalType === 'low_stock' || modalType === 'items_by_category'">
                    <th class="text-left px-4 py-3 font-bold" style="color: var(--color-text-primary)">รหัสสินค้า</th>
                    <th class="text-left px-4 py-3 font-bold" style="color: var(--color-text-primary)">ชื่อสินค้า</th>
                    <th class="text-left px-4 py-3 font-bold" style="color: var(--color-text-primary)">ประเภท</th>
                    <th class="text-left px-4 py-3 font-bold" style="color: var(--color-text-primary)">ประเภทที่ใช้</th>
                    <th class="text-right px-4 py-3 font-bold" style="color: var(--color-text-primary)">จำนวนคงเหลือ</th>
                    <th class="text-left px-4 py-3 font-bold" style="color: var(--color-text-primary)">หน่วย</th>
                  </template>
                  <template v-else-if="modalType === 'imports' || modalType === 'tx' || modalType === 'requester_tx'">
                    <th class="text-left px-4 py-3 font-bold" style="color: var(--color-text-primary)">วันที่</th>
                    <th class="text-left px-4 py-3 font-bold" style="color: var(--color-text-primary)">รหัสสินค้า</th>
                    <th class="text-left px-4 py-3 font-bold" style="color: var(--color-text-primary)">ชื่อสินค้า</th>
                    <th class="text-right px-4 py-3 font-bold" style="color: var(--color-text-primary)">จำนวน</th>
                    <th class="text-left px-4 py-3 font-bold" style="color: var(--color-text-primary)">หน่วย</th>
                    <th class="text-left px-4 py-3 font-bold" style="color: var(--color-text-primary)">ผู้ดำเนินการ</th>
                    <th class="text-left px-4 py-3 font-bold" style="color: var(--color-text-primary)">หมายเหตุ</th>
                  </template>
                  <template v-else-if="['pending', 'approved', 'rejected', 'completed', 'all_orders', 'picked_orders'].includes(modalType)">
                    <th class="text-left px-4 py-3 font-bold" style="color: var(--color-text-primary)">เลขที่</th>
                    <th class="text-left px-4 py-3 font-bold" style="color: var(--color-text-primary)">รหัสสินค้า</th>
                    <th class="text-left px-4 py-3 font-bold" style="color: var(--color-text-primary)">ชื่อสินค้า</th>
                    <th class="text-right px-4 py-3 font-bold" style="color: var(--color-text-primary)">จำนวน</th>
                    <th class="text-left px-4 py-3 font-bold" style="color: var(--color-text-primary)">หน่วยงาน</th>
                    <th class="text-left px-4 py-3 font-bold" style="color: var(--color-text-primary)">ผู้ขอเบิก</th>
                    <th class="text-center px-4 py-3 font-bold" style="color: var(--color-text-primary)">สถานะ</th>
                    <th class="text-left px-4 py-3 font-bold" style="color: var(--color-text-primary)">วันที่ขอ</th>
                  </template>
                  <template v-else-if="modalType === 'category_summary'">
                    <th class="text-left px-4 py-3 font-bold" style="color: var(--color-text-primary)">ชื่อหมวดหมู่</th>
                    <th class="text-right px-4 py-3 font-bold" style="color: var(--color-text-primary)">จำนวนรายการ (SKU)</th>
                    <th class="text-right px-4 py-3 font-bold" style="color: var(--color-text-primary)">สต็อกรวมในหมวด</th>
                    <th class="text-left px-4 py-3 font-bold" style="color: var(--color-text-primary)">หมายเหตุ</th>
                  </template>
                </tr>
              </thead>
              <tbody class="divide-y" style="border-color: var(--color-border)">
                <tr v-for="row in filteredModalData" :key="row.id" class="hover:bg-gray-50 dark:hover:bg-slate-700/30 transition-colors">
                  <template v-if="modalType === 'items' || modalType === 'low_stock' || modalType === 'items_by_category'">
                    <td class="px-4 py-3 font-mono text-[12px] font-semibold" style="color: var(--color-text-secondary)">{{ row.item_code }}</td>
                    <td class="px-4 py-3 font-bold" style="color: var(--color-text-primary)">{{ row.item_name }}</td>
                    <td class="px-4 py-3 font-semibold" style="color: var(--color-text-primary)">{{ row.category?.category_name || '-' }}</td>
                    <td class="px-4 py-3 font-semibold" style="color: var(--color-text-primary)">{{ row.usage_type || '-' }}</td>
                    <td class="px-4 py-3 text-right font-extrabold" style="color: var(--color-text-primary)">{{ row.current_stock }}</td>
                    <td class="px-4 py-3 font-semibold" style="color: var(--color-text-primary)">{{ row.unit }}</td>
                  </template>
                  <template v-else-if="modalType === 'imports' || modalType === 'tx' || modalType === 'requester_tx'">
                    <td class="px-4 py-3 text-[12px] font-semibold" style="color: var(--color-text-secondary)">{{ fmtDateTimeShort(row.created_at) }}</td>
                    <td class="px-4 py-3 font-mono text-[12px] font-semibold" style="color: var(--color-text-secondary)">{{ row.items?.item_code || '-' }}</td>
                    <td class="px-4 py-3 font-bold" style="color: var(--color-text-primary)">{{ row.items?.item_name || '-' }}</td>
                    <td class="px-4 py-3 text-right font-extrabold" style="color: var(--color-text-primary)">{{ row.amount }}</td>
                    <td class="px-4 py-3 font-semibold" style="color: var(--color-text-primary)">{{ row.unit }}</td>
                    <td class="px-4 py-3 font-semibold" style="color: var(--color-text-primary)">{{ row.creator?.fullname || '-' }}</td>
                    <td class="px-4 py-3 max-w-[150px] truncate font-medium" style="color: var(--color-text-secondary)" :title="row.remark">{{ row.remark || '-' }}</td>
                  </template>
                  <template v-else-if="['pending', 'approved', 'rejected', 'completed', 'all_orders', 'picked_orders'].includes(modalType)">
                    <td class="px-4 py-3 font-mono text-[12px] font-bold" style="color: var(--color-text-secondary)">#{{ row.request_id }}</td>
                    <td class="px-4 py-3 font-mono text-[12px] font-semibold" style="color: var(--color-text-secondary)">{{ row.items?.item_code || '-' }}</td>
                    <td class="px-4 py-3 font-bold" style="color: var(--color-text-primary)">{{ row.items?.item_name || '-' }}</td>
                    <td class="px-4 py-3 text-right font-extrabold" style="color: var(--color-text-primary)">{{ row.amount }} {{ row.unit }}</td>
                    <td class="px-4 py-3 font-semibold" style="color: var(--color-text-primary)">{{ row.company || '-' }}</td>
                    <td class="px-4 py-3 font-semibold" style="color: var(--color-text-primary)">{{ row.creator?.fullname || '-' }}</td>
                    <td class="px-4 py-3 text-center">
                      <span class="px-2 py-0.5 rounded-full text-[11px] font-bold" :style="`background: ${statusColor(row.status)}18; color: ${statusColor(row.status)}`">{{ statusLabel(row.status) }}</span>
                    </td>
                    <td class="px-4 py-3 text-[12px] font-semibold" style="color: var(--color-text-secondary)">{{ fmtDateTimeShort(row.created_at) }}</td>
                  </template>
                  <template v-else-if="modalType === 'category_summary'">
                    <td class="px-4 py-3 font-bold" style="color: var(--color-text-primary)">
                      <button @click="openDetailModal('items_by_category', row.id, row.category_name)" class="hover:underline transition-colors text-left font-bold" style="color: var(--color-text-primary)">
                        {{ row.category_name }}
                      </button>
                    </td>
                    <td class="px-4 py-3 text-right font-extrabold" style="color: var(--color-text-primary)">{{ row.sku_count }}</td>
                    <td class="px-4 py-3 text-right font-extrabold" style="color: var(--color-text-primary)">{{ row.total_stock }}</td>
                    <td class="px-4 py-3 font-medium" style="color: var(--color-text-secondary)">{{ row.remark || '-' }}</td>
                  </template>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div class="px-6 py-4 border-t flex justify-between items-center" style="border-color: var(--color-border); background: var(--color-bg-base)">
          <p class="text-[13px] font-bold" style="color: var(--color-text-secondary)">
            <span v-if="modalSearchText">พบ {{ filteredModalData.length }} จาก </span>
            แสดงทั้งหมด {{ modalData.length }} รายการ
          </p>
          <button @click="isDetailModalOpen = false" class="px-4 py-1.5 rounded-lg text-[13px] font-bold text-white transition-all active:scale-95" style="background: var(--color-primary)">
            ปิดหน้าต่าง
          </button>
        </div>
      </div>
    </div>
  </AppLayout>
</template>