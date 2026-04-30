<script setup>
import { computed, onMounted, ref } from 'vue'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()

const loading = ref(true)
const saving = ref(false)
const rows = ref([])

const prFilter = ref('')
const pageSize = 20
const page = ref(1)

const expandedPrKey = ref(null)
const selectedReqIds = ref([])
const expandedOrderReqIds = ref([])

const isEditOpen = ref(false)
const editMode = ref('single')
const bulkTargetIds = ref([])
const bulkIsFinish = ref('')
const selectedReq = ref(null)
const selectedOrder = ref(null)

const preJobStatusOptions = ref([])
const purchaseStatusOptions = ref([])
const storeNameOptions = ref([])

const form = ref({
  status_receive: '',
  date_recieve: '',
  receive_by: '',
  store_by: '',
  lao_po_number: '',
  ap_number: '',
  pr_thai: '',
  status_purchase: '',
  is_finish: false,
})

async function fetchPreJobStatusOptions() {
  try {
    const { data, error } = await supabase
      .from('pre_job_status')
      .select('job_name')
      .order('id', { ascending: true })
    if (error) throw error
    preJobStatusOptions.value = (data || [])
      .map((r) => String(r?.job_name || '').trim())
      .filter(Boolean)
  } catch {
    preJobStatusOptions.value = []
  }
}

async function fetchPurchaseStatusOptions() {
  try {
    const { data, error } = await supabase
      .from('purchase_status')
      .select('status_name')
      .order('id', { ascending: true })
    if (error) throw error
    purchaseStatusOptions.value = (data || [])
      .map((r) => String(r?.status_name || '').trim())
      .filter(Boolean)
  } catch {
    purchaseStatusOptions.value = []
  }
}

async function fetchStoreNameOptions() {
  try {
    const { data, error } = await supabase
      .from('store')
      .select('store_name')
      .order('store_name', { ascending: true })
    if (error) throw error
    const set = new Set()
    for (const r of data || []) {
      const name = String(r?.store_name || '').trim()
      if (name) set.add(name)
    }
    storeNameOptions.value = Array.from(set)
  } catch {
    storeNameOptions.value = []
  }
}

function explainSupabasePolicyHint(err) {
  const msg = String(err?.message || '')
  const code = String(err?.code || '')
  const status = String(err?.status || '')

  if (
    msg.toLowerCase().includes('row-level security') ||
    msg.toLowerCase().includes('violates row-level security') ||
    code === '42501'
  ) {
    return (
      'ตาราง purchasing_req / purchasing_order เปิด RLS อยู่ แต่ยังไม่มี Policy อนุญาตให้ role: anon เข้าถึง/บันทึกได้\n' +
      'ให้ไปที่ Supabase > Table Editor แล้วสร้าง Policy สำหรับ SELECT/INSERT/UPDATE/DELETE (หรือปิด RLS ถ้าต้องการให้บันทึกได้เลย)'
    )
  }

  if (status === '401' || msg.includes('401')) {
    return (
      'Supabase ตอบกลับ 401 (Unauthorized)\n' +
      'สาเหตุที่พบบ่อย: ยังไม่มี apikey/JWT ที่ใช้งานได้ หรือ RLS/Policy ไม่อนุญาตให้เข้าถึงตารางนี้'
    )
  }

  return null
}

function getErrorText(err) {
  return explainSupabasePolicyHint(err) || String(err?.message || err || 'เกิดข้อผิดพลาด')
}

function formatDateTime(value) {
  if (!value) return '-'
  return new Date(value).toLocaleString('th-TH')
}

function formatReqDateTime(value) {
  if (!value) return '-'
  const d = new Date(value)
  const day = String(d.getDate())
  const month = String(d.getMonth() + 1)
  const year = String(d.getFullYear())
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${day}/${month}/${year} ${hh}:${mm}`
}

function shortId(value) {
  if (!value) return '-'
  const s = String(value)
  return s.length > 12 ? `${s.slice(0, 8)}…${s.slice(-4)}` : s
}

function creatorText(row) {
  const c = row?._creator
  if (!c) return row?.created_by ? shortId(row.created_by) : '-'
  const base = c.emp_code ? `${c.fullname} (${c.emp_code})` : c.fullname || c.username || '-'
  const dep = String(c.department ?? '').trim()
  if (!dep) return base
  return `${base}\nหน่วยงาน: ${dep}`
}

async function fetchPurchasingReq() {
  loading.value = true
  try {
    const { data, error } = await supabase
      .from('purchasing_req')
      .select(
        'id, pr_number, urgent_id, purchase_team_id, details, amount_req, unit, air_code, created_by, created_at, updated_at'
      )
      .order('created_at', { ascending: false })

    if (error) throw error
    const list = data || []

    const urgentIds = [...new Set(list.map((r) => r.urgent_id).filter(Boolean))]
    const urgentNameById = {}
    if (urgentIds.length) {
      const { data: urgents, error: urgentsError } = await supabase
        .from('urgents')
        .select('id, option_name')
        .in('id', urgentIds)
      if (!urgentsError) {
        for (const u of urgents || []) {
          const id = u?.id
          const name = String(u?.option_name ?? '').trim()
          if (id && name) urgentNameById[id] = name
        }
      }
    }

    const teamIds = [...new Set(list.map((r) => r.purchase_team_id).filter(Boolean))]
    const teamNameById = {}
    if (teamIds.length) {
      const { data: teams, error: teamsError } = await supabase
        .from('purchasing_team')
        .select('id, team_name')
        .in('id', teamIds)
      if (!teamsError) {
        for (const t of teams || []) {
          const id = t?.id
          const name = String(t?.team_name ?? '').trim()
          if (id && name) teamNameById[id] = name
        }
      }
    }

    const reqIds = list.map((r) => r.id).filter(Boolean)
    const orderByPrId = {}
    if (reqIds.length) {
      const { data: orders, error: ordersError } = await supabase
        .from('purchasing_order')
        .select(
          'id, pr_id, status_receive, date_recieve, receive_by, store_by, lao_po_number, ap_number, pr_thai, status_purchase, is_finish, created_by, updated_by, created_at, updated_at'
        )
        .in('pr_id', reqIds)

      if (!ordersError) {
        for (const o of orders || []) {
          const current = orderByPrId[o.pr_id]
          if (!current) {
            orderByPrId[o.pr_id] = o
            continue
          }
          const a = +new Date(current.updated_at || current.created_at || 0)
          const b = +new Date(o.updated_at || o.created_at || 0)
          if (b >= a) orderByPrId[o.pr_id] = o
        }
      }
    }

    const creatorIds = [...new Set(list.map((r) => r.created_by).filter(Boolean))]
    const creatorById = {}
    if (creatorIds.length) {
      const { data: creators, error: creatorsError } = await supabase
        .from('system_users')
        .select('id, fullname, emp_code, username, department')
        .in('id', creatorIds)

      if (!creatorsError) {
        for (const u of creators || []) creatorById[u.id] = u
      }
    }

    rows.value = list.map((r) => ({
      ...r,
      _creator: r.created_by ? creatorById[r.created_by] : null,
      _urgent_name: r.urgent_id ? urgentNameById[r.urgent_id] || null : null,
      _purchase_team_name: r.purchase_team_id ? teamNameById[r.purchase_team_id] || null : null,
      _order: orderByPrId[r.id] || null,
    }))
  } catch (err) {
    alert('โหลดข้อมูล PR ไม่สำเร็จ: ' + getErrorText(err))
    rows.value = []
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  fetchPurchasingReq()
  fetchPreJobStatusOptions()
  fetchPurchaseStatusOptions()
  fetchStoreNameOptions()
})

function prKey(value) {
  const raw = String(value ?? '').trim()
  const digits = raw.replace(/\D/g, '')
  if (digits.length >= 10) return digits.slice(-10)
  return digits || raw
}

function itemLineText(r) {
  const name = String(r?.details || '-')
  const amount = r?.amount_req ?? '-'
  const unit = r?.unit ? ` ${r.unit}` : ''
  return `${name} — ${amount}${unit}`.trim()
}

const groupedRows = computed(() => {
  const map = new Map()
  for (const r of rows.value || []) {
    const key = prKey(r?.pr_number)
    if (!key) continue
    const k = String(key)
    const existing = map.get(k)
    if (existing) {
      existing.items.push(r)
      if (!existing.pr_number && r?.pr_number) existing.pr_number = r.pr_number
      continue
    }
    map.set(k, {
      key: k,
      pr_number: r?.pr_number || k,
      items: [r],
    })
  }
  const groups = Array.from(map.values()).filter((g) => (g.items || []).some((x) => !x?._order?.is_finish))
  groups.sort((a, b) => {
    const aTime = Math.max(...a.items.map((x) => +new Date(x?.created_at || 0)))
    const bTime = Math.max(...b.items.map((x) => +new Date(x?.created_at || 0)))
    return bTime - aTime
  })
  return groups.map((g) => {
    const newest = Math.max(...g.items.map((x) => +new Date(x?.created_at || 0)))
    const seen = new Set()
    const uniqueLines = []
    for (const item of g.items || []) {
      const text = itemLineText(item)
      const norm = text.replace(/\s+/g, ' ').trim().toLowerCase()
      if (!norm || seen.has(norm)) continue
      seen.add(norm)
      uniqueLines.push(text)
    }
    return {
      ...g,
      newestCreatedAt: newest ? new Date(newest).toISOString() : null,
      detailsText: uniqueLines.join(', '),
    }
  })
})

const prNumberOptions = computed(() => {
  const set = new Set()
  for (const g of groupedRows.value || []) {
    if (g?.key) set.add(String(g.key))
  }
  return Array.from(set).sort()
})

const filteredGroups = computed(() => {
  const raw = prFilter.value.trim()
  const list = groupedRows.value || []
  if (!raw) return list

  const key = prKey(raw).toLowerCase()
  if (!key) return list
  return list.filter((g) => String(g.key || '').toLowerCase().includes(key))
})

const totalRows = computed(() => filteredGroups.value.length)
const totalPages = computed(() => Math.max(1, Math.ceil(totalRows.value / pageSize)))
const pagedGroups = computed(() => {
  const p = Math.min(Math.max(page.value, 1), totalPages.value)
  const start = (p - 1) * pageSize
  return filteredGroups.value.slice(start, start + pageSize)
})

const selectedCount = computed(() => selectedReqIds.value.length)

function onFilterChanged() {
  page.value = 1
}
function goPrev() {
  page.value = Math.max(1, page.value - 1)
}
function goNext() {
  page.value = Math.min(totalPages.value, page.value + 1)
}

function isSelected(id) {
  return selectedReqIds.value.includes(id)
}

function toggleSelected(id) {
  if (!id) return
  const next = new Set(selectedReqIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selectedReqIds.value = Array.from(next)
}

function toggleSelectAllInGroup(group) {
  const ids = (group?.items || []).map((r) => r?.id).filter(Boolean)
  if (!ids.length) return
  const next = new Set(selectedReqIds.value)
  const shouldSelectAll = !ids.every((id) => next.has(id))
  if (shouldSelectAll) {
    for (const id of ids) next.add(id)
  } else {
    for (const id of ids) next.delete(id)
  }
  selectedReqIds.value = Array.from(next)
}

function groupAllSelected(group) {
  const ids = (group?.items || []).map((r) => r?.id).filter(Boolean)
  if (!ids.length) return false
  return ids.every((id) => selectedReqIds.value.includes(id))
}

function groupSomeSelected(group) {
  const ids = (group?.items || []).map((r) => r?.id).filter(Boolean)
  if (!ids.length) return false
  const selected = ids.filter((id) => selectedReqIds.value.includes(id)).length
  return selected > 0 && selected < ids.length
}

function todayDateString() {
  return new Date().toISOString().slice(0, 10)
}

function receiveByFromLogin() {
  return (
    auth.user?.fullname ||
    auth.user?.username ||
    auth.user?.emp_code ||
    auth.user?.id ||
    ''
  )
}

function shouldStampReceiveMetaFromStatus(value) {
  const v = String(value ?? '').trim()
  if (!v) return false
  return v !== 'รอรับงาน'
}

function isOrderExpanded(reqId) {
  return expandedOrderReqIds.value.includes(reqId)
}

function toggleOrderExpanded(reqId) {
  if (!reqId) return
  const next = new Set(expandedOrderReqIds.value)
  if (next.has(reqId)) next.delete(reqId)
  else next.add(reqId)
  expandedOrderReqIds.value = Array.from(next)
}

function toggleExpanded(group) {
  const key = group?.key
  if (!key) return
  expandedPrKey.value = expandedPrKey.value === key ? null : key
}

function editSelected() {
  if (!selectedReqIds.value.length) return
  if (selectedReqIds.value.length === 1) {
    const id = selectedReqIds.value[0]
    const row = (rows.value || []).find((r) => r?.id === id)
    if (!row) return
    openEdit(row)
    return
  }
  openBulkEdit()
}

function openEdit(reqRow) {
  if (!reqRow?.id) return
  if (!auth.user?.id) return alert('ไม่พบข้อมูลผู้ใช้ กรุณาเข้าสู่ระบบใหม่')

  editMode.value = 'single'
  bulkTargetIds.value = []
  bulkIsFinish.value = ''
  selectedReq.value = reqRow
  selectedOrder.value = reqRow._order || null

  const o = selectedOrder.value
  form.value = {
    status_receive: o?.status_receive ?? '',
    date_recieve: o?.date_recieve ?? todayDateString(),
    receive_by: receiveByFromLogin(),
    store_by: o?.store_by ?? '',
    lao_po_number: o?.lao_po_number ?? '',
    ap_number: o?.ap_number ?? '',
    pr_thai: o?.pr_thai ?? '',
    status_purchase: o?.status_purchase ?? '',
    is_finish: !!o?.is_finish,
  }

  isEditOpen.value = true
}

function openBulkEdit() {
  if (!auth.user?.id) return alert('ไม่พบข้อมูลผู้ใช้ กรุณาเข้าสู่ระบบใหม่')
  if (!selectedReqIds.value.length) return

  editMode.value = 'bulk'
  bulkTargetIds.value = selectedReqIds.value.slice()
  bulkIsFinish.value = ''
  selectedReq.value = null
  selectedOrder.value = null
  form.value = {
    status_receive: '',
    date_recieve: todayDateString(),
    receive_by: receiveByFromLogin(),
    store_by: '',
    lao_po_number: '',
    ap_number: '',
    pr_thai: '',
    status_purchase: '',
    is_finish: false,
  }
  isEditOpen.value = true
}

function closeEdit() {
  isEditOpen.value = false
  editMode.value = 'single'
  bulkTargetIds.value = []
  bulkIsFinish.value = ''
  selectedReq.value = null
  selectedOrder.value = null
}

function formatReqDate(value) {
  if (!value) return '-'
  const d = new Date(value)
  const day = String(d.getDate())
  const month = String(d.getMonth() + 1)
  const year = String(d.getFullYear())
  return `${day}/${month}/${year}`
}

async function removeReq(reqRow, skipConfirm = false) {
  const id = reqRow?.id
  if (!id) return

  if (!skipConfirm) {
    const ok = window.confirm('ต้องการลบรายการ PR นี้หรือไม่?')
    if (!ok) return
  }

  try {
    await supabase.from('purchasing_order').delete().eq('pr_id', id)
    const { error } = await supabase.from('purchasing_req').delete().eq('id', id)
    if (error) throw error
    await fetchPurchasingReq()
  } catch (err) {
    alert('ลบข้อมูลไม่สำเร็จ: ' + getErrorText(err))
  }
}

async function removeSelected() {
  if (!selectedReqIds.value.length) return
  const ok = window.confirm(`ต้องการลบ ${selectedReqIds.value.length} รายการหรือไม่?`)
  if (!ok) return

  saving.value = true
  try {
    const toDelete = selectedReqIds.value.slice()
    for (const id of toDelete) {
      await removeReq({ id }, true)
    }
    selectedReqIds.value = []
    expandedPrKey.value = null
  } finally {
    saving.value = false
  }
}

async function submitEdit() {
  if (editMode.value === 'bulk') {
    await submitBulkEdit()
    return
  }
  if (!auth.user?.id) return alert('ไม่พบข้อมูลผู้ใช้ กรุณาเข้าสู่ระบบใหม่')
  const reqId = selectedReq.value?.id
  if (!reqId) return

  saving.value = true
  try {
    const statusReceiveText = String(form.value.status_receive || '').trim()
    const hasMetaAlready = !!selectedOrder.value?.date_recieve || !!String(selectedOrder.value?.receive_by || '').trim()
    const prevStatusReceiveText = String(selectedOrder.value?.status_receive || '').trim()
    const isStatusReceiveChanged = statusReceiveText !== prevStatusReceiveText
    const shouldStampReceiveMeta =
      !hasMetaAlready &&
      isStatusReceiveChanged &&
      (!prevStatusReceiveText || prevStatusReceiveText === 'รอรับงาน') &&
      shouldStampReceiveMetaFromStatus(statusReceiveText)
    const dateRecieveValue = shouldStampReceiveMeta ? todayDateString() : selectedOrder.value?.date_recieve || null
    const receiveByValue = shouldStampReceiveMeta ? receiveByFromLogin() : selectedOrder.value?.receive_by || null

    const prevClosed = !!selectedOrder.value?.is_finish
    const nextClosed = !!form.value.is_finish
    const closingNow = nextClosed && !prevClosed
    const isAlreadyClosed = prevClosed && nextClosed

    const payload = {
      pr_id: reqId,
      status_receive: statusReceiveText || null,
      date_recieve: dateRecieveValue,
      receive_by: receiveByValue,
      store_by: form.value.store_by || null,
      lao_po_number: form.value.lao_po_number || null,
      ap_number: form.value.ap_number || null,
      pr_thai: form.value.pr_thai || null,
      status_purchase: form.value.status_purchase || null,
      is_finish: nextClosed,
      ...(shouldStampReceiveMeta ? { created_by: auth.user.id } : {}),
      ...(closingNow ? { updated_by: auth.user.id, updated_at: new Date().toISOString() } : {}),
      ...(isAlreadyClosed
        ? { updated_by: selectedOrder.value?.updated_by || null, updated_at: selectedOrder.value?.updated_at || null }
        : {}),
    }

    if (selectedOrder.value?.id) {
      const { error } = await supabase.from('purchasing_order').update(payload).eq('id', selectedOrder.value.id)
      if (error) throw error
    } else {
      const insertPayload = {
        ...payload,
        created_by: auth.user.id,
      }
      const { error } = await supabase.from('purchasing_order').insert(insertPayload)
      if (error) throw error
    }

    closeEdit()
    await fetchPurchasingReq()
    alert('บันทึกข้อมูลสำเร็จ')
  } catch (err) {
    alert('บันทึกข้อมูลไม่สำเร็จ: ' + getErrorText(err))
  } finally {
    saving.value = false
  }
}

async function submitBulkEdit() {
  if (!auth.user?.id) return alert('ไม่พบข้อมูลผู้ใช้ กรุณาเข้าสู่ระบบใหม่')
  const targetIds = (bulkTargetIds.value || []).length ? bulkTargetIds.value.slice() : selectedReqIds.value.slice()
  if (!targetIds.length) return

  const patch = {}
  const statusPurchase = String(form.value.status_purchase || '').trim()
  const statusReceive = String(form.value.status_receive || '').trim()
  const storeBy = String(form.value.store_by || '').trim()
  const laoPoNumber = String(form.value.lao_po_number || '').trim()
  const apNumber = String(form.value.ap_number || '').trim()
  const prThai = String(form.value.pr_thai || '').trim()

  if (statusPurchase) patch.status_purchase = statusPurchase
  if (statusReceive) patch.status_receive = statusReceive
  if (storeBy) patch.store_by = storeBy
  if (laoPoNumber) patch.lao_po_number = laoPoNumber
  if (apNumber) patch.ap_number = apNumber
  if (prThai) patch.pr_thai = prThai

  if (bulkIsFinish.value === 'true') patch.is_finish = true
  if (bulkIsFinish.value === 'false') patch.is_finish = false

  if (!Object.keys(patch).length) {
    alert('กรุณากรอกข้อมูลที่ต้องการแก้ไขอย่างน้อย 1 ช่อง')
    return
  }

  saving.value = true
  try {
    const receiveByValue = receiveByFromLogin()
    const dateRecieveValue = todayDateString()

    for (const reqId of targetIds) {
      const row = (rows.value || []).find((r) => r?.id === reqId)
      const orderId = row?._order?.id
      const hasMetaAlready = !!row?._order?.date_recieve || !!String(row?._order?.receive_by || '').trim()
      const prevStatusReceiveText = String(row?._order?.status_receive || '').trim()
      const nextStatusReceiveText = String(statusReceive || '').trim()
      const isStatusReceiveChanged = !!nextStatusReceiveText && nextStatusReceiveText !== prevStatusReceiveText
      const shouldStampReceiveMeta =
        !hasMetaAlready &&
        isStatusReceiveChanged &&
        (!prevStatusReceiveText || prevStatusReceiveText === 'รอรับงาน') &&
        shouldStampReceiveMetaFromStatus(nextStatusReceiveText)

      const prevClosed = !!row?._order?.is_finish
      const nextClosed =
        Object.prototype.hasOwnProperty.call(patch, 'is_finish') ? !!patch.is_finish : prevClosed
      const closingNow = nextClosed && !prevClosed
      const payload = {
        pr_id: reqId,
        ...patch,
        ...(shouldStampReceiveMeta ? { date_recieve: dateRecieveValue, receive_by: receiveByValue } : {}),
        ...(shouldStampReceiveMeta ? { created_by: auth.user.id } : {}),
        ...(closingNow ? { updated_by: auth.user.id, updated_at: new Date().toISOString() } : {}),
      }

      if (orderId) {
        const { error } = await supabase.from('purchasing_order').update(payload).eq('id', orderId)
        if (error) throw error
      } else {
        const insertPayload = {
          ...payload,
          created_by: auth.user.id,
        }
        const { error } = await supabase.from('purchasing_order').insert(insertPayload)
        if (error) throw error
      }
    }

    closeEdit()
    await fetchPurchasingReq()
    alert(`บันทึกข้อมูลสำเร็จ (${targetIds.length} รายการ)`)
  } catch (err) {
    alert('บันทึกข้อมูลไม่สำเร็จ: ' + getErrorText(err))
  } finally {
    saving.value = false
  }
}

</script>

<template>
  <div>
    <div class="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
      <div>
        <h1 class="text-[20px] font-semibold" style="color: var(--color-text-primary)">รายการ PR</h1>
        <p class="text-[13px] mt-0.5" style="color: var(--color-text-muted)">
          แสดงข้อมูลจากตาราง purchasing_req และแก้ไขจะบันทึกลงตาราง purchasing_order
        </p>
      </div>
    </div>

    <div class="flex flex-col md:flex-row gap-4 mb-6 p-4 rounded-xl border" style="background: var(--color-bg-card); border-color: var(--color-border)">
      <div class="flex-1 relative">
        <i class="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-[14px]" style="color: var(--color-text-muted)"></i>
        <input
          v-model="prFilter"
          @input="onFilterChanged"
          type="text"
          list="prNoOptions"
          placeholder="กรอง PR No."
          class="w-full pl-9 pr-4 py-2 bg-transparent border rounded-lg text-[13px] focus:outline-none focus:ring-1 transition-all"
          style="border-color: var(--color-border); color: var(--color-text-primary)"
        />
        <datalist id="prNoOptions">
          <option v-for="no in prNumberOptions" :key="no" :value="no"></option>
        </datalist>
      </div>
    </div>

    <div class="rounded-xl border overflow-hidden" style="background: var(--color-bg-card); border-color: var(--color-border)">
      <div class="flex flex-col md:flex-row md:items-center justify-between gap-3 px-4 py-3 border-b" style="border-color: var(--color-border)">
        <div class="text-[12px]" style="color: var(--color-text-muted)">
          แสดง {{ Math.min(pageSize, pagedGroups.length) }} รายการต่อหน้า • ทั้งหมด {{ totalRows }} รายการ
        </div>
        <div class="flex items-center gap-2">
          <button
            @click="goPrev"
            :disabled="page <= 1"
            class="px-3 py-1.5 rounded-lg text-[12px] font-medium border hover:bg-gray-50 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            style="border-color: var(--color-border); color: var(--color-text-secondary)"
          >
            ก่อนหน้า
          </button>
          <div class="text-[12px]" style="color: var(--color-text-muted)">หน้า {{ page }} / {{ totalPages }}</div>
          <button
            @click="goNext"
            :disabled="page >= totalPages"
            class="px-3 py-1.5 rounded-lg text-[12px] font-medium border hover:bg-gray-50 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            style="border-color: var(--color-border); color: var(--color-text-secondary)"
          >
            ถัดไป
          </button>
        </div>
      </div>

      <div class="overflow-x-auto">
        <table class="w-full text-[13px] min-w-[880px] border-collapse" style="border: 1px solid var(--color-border)">
          <thead>
            <tr style="background: var(--color-bg-body); border-bottom: 1px solid var(--color-border)">
              <th
                class="w-[56px] px-3 py-3 font-medium text-center whitespace-nowrap"
                style="color: var(--color-text-muted); border-right: 1px solid var(--color-border)"
              ></th>
              <th
                class="w-[180px] text-center px-4 py-3 font-medium whitespace-nowrap"
                style="color: var(--color-text-muted); border-right: 1px solid var(--color-border)"
              >
                PR
              </th>
              <th
                class="text-center px-4 py-3 font-medium whitespace-nowrap"
                style="color: var(--color-text-muted); border-right: 1px solid var(--color-border)"
              >
                รายละเอียด
              </th>
              <th class="text-center px-4 py-3 font-medium whitespace-nowrap" style="color: var(--color-text-muted)">วันที่</th>
            </tr>
          </thead>
          <tbody>
            <template v-for="group in pagedGroups" :key="group.key">
              <tr class="border-b last:border-b-0" style="border-color: var(--color-border)">
                <td class="px-3 py-3 text-center align-top" style="border-right: 1px solid var(--color-border)">
                  <button
                    type="button"
                    class="w-10 h-10 inline-flex items-center justify-center rounded-md border hover:bg-gray-50 transition-colors"
                    :class="expandedPrKey === group.key ? 'text-red-600 border-red-300' : 'text-gray-800 border-gray-300'"
                    style="background: var(--color-bg-body)"
                    title="แสดงรายการ"
                    @click="toggleExpanded(group)"
                  >
                    <i class="fa-solid" :class="expandedPrKey === group.key ? 'fa-minus text-[22px]' : 'fa-plus text-[22px]'"></i>
                  </button>
                </td>

                <td class="w-[180px] px-4 py-3 align-middle text-center whitespace-nowrap" style="border-right: 1px solid var(--color-border)">
                  <div class="font-medium truncate w-full" :title="group.pr_number || '-'" style="color: #ef4444">
                    {{ group.pr_number || '-' }}
                  </div>
                </td>

                <td class="px-4 py-3 align-top" style="border-right: 1px solid var(--color-border)">
                  <div
                    class="p-0 text-[12px] leading-5"
                    style="color: var(--color-text-primary)"
                  >
                    {{ group.detailsText || '-' }}
                  </div>
                </td>

                <td class="px-4 py-3 align-middle text-center whitespace-nowrap" style="border-right: 1px solid var(--color-border); color: #2563eb">
                  {{ formatReqDate(group.newestCreatedAt) }}
                </td>
              </tr>

              <tr v-if="expandedPrKey === group.key" class="border-b" style="border-color: var(--color-border)">
                <td colspan="4" class="px-0 py-0">
                  <div class="overflow-x-auto">
                    <div
                      class="px-4 py-2 text-[12px] font-medium flex items-center justify-between gap-3"
                      style="background: var(--color-bg-body); color: var(--color-text-muted); border-top: 1px solid var(--color-border); border-bottom: 1px solid var(--color-border)"
                    >
                      <div class="flex items-center gap-2">
                        <button
                          type="button"
                          class="w-8 h-8 inline-flex items-center justify-center rounded-md border hover:bg-gray-50 transition-colors disabled:opacity-50"
                          style="border-color: rgba(0,0,0,0.15); color: var(--color-text-secondary)"
                          title="แก้ไขที่เลือก"
                          :disabled="selectedCount === 0"
                          @click="editSelected"
                        >
                          <i class="fa-solid fa-pen-to-square"></i>
                        </button>
                        <button
                          type="button"
                          class="w-8 h-8 inline-flex items-center justify-center rounded-md border hover:bg-red-50 transition-colors text-red-600 disabled:opacity-50"
                          style="border-color: rgba(0,0,0,0.15)"
                          title="ลบ"
                          :disabled="selectedCount === 0 || saving"
                          @click="removeSelected"
                        >
                          <i class="fa-solid fa-trash-can"></i>
                        </button>
                        <span>รายการใน PR No. {{ group.pr_number || '-' }}</span>
                      </div>
                      <div>เลือกแล้ว {{ selectedCount }} รายการ</div>
                    </div>
                    <table class="w-full text-[12px] min-w-[1200px] border-collapse" style="border: 1px solid var(--color-border)">
                      <thead>
                        <tr style="background: var(--color-bg-body); border-bottom: 1px solid var(--color-border)">
                          <th
                            class="w-[64px] text-center px-3 py-2 font-medium whitespace-nowrap"
                            style="color: var(--color-text-muted); border-right: 1px solid var(--color-border)"
                          >
                            <div class="flex items-center justify-center">
                              <input
                                type="checkbox"
                                :checked="groupAllSelected(group)"
                                :indeterminate="groupSomeSelected(group)"
                                @change="toggleSelectAllInGroup(group)"
                              />
                            </div>
                          </th>
                          <th
                            class="text-left px-4 py-2 font-medium whitespace-nowrap"
                            style="color: var(--color-text-muted); border-right: 1px solid var(--color-border)"
                          >
                            รายการสินค้า
                          </th>
                          <th
                            class="text-left px-4 py-2 font-medium whitespace-nowrap"
                            style="color: var(--color-text-muted); border-right: 1px solid var(--color-border)"
                          >
                            จำนวน/หน่วย
                          </th>
                          <th
                            class="text-left px-4 py-2 font-medium whitespace-nowrap"
                            style="color: var(--color-text-muted); border-right: 1px solid var(--color-border)"
                          >
                            ผู้ขอ PR
                          </th>
                          <th
                            class="text-left px-4 py-2 font-medium whitespace-nowrap"
                            style="color: var(--color-text-muted); border-right: 1px solid var(--color-border)"
                          >
                            ด่วน
                          </th>
                          <th
                            class="text-left px-4 py-2 font-medium whitespace-nowrap"
                            style="color: var(--color-text-muted); border-right: 1px solid var(--color-border)"
                          >
                            ทีมจัดซื้อ
                          </th>
                          <th
                            class="text-left px-4 py-2 font-medium whitespace-nowrap"
                            style="color: var(--color-text-muted); border-right: 1px solid var(--color-border)"
                          >
                            AIR
                          </th>
                          <th class="text-left px-4 py-2 font-medium whitespace-nowrap" style="color: var(--color-text-muted)">วันที่ขอ</th>
                        </tr>
                      </thead>
                      <tbody>
                        <template v-for="item in group.items" :key="item.id">
                        <tr style="border-bottom: 1px solid var(--color-border)">
                          <td
                            class="px-3 py-2 text-center cursor-pointer select-none"
                            style="border-right: 1px solid var(--color-border)"
                            @click="toggleSelected(item.id)"
                          >
                            <div class="flex items-center justify-center">
                              <input
                                type="checkbox"
                                :checked="isSelected(item.id)"
                                @click.stop
                                @change="toggleSelected(item.id)"
                              />
                            </div>
                          </td>
                          <td
                            class="px-4 py-2"
                            style="color: var(--color-text-primary); white-space: pre-line; border-right: 1px solid var(--color-border)"
                          >
                            {{ item.details || '-' }}
                          </td>
                          <td
                            class="px-4 py-2 whitespace-nowrap"
                            style="color: var(--color-text-primary); border-right: 1px solid var(--color-border)"
                          >
                            {{ item.amount_req ?? '-' }} {{ item.unit || '' }}
                          </td>
                          <td
                            class="px-4 py-2"
                            style="color: var(--color-text-primary); white-space: pre-line; border-right: 1px solid var(--color-border)"
                          >
                            {{ creatorText(item) }}
                          </td>
                          <td
                            class="px-4 py-2 whitespace-nowrap"
                            style="color: var(--color-text-primary); border-right: 1px solid var(--color-border)"
                          >
                            {{ item._urgent_name || item.urgent_id || '-' }}
                          </td>
                          <td
                            class="px-4 py-2 whitespace-nowrap"
                            style="color: var(--color-text-primary); border-right: 1px solid var(--color-border)"
                          >
                            {{ item._purchase_team_name || item.purchase_team_id || '-' }}
                          </td>
                          <td
                            class="px-4 py-2 whitespace-nowrap"
                            style="color: var(--color-text-primary); border-right: 1px solid var(--color-border)"
                          >
                            {{ item.air_code || '-' }}
                          </td>
                          <td class="px-4 py-2 whitespace-nowrap" style="color: #2563eb">
                            <div class="flex items-center justify-between gap-2">
                              <span>{{ formatReqDateTime(item.created_at) }}</span>
                              <button
                                type="button"
                                class="w-7 h-7 inline-flex items-center justify-center rounded-md border hover:bg-gray-50 transition-colors"
                                style="border-color: var(--color-border); color: var(--color-text-secondary)"
                                :title="isOrderExpanded(item.id) ? 'ซ่อนรายละเอียด' : 'ดูรายละเอียด'"
                                @click="toggleOrderExpanded(item.id)"
                              >
                                <i class="fa-solid fa-chevron-down" :class="isOrderExpanded(item.id) ? 'rotate-180' : ''"></i>
                              </button>
                            </div>
                          </td>
                        </tr>
                        <tr v-if="isOrderExpanded(item.id)" style="border-bottom: 1px solid var(--color-border)">
                          <td colspan="8" class="px-4 py-3" style="background: var(--color-bg-card)">
                            <div class="text-[12px] font-medium mb-2" style="color: var(--color-text-muted)">
                              รายละเอียดการสั่งซื้อ (purchasing_order)
                            </div>
                            <div
                              class="rounded-lg border p-3 overflow-x-auto"
                              style="border-color: var(--color-border); background: var(--color-bg-card)"
                            >
                              <table class="w-full text-[12px] min-w-[980px] border-collapse" style="border: 1px solid var(--color-border)">
                                <thead>
                                  <tr style="background: #FDBA74; border-bottom: 1px solid var(--color-border)">
                                    <th class="px-3 py-2 text-left font-medium whitespace-nowrap" style="color: var(--color-text-muted); border-right: 1px solid var(--color-border)">สถานะรับของ</th>
                                    <th class="px-3 py-2 text-left font-medium whitespace-nowrap" style="color: var(--color-text-muted); border-right: 1px solid var(--color-border)">วันที่รับของ</th>
                                    <th class="px-3 py-2 text-left font-medium whitespace-nowrap" style="color: var(--color-text-muted); border-right: 1px solid var(--color-border)">ผู้รับของ</th>
                                    <th class="px-3 py-2 text-left font-medium whitespace-nowrap" style="color: var(--color-text-muted); border-right: 1px solid var(--color-border)">ร้านค้า</th>
                                    <th class="px-3 py-2 text-left font-medium whitespace-nowrap" style="color: var(--color-text-muted); border-right: 1px solid var(--color-border)">เลข PO (ลาว)</th>
                                    <th class="px-3 py-2 text-left font-medium whitespace-nowrap" style="color: var(--color-text-muted); border-right: 1px solid var(--color-border)">เลข AP</th>
                                    <th class="px-3 py-2 text-left font-medium whitespace-nowrap" style="color: var(--color-text-muted); border-right: 1px solid var(--color-border)">PR (ไทย)</th>
                                    <th class="px-3 py-2 text-left font-medium whitespace-nowrap" style="color: var(--color-text-muted); border-right: 1px solid var(--color-border)">สถานะการซื้อ</th>

                                    <th class="px-3 py-2 text-left font-medium whitespace-nowrap" style="color: var(--color-text-muted); border-right: 1px solid var(--color-border)">ปิดงาน</th>
                                    <th class="px-3 py-2 text-left font-medium whitespace-nowrap" style="color: var(--color-text-muted)">อัปเดตเมื่อ</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  <tr v-if="!item._order">
                                    <td colspan="10" class="px-3 py-3 text-center" style="color: var(--color-text-muted)">ยังไม่มีข้อมูลใน purchasing_order</td>
                                  </tr>
                                  <tr v-else>
                                    <td class="px-3 py-2" style="color: var(--color-text-primary); border-right: 1px solid var(--color-border)">{{ item._order.status_receive || '-' }}</td>
                                    <td class="px-3 py-2" style="color: var(--color-text-primary); border-right: 1px solid var(--color-border)">{{ formatReqDate(item._order.date_recieve) }}</td>
                                    <td class="px-3 py-2" style="color: var(--color-text-primary); border-right: 1px solid var(--color-border)">{{ item._order.receive_by || '-' }}</td>
                                    <td class="px-3 py-2" style="color: var(--color-text-primary); border-right: 1px solid var(--color-border)">{{ item._order.store_by || '-' }}</td>
                                    <td class="px-3 py-2" style="color: var(--color-text-primary); border-right: 1px solid var(--color-border)">{{ item._order.lao_po_number || '-' }}</td>
                                    <td class="px-3 py-2" style="color: var(--color-text-primary); border-right: 1px solid var(--color-border)">{{ item._order.ap_number || '-' }}</td>
                                    <td class="px-3 py-2" style="color: var(--color-text-primary); border-right: 1px solid var(--color-border)">{{ item._order.pr_thai || '-' }}</td>
                                    <td class="px-3 py-2" style="color: var(--color-text-primary); border-right: 1px solid var(--color-border)">{{ item._order.status_purchase || '-' }}</td>
                                    <td class="px-3 py-2" style="color: var(--color-text-primary); border-right: 1px solid var(--color-border)">{{ item._order.is_finish ? 'ปิดงาน' : '-' }}</td>
                                    <td class="px-3 py-2" style="color: var(--color-text-muted)">{{ formatDateTime(item._order.updated_at) }}</td>
                                  </tr>
                                </tbody>
                              </table>
                            </div>
                          </td>
                        </tr>
                        </template>
                      </tbody>
                    </table>
                  </div>
                </td>
              </tr>
            </template>
            <tr v-if="loading">
              <td colspan="4" class="px-4 py-8 text-center" style="color: var(--color-text-muted)">กำลังโหลดข้อมูล...</td>
            </tr>
            <tr v-else-if="!loading && totalRows === 0">
              <td colspan="4" class="px-4 py-8 text-center" style="color: var(--color-text-muted)">
                <div>ไม่พบข้อมูล</div>
                <div class="text-[12px] mt-1" style="color: var(--color-text-muted)">
                  ถ้ามีข้อมูลใน Supabase แล้วแต่ไม่ขึ้น ให้ตรวจสอบ RLS/Policy ของตาราง purchasing_req (SELECT)
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <Transition name="slide-right">
      <div v-if="isEditOpen" class="fixed inset-0 z-50 flex justify-end">
        <div class="absolute inset-0 bg-black/30 backdrop-blur-sm" @click="closeEdit"></div>
        <div class="relative w-full max-w-md h-full shadow-2xl flex flex-col" style="background: var(--color-bg-card)">
          <div class="px-6 py-4 border-b flex items-center justify-between" style="border-color: var(--color-border)">
            <div class="min-w-0">
              <h2 class="text-[16px] font-semibold truncate" style="color: var(--color-text-primary)">
                {{ editMode === 'bulk' ? 'แก้ไขหลายรายการ' : 'แก้ไข PR' }}
              </h2>
              <div class="text-[12px] mt-0.5 truncate" style="color: var(--color-text-muted)">
                <span v-if="editMode === 'bulk'">{{ bulkTargetIds.length }} รายการ</span>
                <span v-else>{{ selectedReq?.pr_number || '-' }}</span>
              </div>
            </div>
            <button @click="closeEdit" class="p-2 hover:bg-gray-100 rounded-lg transition-colors">
              <i class="fa-solid fa-xmark" style="color: var(--color-text-muted)"></i>
            </button>
          </div>

          <div v-if="editMode === 'single'" class="px-6 py-4 border-b" style="border-color: var(--color-border)">
            <div class="text-[12px] grid grid-cols-2 gap-2" style="color: var(--color-text-muted)">
              <div>จำนวน: <span style="color: var(--color-text-primary)">{{ selectedReq?.amount_req ?? '-' }}</span></div>
              <div>หน่วย: <span style="color: var(--color-text-primary)">{{ selectedReq?.unit || '-' }}</span></div>
              <div class="col-span-2">รายละเอียด: <span style="color: var(--color-text-primary)">{{ selectedReq?.details || '-' }}</span></div>
            </div>
          </div>

          <form class="flex-1 overflow-y-auto p-6 space-y-4" @submit.prevent="submitEdit">
            <div class="space-y-3">
              <div class="space-y-1">
                <label class="text-[13px] font-medium" style="color: var(--color-text-primary)">สถานะก่อนรับงาน</label>
                <select
                  v-model="form.status_receive"
                  class="w-full px-3 py-2 border rounded-lg text-[13px] focus:outline-none focus:ring-1"
                  style="border-color: var(--color-border); background: var(--color-bg-body); color: var(--color-text-primary)"
                >
                  <option value="" style="background-color: var(--color-bg-card)">
                    {{ editMode === 'bulk' ? 'ไม่เปลี่ยน' : '— เลือกสถานะ —' }}
                  </option>
                  <template v-if="preJobStatusOptions.length">
                    <option v-for="s in preJobStatusOptions" :key="s" :value="s" style="background-color: var(--color-bg-card)">
                      {{ s }}
                    </option>
                  </template>
                  <template v-else>
                    <option value="รอรับงาน" style="background-color: var(--color-bg-card)">รอรับงาน</option>
                    <option value="รับงานแล้ว" style="background-color: var(--color-bg-card)">รับงานแล้ว</option>
                  </template>
                </select>
              </div>

              <div class="space-y-1">
                <label class="text-[13px] font-medium" style="color: var(--color-text-primary)">PO LAO</label>
                <input
                  v-model="form.lao_po_number"
                  type="text"
                  placeholder="เลข PO"
                  class="w-full px-3 py-2 border rounded-lg text-[13px] focus:outline-none focus:ring-1"
                  style="border-color: var(--color-border); background: var(--color-bg-body); color: var(--color-text-primary)"
                />
              </div>

              <div class="space-y-1">
                <label class="text-[13px] font-medium" style="color: var(--color-text-primary)">ร้านซื้อ</label>
                <input
                  v-model="form.store_by"
                  type="text"
                  list="storeNameOptions"
                  placeholder="พิมพ์ชื่อร้าน หรือเลือกจากรายการ..."
                  class="w-full px-3 py-2 border rounded-lg text-[13px] focus:outline-none focus:ring-1"
                  style="border-color: var(--color-border); background: var(--color-bg-body); color: var(--color-text-primary)"
                />
                <datalist id="storeNameOptions">
                  <option v-for="name in storeNameOptions" :key="name" :value="name"></option>
                </datalist>
              </div>

              <div class="space-y-1">
                <label class="text-[13px] font-medium" style="color: var(--color-text-primary)">เลข AP</label>
                <input
                  v-model="form.ap_number"
                  type="text"
                  placeholder="เลข AP"
                  class="w-full px-3 py-2 border rounded-lg text-[13px] focus:outline-none focus:ring-1"
                  style="border-color: var(--color-border); background: var(--color-bg-body); color: var(--color-text-primary)"
                />
              </div>

              <div class="space-y-1">
                <label class="text-[13px] font-medium" style="color: var(--color-text-primary)">PR THAI</label>
                <input
                  v-model="form.pr_thai"
                  type="text"
                  placeholder="เลข PR Thai"
                  class="w-full px-3 py-2 border rounded-lg text-[13px] focus:outline-none focus:ring-1"
                  style="border-color: var(--color-border); background: var(--color-bg-body); color: var(--color-text-primary)"
                />
              </div>

              <div class="space-y-1">
                <label class="text-[13px] font-medium" style="color: var(--color-text-primary)">สถานะการสั่งซื้อ</label>
                <select
                  v-model="form.status_purchase"
                  class="w-full px-3 py-2 border rounded-lg text-[13px] focus:outline-none focus:ring-1"
                  style="border-color: var(--color-border); background: var(--color-bg-body); color: var(--color-text-primary)"
                >
                  <option value="" style="background-color: var(--color-bg-card)">
                    {{ editMode === 'bulk' ? 'ไม่เปลี่ยน' : '— เลือกสถานะการสั่งซื้อ —' }}
                  </option>
                  <option v-for="s in purchaseStatusOptions" :key="s" :value="s" style="background-color: var(--color-bg-card)">
                    {{ s }}
                  </option>
                </select>
              </div>

              <div class="flex items-center gap-2 pt-2">
                <template v-if="editMode === 'bulk'">
                  <label class="text-[13px] font-medium mr-2" style="color: var(--color-text-primary)">ปิดงาน (is_finish)</label>
                  <select
                    v-model="bulkIsFinish"
                    class="flex-1 px-3 py-2 border rounded-lg text-[13px] focus:outline-none focus:ring-1"
                    style="border-color: var(--color-border); background: var(--color-bg-body); color: var(--color-text-primary)"
                  >
                    <option value="" style="background-color: var(--color-bg-card)">ไม่เปลี่ยน</option>
                    <option value="true" style="background-color: var(--color-bg-card)">ปิดงาน</option>
                    <option value="false" style="background-color: var(--color-bg-card)">ไม่ปิดงาน</option>
                  </select>
                </template>
                <template v-else>
                  <input id="is_finish" v-model="form.is_finish" type="checkbox" class="h-4 w-4" />
                  <label for="is_finish" class="text-[13px]" style="color: var(--color-text-primary)">ปิดงานแล้ว (is_finish)</label>
                </template>
              </div>
            </div>
          </form>

          <div class="p-6 border-t flex gap-3" style="border-color: var(--color-border)">
            <button
              type="button"
              @click="closeEdit"
              class="flex-1 py-2 rounded-lg text-[14px] font-medium border hover:bg-gray-50 transition-all"
              style="border-color: var(--color-border); color: var(--color-text-secondary)"
            >
              ยกเลิก
            </button>
            <button
              type="button"
              @click="submitEdit"
              :disabled="saving"
              class="flex-1 py-2 rounded-lg text-[14px] font-medium border hover:bg-gray-50 transition-all disabled:opacity-50"
              style="border-color: var(--color-border); color: var(--color-text-primary)"
            >
              {{ saving ? 'กำลังบันทึก...' : 'บันทึก' }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.slide-right-enter-active,
.slide-right-leave-active {
  transition: all 0.3s ease;
}

.slide-right-enter-from,
.slide-right-leave-to {
  transform: translateX(100%);
  opacity: 0;
}

input:focus {
  border-color: var(--color-primary) !important;
  box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.1);
}
</style>
