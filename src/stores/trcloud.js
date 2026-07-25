import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { trcloudProxyExtraHeaders, trcloudProxyUrl } from '@/utils/trcloudSession'
import { loadDocs, upsertDocs, countDocs, getSyncState, setSyncState } from '@/lib/trcloudWarehouse'

export const useTrcloudStore = defineStore('trcloud', () => {
  const prRows = ref([])
  const poRows = ref([])
  const apRows = ref([])
  const pvRows = ref([])
  const expenseRows = ref([])
  const activeRequests = new Map()
  const typeLastFetchedAt = ref({
    pr: null,
    po: null,
    ap: null,
    pv: null,
    expense: null
  })
  const typeLastRange = ref({
    pr: '',
    po: '',
    ap: '',
    pv: '',
    expense: ''
  })

  const apItemListKeys = [
    'items', 'rows', 'detail', 'item', 'products', 'product_list', 'rows_list', 'details', 'line_items', 'order_items'
  ]

  const findApItemList = (invoice) => {
    for (const key of apItemListKeys) {
      const value = invoice?.[key]
      if (Array.isArray(value) && value.length && value.every((x) => x && typeof x === 'object' && !Array.isArray(x))) {
        return [key, value]
      }
      if (typeof value === 'string') {
        try {
          const parsed = JSON.parse(value)
          if (Array.isArray(parsed) && parsed.length && parsed.every((x) => x && typeof x === 'object' && !Array.isArray(x))) {
            return [key, parsed]
          }
        } catch {
          // ignore parse failures
        }
      }
    }
    return [null, null]
  }

  const cleanApText = (raw) => {
    if (raw == null) return ''
    let text = String(raw)
    text = text.replace(/<br\s*\/?>/gi, '\n')
    text = text.replace(/<[^>]+>/g, '')
    text = text.replace(/\s+/g, ' ')
    return text.trim()
  }

  const buildApItemRow = (invoice, item) => {
    const invoiceNumber = invoice?.expense_number || invoice?.invoice_number || invoice?.doc_number || invoice?.reference || invoice?.id || ''
    const companyFormat = invoice?.company_format || ''
    const docNumber = companyFormat ? `${companyFormat}${invoiceNumber}` : String(invoiceNumber || '')
    const itemName = item?.product_name || item?.name || item?.title || item?.description || item?.item_name || item?.item || item?.product || item?.description_th || item?.description_en || ''
    const status = invoice?.payment_status || invoice?.status || invoice?.status_payment || invoice?.status_text || invoice?.invoice_status || ''

    return {
      unique_id: item?.item_id || item?.ap_item_id || item?.po_item_id || `${docNumber}_${itemName}_${item?.quantity}_${item?.price}_${Math.random().toString(36).substr(2, 9)}`,
      doc_number: docNumber,
      invoice_number: invoiceNumber,
      issue_date: invoice?.issue_date || invoice?.date || invoice?.issueDate || '',
      due_date: invoice?.due_date || invoice?.dueDate || '',
      organization: invoice?.organization || invoice?.name || invoice?.supplier || '',
      contact_type: invoice?.contact_type || '',
      status,
      item_name: cleanApText(itemName),
      quantity: item?.quantity || item?.qty || item?.amount || item?.qty_unit || '',
      unit: item?.unit || item?.unit_name || item?.uom || '',
      price: item?.price || item?.unit_price || item?.cost || item?.sale_price || '',
      item_total: item?.total || item?.line_total || item?.amount || item?.item_total || '',
      category: item?.category || invoice?.category || '',
      staff: invoice?.staff || invoice?.created_by || '',
      department: invoice?.department || invoice?.department_name || '',
      project: invoice?.project || invoice?.project_name || invoice?.department || invoice?.department_name || '',
      currency: String(invoice?.fx || invoice?.currency || invoice?.currency_name || invoice?.currency_code || invoice?.fx_code || 'LAK').toUpperCase(),
      ref_po: invoice?.po || invoice?.reference || invoice?.po_number || '',
      pr: invoice?.pr || invoice?.pr_number || invoice?.pr_no || invoice?.reference || '',
      expense: invoice?.expense || invoice?.expense_no || invoice?.expense_number || invoice?.expense_doc || invoice?.expense_id || '',
      payment: invoice?.payment || invoice?.payment_amount || 0
    }
  }

  const extractApItemRows = (apData) => {
    if (!Array.isArray(apData) || !apData.length) return []
    const rows = []
    for (const invoice of apData) {
      const [itemKey, itemList] = findApItemList(invoice)
      if (itemList) {
        const baseInvoice = { ...invoice }
        delete baseInvoice[itemKey]
        for (const item of itemList) {
          rows.push(buildApItemRow(baseInvoice, item))
        }
      } else {
        const itemName = invoice?.description || invoice?.remark || invoice?.note || invoice?.title || invoice?.item_name || invoice?.product_name || invoice?.description_th || ''
        const invoiceNumber = invoice?.invoice_number || invoice?.doc_number || invoice?.reference || invoice?.id || ''
        const companyFormat = invoice?.company_format || ''
        const docNumber = companyFormat ? `${companyFormat}${invoiceNumber}` : String(invoiceNumber || '')
        rows.push({
          unique_id: invoice?.item_id || invoice?.ap_item_id || `${docNumber}_${invoice?.issue_date}_${invoice?.total || invoice?.grand_total}`,
          doc_number: docNumber,
          invoice_number: invoiceNumber,
          issue_date: invoice?.issue_date || invoice?.date || invoice?.issueDate || '',
          due_date: invoice?.due_date || invoice?.dueDate || '',
          organization: invoice?.organization || invoice?.name || invoice?.supplier || '',
          contact_type: invoice?.contact_type || '',
          status: invoice?.payment_status || invoice?.status || invoice?.status_payment || invoice?.status_text || invoice?.invoice_status || '',
          item_name: cleanApText(itemName),
          quantity: invoice?.quantity || invoice?.qty || '',
          unit: invoice?.unit || invoice?.unit_name || invoice?.uom || '',
          price: invoice?.price || invoice?.unit_price || invoice?.cost || invoice?.sale_price || '',
          item_total: invoice?.total || invoice?.before_vat || invoice?.item_total || '',
          category: invoice?.category || '',
          staff: invoice?.staff || invoice?.created_by || '',
          department: invoice?.department || invoice?.department_name || '',
          project: invoice?.project || invoice?.project_name || invoice?.department || invoice?.department_name || '',
          currency: String(invoice?.fx || invoice?.currency || invoice?.currency_name || invoice?.currency_code || invoice?.fx_code || 'LAK').toUpperCase(),
          ref_po: invoice?.po || invoice?.reference || invoice?.po_number || '',
          pr: invoice?.pr || invoice?.pr_number || invoice?.pr_no || invoice?.reference || '',
          expense: invoice?.expense || invoice?.expense_no || invoice?.expense_number || invoice?.expense_doc || invoice?.expense_id || '',
          payment: invoice?.payment || invoice?.payment_amount || 0
        })
      }
    }
    return rows
  }

  const extractPoItemRows = (poData) => {
    if (!Array.isArray(poData) || !poData.length) return []
    const rows = []
    for (const po of poData) {
      // Reuse the same item-list detection as AP
      const [itemKey, itemList] = findApItemList(po)
      if (itemList) {
        const basePo = { ...po }
        delete basePo[itemKey]
        for (const item of itemList) {
          rows.push(buildApItemRow(basePo, item))
        }
      } else {
        const itemName = po?.description || po?.remark || po?.note || po?.title || ''
        const poNumber = po?.po_number || po?.document_number || po?.reference || po?.id || ''
        const companyFormat = po?.company_format || ''
        const docNumber = companyFormat ? `${companyFormat}${poNumber}` : String(poNumber || '')
        rows.push({
          unique_id: po?.item_id || po?.po_item_id || `${docNumber}_${po?.issue_date}_${po?.total || po?.grand_total}`,
          doc_number: docNumber,
          invoice_number: poNumber,
          issue_date: po?.issue_date || po?.date || po?.issueDate || '',
          due_date: po?.due_date || po?.dueDate || '',
          organization: po?.organization || po?.name || po?.supplier || '',
          contact_type: po?.contact_type || '',
          status: po?.status || '',
          item_name: cleanApText(itemName),
          quantity: po?.quantity || po?.qty || '',
          unit: po?.unit || po?.unit_name || po?.uom || '',
          price: po?.price || po?.unit_price || po?.cost || po?.sale_price || '',
          item_total: po?.total || po?.before_vat || po?.item_total || '',
          category: po?.category || '',
          staff: po?.staff || po?.created_by || '',
          department: po?.department || po?.department_name || '',
          project: po?.project || po?.project_name || po?.department || po?.department_name || '',
          currency: String(po?.fx || po?.currency || po?.currency_name || po?.currency_code || po?.fx_code || 'LAK').toUpperCase(),
          ref_po: po?.po || po?.reference || po?.po_number || '',
          pr: po?.pr || po?.pr_number || po?.pr_no || po?.reference || '',
          expense: po?.expense || po?.expense_no || po?.expense_number || po?.expense_doc || po?.expense_id || '',
          payment: po?.payment || po?.payment_amount || 0
        })
      }
    }
    return rows
  }

  const extractPrItemRows = (prData) => {
    if (!Array.isArray(prData) || !prData.length) return []
    const rows = []
    for (const pr of prData) {
      const [itemKey, itemList] = findApItemList(pr)
      if (itemList) {
        const basePr = { ...pr }
        delete basePr[itemKey]
        for (const item of itemList) {
          rows.push(buildApItemRow(basePr, item))
        }
      } else {
        const itemName = pr?.description || pr?.remark || pr?.note || pr?.title || ''
        const prNumber = pr?.pr_number || pr?.document_number || pr?.reference || pr?.id || ''
        const companyFormat = pr?.company_format || ''
        const docNumber = companyFormat ? `${companyFormat}${prNumber}` : String(prNumber || '')
        rows.push({
          unique_id: pr?.item_id || pr?.pr_id || `${docNumber}_${pr?.issue_date}_${pr?.total || pr?.grand_total}`,
          doc_number: docNumber,
          invoice_number: prNumber,
          issue_date: pr?.issue_date || pr?.date || pr?.issueDate || '',
          due_date: pr?.due_date || pr?.dueDate || '',
          organization: pr?.organization || pr?.name || pr?.supplier || '',
          contact_type: pr?.contact_type || '',
          status: pr?.status || '',
          item_name: cleanApText(itemName),
          quantity: pr?.quantity || pr?.qty || '',
          unit: pr?.unit || pr?.unit_name || pr?.uom || '',
          price: pr?.price || pr?.unit_price || pr?.cost || pr?.sale_price || '',
          item_total: pr?.total || pr?.before_vat || pr?.item_total || '',
          category: pr?.category || '',
          staff: pr?.staff || pr?.created_by || '',
          department: pr?.department || pr?.department_name || '',
          project: pr?.project || pr?.project_name || pr?.department || pr?.department_name || '',
          currency: String(pr?.fx || pr?.currency || pr?.currency_name || pr?.currency_code || pr?.fx_code || 'LAK').toUpperCase(),
          ref_po: pr?.po || pr?.reference || pr?.po_number || '',
          pr: pr?.pr || pr?.pr_number || pr?.pr_no || pr?.reference || '',
          expense: pr?.expense || pr?.expense_no || pr?.expense_number || pr?.expense_doc || pr?.expense_id || '',
          payment: pr?.payment || pr?.payment_amount || 0
        })
      }
    }
    return rows
  }

  const apItemRows = computed(() => extractApItemRows(apRows.value))
  const poItemRows = computed(() => extractPoItemRows(poRows.value))
  const prItemRows = computed(() => extractPrItemRows(prRows.value))

  const buildExpenseItemRow = (exp, item) => {
    const expNumber = exp?.expense_number || exp?.invoice_number || exp?.doc_number || exp?.reference || exp?.id || ''
    const companyFormat = exp?.company_format || ''
    const docNumber = companyFormat ? `${companyFormat}${expNumber}` : String(expNumber || '')
    const itemName = item?.description || item?.acc_th || item?.acc_en || item?.name || item?.title || item?.item_name || ''
    const status = exp?.status || exp?.payment_status || exp?.status_payment || ''
    const quantity = item?.quantity || item?.qty || 1
    const price = item?.total || item?.price || 0
    const itemTotal = exp?.grand_total || exp?.total || item?.total || 0

    return {
      unique_id: item?.x_id || item?.item_id || `${docNumber}_${itemName}_${itemTotal}_${Math.random().toString(36).substr(2, 9)}`,
      doc_number: docNumber,
      invoice_number: expNumber,
      issue_date: exp?.issue_date || exp?.date || '',
      due_date: exp?.due_date || '',
      organization: exp?.organization || exp?.name || '',
      status,
      item_name: cleanApText(itemName),
      quantity: quantity,
      unit: item?.unit || 'รายการ',
      price: price,
      item_total: itemTotal,
      acc_code: item?.acc_code || '',
      acc_th: item?.acc_th || '',
      acc_en: item?.acc_en || '',
      invoice_note: exp?.invoice_note || exp?.remark || exp?.note || '',
      staff: exp?.staff || exp?.created_by || '',
      department: exp?.department || '',
      project: exp?.project || '',
      source: exp?.source || '',
      ref_po: exp?.reference || exp?.po || '',
      payment: exp?.payment || 0
    }
  }

  const extractExpenseItemRows = (expenseData, poItems = []) => {
    if (!Array.isArray(expenseData) || !expenseData.length) return []
    const rows = []
    for (const exp of expenseData) {
      const [itemKey, itemList] = findApItemList(exp)
      if (itemList) {
        const baseExp = { ...exp }
        delete baseExp[itemKey]
        for (const item of itemList) {
          rows.push(buildExpenseItemRow(baseExp, item))
        }
      } else {
        const itemName = exp?.description || exp?.remark || exp?.note || exp?.title || exp?.item_name || ''
        const expNumber = exp?.expense_number || exp?.invoice_number || exp?.doc_number || exp?.reference || exp?.id || ''
        const companyFormat = exp?.company_format || ''
        const docNumber = companyFormat ? `${companyFormat}${expNumber}` : String(expNumber || '')
        const price = exp?.total || exp?.price || 0
        const itemTotal = exp?.grand_total || exp?.total || 0
        const quantity = exp?.quantity || exp?.qty || 1
        const refPo = exp?.reference || exp?.po || exp?.po_number || ''

        // Fallback to PO items if this EXP has a Ref PO but no items of its own
        const matchedPoItems = refPo && Array.isArray(poItems) 
          ? poItems.filter(p => p.doc_number === refPo || p.invoice_number === refPo) 
          : []

        if (matchedPoItems.length > 0) {
          for (const poItem of matchedPoItems) {
            rows.push({
              ...poItem,
              unique_id: `exp_link_${exp.id || exp.expense_id}_${poItem.unique_id}`,
              doc_number: docNumber,
              invoice_number: expNumber,
              issue_date: exp?.issue_date || exp?.date || poItem.issue_date,
              organization: exp?.organization || exp?.name || poItem.organization,
              status: exp?.status || exp?.payment_status || poItem.status,
               payment: exp?.payment || 0,
               invoice_note: exp?.invoice_note || exp?.remark || exp?.note || '',
               ref_po: refPo
             })
           }
         } else {
           rows.push({
             unique_id: exp?.expense_id || exp?.id || `${docNumber}_${exp?.issue_date}_${itemTotal}`,
             doc_number: docNumber,
             invoice_number: expNumber,
             issue_date: exp?.issue_date || exp?.date || '',
             due_date: exp?.due_date || '',
             organization: exp?.organization || exp?.name || '',
             status: exp?.status || exp?.payment_status || '',
             item_name: cleanApText(itemName),
             quantity: quantity,
             unit: exp?.unit || 'รายการ',
             price: price,
             item_total: itemTotal,
             acc_code: exp?.acc_code || '',
             acc_th: exp?.acc_th || '',
             acc_en: exp?.acc_en || '',
             invoice_note: exp?.invoice_note || exp?.remark || exp?.note || '',
             staff: exp?.staff || exp?.created_by || '',
            department: exp?.department || '',
            project: exp?.project || '',
            source: exp?.source || '',
            ref_po: refPo,
            payment: exp?.payment || 0
          })
        }
      }
    }
    return rows
  }

  const expenseItemRows = computed(() => extractExpenseItemRows(expenseRows.value, poItemRows.value))
  
  const loading = ref(false)
  const lastFetched = ref(null)
  const pendingAutofill = ref(null) // สำหรับส่งข้อมูลข้ามหน้า

  // Persistent state for appoView.vue
  const appoFormState = ref({
    ap_number: '',
    po_id: '',
    po_date: '',
    supplier_name: '',
    item_ref: '',
    qty_order: null,
    department: '',
    po_created_by: '',
    date_transfer: '',
    option_name: '',
    total_price: null,
    currency_name: 'LAK',
    ap_status: '',
    qty_received: null,
    desired_date: '',
    remark: '',
  })
  const appoRowsState = ref([])
  const appoApSearchTextState = ref('')

  // Persistent state for expFormView.vue
  const expFormState = ref({
    ap_number: '',
    po_id: '',
    po_date: '',
    supplier_name: '',
    item_ref: '',
    qty_order: null,
    department: '',
    po_created_by: '',
    date_transfer: '',
    option_name: '',
    total_price: null,
    currency_name: 'LAK',
    ap_status: '',
    qty_received: null,
    desired_date: '',
    remark: '',
  })
  const expRowsState = ref([])
  const expApSearchTextState = ref('')
  
  // Default date range is rolling 4 months (current month + previous 3 months).
  const getInitialDates = () => {
    const formatLocalYmd = (d) => {
      const yyyy = String(d.getFullYear())
      const mm = String(d.getMonth() + 1).padStart(2, '0')
      const dd = String(d.getDate()).padStart(2, '0')
      return `${yyyy}-${mm}-${dd}`
    }

    const now = new Date()
    const to = formatLocalYmd(now) // Today's date
    const fromDate = new Date(now.getFullYear(), now.getMonth() - 3, 1)
    const from = formatLocalYmd(fromDate)
    
    return { from, to }
  }

  const initialDates = getInitialDates()
  const dateFrom = ref(initialDates.from)
  const dateTo = ref(initialDates.to)

  const isLoaded = computed(() => !!lastFetched.value)

  const getRowsByType = (type) => {
    if (type === 'pr') return prRows.value
    if (type === 'po') return poRows.value
    if (type === 'ap') return apRows.value
    if (type === 'pv') return pvRows.value
    return expenseRows.value
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Data warehouse mode — TRCloud (proxy) → Supabase → หน้าเว็บอ่านจาก Supabase
  // ──────────────────────────────────────────────────────────────────────────
  //  • backfill ครั้งแรก = ทั้งปีปัจจุบัน (1 ม.ค. → วันนี้) เก็บลง Supabase
  //  • หลังจากนั้นอัพเดทเฉพาะ ~1 เดือนล่าสุด (incremental) แล้ว upsert กันซ้ำด้วย unique_id
  //  • หน้าเว็บอ่านจาก Supabase เป็นหลัก (เร็ว + ไม่ยิง proxy ซ้ำ ๆ) — proxy ใช้แค่ตอน sync
  //  • debounce การ sync เก็บที่ Supabase (trcloud_sync_state) → แชร์กันทุกเครื่อง
  // ──────────────────────────────────────────────────────────────────────────

  const INCREMENTAL_DAYS = parseInt(import.meta.env.VITE_TRCLOUD_INCREMENTAL_DAYS || '31', 10)
  // ดึงเร็ว (on-demand): หน้าต่างสั้นกว่า เพื่อให้กดปุ่มแล้วได้ข้อมูลสดไว ๆ (default 7 วัน)
  const QUICK_DAYS = parseInt(import.meta.env.VITE_TRCLOUD_QUICK_DAYS || '7', 10)
  const SYNC_MIN_INTERVAL_MS =
    parseInt(import.meta.env.VITE_TRCLOUD_SYNC_MIN_INTERVAL_MIN || '15', 10) * 60 * 1000
  const ALL_TYPES = ['pr', 'po', 'ap', 'pv', 'expense']

  // สถานะ sync สำหรับ UI
  const syncing = ref(false)
  const syncPhase = ref('') // '' | 'backfill' | 'incremental'
  const syncMessage = ref('')
  const syncState = ref(null) // แถวล่าสุดจาก trcloud_sync_state

  const fmtYmd = (d) => {
    const yyyy = String(d.getFullYear())
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    return `${yyyy}-${mm}-${dd}`
  }
  const todayYmd = () => fmtYmd(new Date())
  const yearStartYmd = () => `${new Date().getFullYear()}-01-01`
  const incrementalFromYmd = () => {
    const d = new Date()
    d.setDate(d.getDate() - INCREMENTAL_DAYS)
    return fmtYmd(d)
  }
  const quickFromYmd = () => {
    const d = new Date()
    d.setDate(d.getDate() - QUICK_DAYS)
    return fmtYmd(d)
  }

  const setRowsByType = (type, rows) => {
    if (type === 'pr') prRows.value = rows
    else if (type === 'po') poRows.value = rows
    else if (type === 'ap') apRows.value = rows
    else if (type === 'pv') pvRows.value = rows
    else if (type === 'expense') expenseRows.value = rows
  }

  // ── localStorage: snapshot ของ ref ที่โหลดมาแล้ว เพื่อ paint ทันทีตอน reload ──
  // (source of truth คือ Supabase; อันนี้แค่ cache หน้าเว็บไม่ให้จอว่างระหว่างโหลด)
  const CACHE_PREFIX = 'trcloud_cache_v2_'
  const CACHE_TYPES = ['pr', 'po', 'ap', 'pv', 'expense']

  function persistMeta() {
    try {
      localStorage.setItem(CACHE_PREFIX + 'meta', JSON.stringify({
        savedAt: Date.now(),
        lastFetched: lastFetched.value ? new Date(lastFetched.value).toISOString() : null,
        typeLastFetchedAt: typeLastFetchedAt.value,
        typeLastRange: typeLastRange.value,
      }))
    } catch {}
  }

  // เก็บ snapshot ลง localStorage เฉพาะชุดที่ไม่ใหญ่มาก — ชุดใหญ่ข้ามไป (การ JSON.stringify
  // ก้อนหลายพัน object ทุกครั้งที่โหลดคือหนึ่งในต้นเหตุที่หน่วง; ชุดใหญ่โหลดจาก Supabase เอาแทน)
  const PERSIST_MAX_ROWS = 1200
  function persistType(type) {
    try {
      const rows = getRowsByType(type)
      if (rows.length > PERSIST_MAX_ROWS) {
        localStorage.removeItem(CACHE_PREFIX + type)
      } else {
        localStorage.setItem(CACHE_PREFIX + type, JSON.stringify(rows))
      }
    } catch { try { localStorage.removeItem(CACHE_PREFIX + type) } catch {} }
    persistMeta()
  }

  function hydrateCache() {
    try {
      const metaRaw = localStorage.getItem(CACHE_PREFIX + 'meta')
      if (metaRaw) {
        const meta = JSON.parse(metaRaw)
        if (meta?.typeLastFetchedAt) typeLastFetchedAt.value = meta.typeLastFetchedAt
        if (meta?.typeLastRange) typeLastRange.value = meta.typeLastRange
        if (meta?.lastFetched) lastFetched.value = new Date(meta.lastFetched)
      }
      for (const t of CACHE_TYPES) {
        const raw = localStorage.getItem(CACHE_PREFIX + t)
        if (!raw) continue
        const rows = JSON.parse(raw)
        if (!Array.isArray(rows) || !rows.length) continue
        setRowsByType(t, rows)
      }
    } catch {}
  }
  hydrateCache()

  // ── in-memory freshness: ถ้าเพิ่งโหลด range เดิมไม่นาน ไม่ต้อง query Supabase ซ้ำ ──
  // (สลับหน้าไป-มาในช่วง TTL นี้ = อ่านจากหน่วยความจำ ไม่ยิง network เลย → ลื่นขึ้นมาก)
  const MEM_TTL_MS = 2 * 60 * 1000
  function isTypeFresh(type, from, to) {
    if (!getRowsByType(type).length) return false
    if (typeLastRange.value[type] !== `${from || ''}_${to || ''}`) return false
    const last = typeLastFetchedAt.value[type]
    return !!last && Date.now() - new Date(last).getTime() < MEM_TTL_MS
  }

  // ── อ่านจาก Supabase → ใส่ ref (ตามช่วงวันที่ที่หน้าจอเลือก) ─────────────────
  async function loadType(type, from = dateFrom.value, to = dateTo.value, opts = {}) {
    const { force = false } = opts
    if (!force && isTypeFresh(type, from, to)) return // สดอยู่แล้ว ข้าม query
    try {
      const rows = await loadDocs(type, from, to)
      setRowsByType(type, rows)
      typeLastFetchedAt.value[type] = new Date()
      typeLastRange.value[type] = `${from || ''}_${to || ''}`
      persistType(type)
    } catch (err) {
      console.error(`โหลด ${type} จาก Supabase ล้มเหลว:`, err)
    }
  }

  async function loadAll(from = dateFrom.value, to = dateTo.value, opts = {}) {
    await Promise.all(ALL_TYPES.map((t) => loadType(t, from, to, opts)))
  }

  // ── ดึงจาก TRCloud (proxy) ช่วง [from,to] → คืน rows (normalize แล้ว) ────────
  async function pullTypeFromProxy(type, from, to) {
    const companyId = (import.meta.env.VITE_TRCLOUD_COMPANY_ID || '25').trim()
    const passkey = (import.meta.env.VITE_TRCLOUD_PASSKEY || '6a05946b357765415b4c931d2122a8c8').trim()
    if (!companyId || !passkey) {
      console.error('TRCLOUD API Credentials missing!')
      return []
    }

    let endpoint = ''
    let docType = 'project'
    let useJson = false
    let candidateEndpoints = []

    if (type === 'pv') {
      endpoint = '/application/finance/api/engine-payment/payment_search_keyword.php'
      docType = ''
      useJson = true
      candidateEndpoints = [
        '/application/finance/api/engine-payment/payment_search_keyword.php',
        '/application/finance/api/engine-payment/payment_list.php'
      ]
    } else if (type === 'pr') {
      endpoint = '/application/expense/api/engine-pr/pr_search_keyword.php'
      candidateEndpoints = [endpoint]
    } else if (type === 'po') {
      endpoint = '/application/expense/api/engine-po/po_search_keyword.php'
      candidateEndpoints = [
        '/application/expense_report/api/engine-po/po_list.php',
        '/application/expense/api/engine-po/po_search_keyword.php'
      ]
      useJson = true
    } else if (type === 'ap') {
      endpoint = '/application/expense_report/api/engine-report/invoice_list.php'
      docType = ''
      useJson = true
      candidateEndpoints = [
        '/application/expense_report/api/engine-report/invoice_list.php',
        '/application/expense_report/api/engine-report/invoice_by_supplier.php'
      ]
    } else if (type === 'expense') {
      endpoint = '/application/expense/api/engine-expense/expense_search_keyword.php'
      docType = ''
      candidateEndpoints = [endpoint]
    }

    let results = []
    const seen = new Set()
    let selectedEndpoint = endpoint

    for (const nextEndpoint of candidateEndpoints) {
      selectedEndpoint = nextEndpoint
      let page = 0
      let pageResults = []
      let endpointTotal = null

      let currentUseJson = useJson
      if (selectedEndpoint.includes('expense_search_keyword.php')) {
        currentUseJson = false
      } else if (selectedEndpoint.includes('_search_keyword.php')) {
        currentUseJson = (type === 'pv')
      } else if (selectedEndpoint.includes('invoice_list.php') || selectedEndpoint.includes('po_list.php') || selectedEndpoint.includes('payment_list.php')) {
        currentUseJson = true
      }

      while (true) {
        let finalPayload = {
          company_id: companyId,
          passkey: passkey,
          start: page,
          keyword: '',
          filter: '',
          from: from,
          to: to,
          date_from: from,
          date_to: to,
          activate_date: 'on',
          department: '',
          sort: '',
          advance_search: '1',
          project: '',
          staff: '',
          source: '',
          title: '',
          name: '',
          organization: '',
          tax_id: '',
          doc_from: '',
          doc_to: '',
          total_from: '',
          total_to: '',
          gtotal_from: '',
          gtotal_to: '',
          vat: 'all',
          type: docType
        }

        if (type === 'expense') {
          finalPayload = {
            ...finalPayload,
            from: from,
            to: to,
            date_from: from,
            date_to: to,
            type: 'exp',
            advance_search: 1
          }
        }

        if (type === 'ap' && String(selectedEndpoint || '').toLowerCase().includes('invoice_list.php')) {
          finalPayload = {
            company_id: companyId,
            passkey: passkey,
            from: from,
            to: to,
            date_type: 'issue_date',
            status_paid: 'paid',
            status_debtor: 'debtor',
            status_overdue: 'overdue',
            credit_note: '',
            staff_from: '*',
            staff_to: '*',
            project: '*',
            department: '*',
            keyword: '',
            start: page
          }
        }

        if (type === 'po' && String(selectedEndpoint || '').toLowerCase().includes('po_list.php')) {
          finalPayload = {
            company_id: companyId,
            passkey: passkey,
            from: from,
            to: to,
            status_new: 1,
            status_partial: 1,
            status_success: 1,
            status_confirm: 1,
            status_rejected: 0,
            status_force: 1,
            status_sent: 0,
            status_email: 0,
            date_type: 'issue_date',
            remain_status: '',
            sales_from: '*',
            sales_to: '*',
            project: '*',
            department: '*',
            keyword: '',
            start: page
          }
        }

        if (type === 'pv' && (String(selectedEndpoint || '').toLowerCase().includes('payment_list.php') || String(selectedEndpoint || '').toLowerCase().includes('payment_search_keyword.php'))) {
          finalPayload = {
            company_id: companyId,
            passkey: passkey,
            from: from,
            to: to,
            date_type: 'issue_date',
            keyword: '',
            start: page,
            filter: '',
            activate_date: 'on',
            department: '',
            sort: ''
          }
        }

        const body = currentUseJson
          ? new URLSearchParams({ json: JSON.stringify(finalPayload) })
          : new URLSearchParams(finalPayload)

        const url = trcloudProxyUrl(selectedEndpoint)
        let response
        try {
          response = await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              'X-Requested-With': 'XMLHttpRequest',
              ...trcloudProxyExtraHeaders(),
            },
            body: body,
          })
        } catch (err) {
          console.error(`Network error for ${type}:`, err)
          break
        }

        if (!response.ok) {
          console.error(`HTTP error for ${type}: status ${response.status}`)
          break
        }
        const res = await response.json()

        const isSuccess = res.success == 1 || res.success === true || Array.isArray(res.result) || Array.isArray(res.data)
        if (!isSuccess) {
          if (res.message === 'No data is received!') break
          if (pageResults.length > 0) {
            console.warn(`⚠️ Partial fetch for ${type}:`, res.message)
            break
          }
          console.error(`❌ API Error for ${type}:`, res.message || 'Unknown Error')
          break
        }

        if (endpointTotal === null) endpointTotal = parseInt(res.count || res.total || 0)

        let items = res.result || res.data || []
        if (!Array.isArray(items)) {
          items = (typeof items === 'object' && items !== null) ? [items] : []
        }
        if (items.length === 0) break

        for (const it of items) {
          if (type === 'pv') {
            if (!it.issue_date && it.payment_date) it.issue_date = it.payment_date
            if (!it.issue_date && it.date) it.issue_date = it.date
            if (!it.grand_total && it.amount) it.grand_total = it.amount
            if (!it.grand_total && it.total_amount) it.grand_total = it.total_amount
            if (!it.grand_total && it.total) it.grand_total = it.total
            it.payment = it.grand_total || it.total || it.amount || it.total_amount || 0

            let rawStatus = (it.status || it.payment_status || it.status_payment || '').toString().toLowerCase()
            let status = it.status || 'ชำระแล้ว'
            if (rawStatus.includes('ชำระแล้ว') || rawStatus.includes('paid') || rawStatus.includes('success') || rawStatus.includes('complete') || rawStatus.includes('อนุมัติ')) {
              status = 'ชำระแล้ว'
            } else if (rawStatus.includes('ยังไม่') || rawStatus.includes('unpaid') || rawStatus.includes('pending')) {
              status = 'ยังไม่ชำระ'
            } else if (rawStatus.includes('ยกเลิก') || rawStatus.includes('cancel')) {
              status = 'ยกเลิก'
            }
            it.status = status
            if (!it.payment_status) it.payment_status = status
            it.currency = String(it.fx || it.currency || it.currency_name || it.currency_code || it.fx_code || 'LAK').toUpperCase()
          }

          let pid
          if (type === 'ap') {
            pid = it.item_id || it.ap_item_id || (`${it.expense_id || it.invoice_number || ''}_${it.product_id || it.item_id || ''}_${(it.description || it.item_name || it.product || '')}`)
          } else if (type === 'po') {
            pid = it.item_id || it.po_item_id || (`${it.po_id || it.id || it.document_number || ''}_${it.product_id || it.item_id || ''}_${(it.description || it.item_name || it.product || '')}`)
          } else {
            pid = it.po_id || it.pr_id || it.expense_id || it.payment_id || it.id || it.invoice_number || it.document_number
          }

          if (pid) {
            if (seen.has(pid)) continue
            seen.add(pid)
            it.unique_id = String(pid)
          } else {
            // ไม่มี identifier: สร้าง key จากเนื้อหา (deterministic — จะได้ไม่เกิดแถวซ้ำตอน sync รอบถัดไป)
            it.unique_id = `fallback_${type}_${it.issue_date || it.date || ''}_${it.grand_total || it.total || ''}_${it.invoice_number || it.document_number || ''}`
            if (seen.has(it.unique_id)) continue
            seen.add(it.unique_id)
          }

          if (!it.currency) {
            it.currency = String(it.fx || it.currency || it.currency_name || it.currency_code || it.fx_code || 'LAK').toUpperCase()
          }
          pageResults.push(it)
        }

        if (endpointTotal && pageResults.length >= endpointTotal) break
        page++
        await new Promise((resolve) => setTimeout(resolve, 10))
        if (page > 50) break
      }

      if (pageResults.length > 0) {
        results = pageResults
        break
      }
    }

    // AP: map สถานะชำระ/สกุลเงินให้พร้อมใช้ (เหมือน logic เดิม) ก่อนเก็บลง warehouse
    if (type === 'ap') {
      results = results.map((x) => {
        let rawStatus = (x.payment_status || x.status || x.status_payment || '').toString().toLowerCase()
        let status = 'ยังไม่ชำระ'
        const remain = parseFloat(x.remain || x.balance || -1)
        const total = parseFloat(x.grand_total || x.total || 0)
        if (remain === 0 || rawStatus.includes('paid') || rawStatus.includes('ชำระแล้ว') || rawStatus.includes('success') || rawStatus.includes('complete') || rawStatus.includes('อนุมัติ')) {
          status = 'ชำระแล้ว'
        } else if (remain > 0 && remain < total) {
          status = 'ยังไม่ชำระ'
        }
        const mappedCurrency = String(x.fx || x.currency || x.currency_name || x.currency_code || x.fx_code || 'LAK').toUpperCase()
        return { ...x, payment_status: status, currency: mappedCurrency }
      })
    }

    return results
  }

  async function refreshSyncState() {
    syncState.value = await getSyncState()
    return syncState.value
  }

  // ── sync ชนิดเดียว: pull จาก proxy → upsert Supabase → reload ref จาก warehouse ──
  async function syncType(type, from, to) {
    const rows = await pullTypeFromProxy(type, from, to)
    if (rows.length) {
      try {
        await upsertDocs(type, rows)
      } catch (err) {
        console.error(`บันทึก ${type} ลง Supabase ล้มเหลว:`, err)
      }
    }
    await loadType(type, dateFrom.value, dateTo.value, { force: true }) // sync แล้วต้องรีโหลดจริง
    return rows.length
  }

  async function syncRange(from, to, { label = '' } = {}) {
    for (const type of ALL_TYPES) {
      syncMessage.value = `${label}${type.toUpperCase()}…`
      try {
        await syncType(type, from, to)
      } catch (err) {
        console.error(`sync ${type} ล้มเหลว:`, err)
      }
    }
  }

  // backfill ทั้งปีปัจจุบัน (ครั้งแรก หรือกดเอง)
  async function backfillThisYear() {
    if (syncing.value) return
    syncing.value = true
    syncPhase.value = 'backfill'
    const nowIso = new Date().toISOString()
    const from = yearStartYmd()
    const to = todayYmd()
    try {
      await syncRange(from, to, { label: 'ดึงทั้งปี · ' })
      await setSyncState({
        last_full_backfill: nowIso,
        last_incremental_at: nowIso,
        backfill_from: from,
        backfill_to: to,
      })
      await refreshSyncState()
    } finally {
      syncing.value = false
      syncPhase.value = ''
      syncMessage.value = ''
      lastFetched.value = new Date()
      persistMeta()
    }
  }

  // อัพเดทเฉพาะ ~1 เดือนล่าสุด
  async function incrementalSync() {
    if (syncing.value) return
    syncing.value = true
    syncPhase.value = 'incremental'
    const from = incrementalFromYmd()
    const to = todayYmd()
    try {
      await syncRange(from, to, { label: 'อัพเดทล่าสุด · ' })
      await setSyncState({ last_incremental_at: new Date().toISOString() })
      await refreshSyncState()
    } finally {
      syncing.value = false
      syncPhase.value = ''
      syncMessage.value = ''
      lastFetched.value = new Date()
      persistMeta()
    }
  }

  // ดึงเร็วทุกชนิด (on-demand) — หน้าต่างสั้น QUICK_DAYS ให้ได้ข้อมูลสดไว ๆ
  async function quickSyncAll() {
    if (syncing.value) return
    syncing.value = true
    syncPhase.value = 'quick'
    const from = quickFromYmd()
    const to = todayYmd()
    try {
      await syncRange(from, to, { label: 'ดึงเร็ว · ' })
      await setSyncState({ last_incremental_at: new Date().toISOString() })
      await refreshSyncState()
    } finally {
      syncing.value = false
      syncPhase.value = ''
      syncMessage.value = ''
      lastFetched.value = new Date()
      persistMeta()
    }
  }

  const isIncrementalStale = (state) => {
    const last = state?.last_incremental_at
    if (!last) return true
    return Date.now() - new Date(last).getTime() > SYNC_MIN_INTERVAL_MS
  }

  // ── public: โหลดข้อมูลเข้าหน้าเว็บ (อ่านจาก Supabase) + sync ตามจำเป็น ────────
  async function fetchAll(options = {}) {
    const { force = false } = options
    if (loading.value) return
    loading.value = true
    try {
      await loadAll() // paint จาก Supabase (cache-aware — ข้ามชนิดที่ยังสด)
      let state = await refreshSyncState()
      const total = await countDocs()
      if (total === 0) {
        // warehouse ว่างจริง → ดึงทั้งปี (ครั้งแรกสุดเท่านั้น)
        await backfillThisYear()
      } else {
        // มีข้อมูลแล้ว: ถ้า flag ยังว่าง (เช่นข้อมูลมาจากการ pull รายหน้า) → เซ็ตให้ กันทุกหน้าดึงซ้ำ
        if (!state?.last_full_backfill) {
          const nowIso = new Date().toISOString()
          await setSyncState({
            last_full_backfill: nowIso,
            last_incremental_at: state?.last_incremental_at || nowIso,
          })
          state = await refreshSyncState()
        }
        if (force || isIncrementalStale(state)) {
          // incrementalSync/backfill รีโหลดแต่ละชนิดให้อยู่แล้ว ไม่ต้อง loadAll ซ้ำ
          await incrementalSync()
        }
      }
      lastFetched.value = new Date()
      persistMeta()
    } finally {
      loading.value = false
    }
  }

  // โหลด/อัพเดทเฉพาะชนิดเดียว (apView/poView/expView/... เรียก)
  async function fetchTrcloudData(type = 'pr', options = {}) {
    if (activeRequests.has(type)) return activeRequests.get(type)
    const { force = false } = options
    // ทางลัด: ไม่ force + ข้อมูลในหน่วยความจำยังสด → ไม่ต้องแตะ Supabase เลย (สลับหน้าลื่น)
    if (!force && isTypeFresh(type, dateFrom.value, dateTo.value)) return

    const wasLoading = loading.value
    if (!wasLoading) loading.value = true

    const requestPromise = (async () => {
      try {
        // มี rows ในหน่วยความจำแล้ว = ถือว่ามีข้อมูล (ไม่ต้อง query count); ว่างค่อยเช็ค warehouse
        const hasData = getRowsByType(type).length > 0 || (await countDocs(type)) > 0
        if (!hasData) {
          // warehouse ยังไม่มีชนิดนี้ → ดึงทั้งปีลง Supabase (ครั้งเดียว)
          await syncType(type, yearStartYmd(), todayYmd())
        } else if (force) {
          // กดเอง = ดึงเร็วจาก TRCloud (หน้าต่างสั้น QUICK_DAYS) แล้ว upsert + reload
          await syncType(type, quickFromYmd(), todayYmd())
        } else {
          // ปกติ (ตอน mount) = อ่านจาก Supabase อย่างเดียว ไม่ยิง TRCloud
          await loadType(type)
        }
      } catch (err) {
        console.error(`fetchTrcloudData(${type}) ล้มเหลว:`, err)
      } finally {
        activeRequests.delete(type)
        if (!wasLoading) loading.value = false
      }
    })()

    activeRequests.set(type, requestPromise)
    return requestPromise
  }

  return {
    prRows, poRows, apRows, pvRows, expenseRows,
    apItemRows, poItemRows, prItemRows, expenseItemRows,
    loading, lastFetched, isLoaded,
    dateFrom, dateTo,
    appoFormState, appoRowsState, appoApSearchTextState,
    expFormState, expRowsState, expApSearchTextState,
    pendingAutofill,
    fetchAll, fetchTrcloudData,
    // ── warehouse / sync ──
    syncing, syncPhase, syncMessage, syncState,
    backfillThisYear, incrementalSync, quickSyncAll, loadAll, loadType, refreshSyncState,
  }
})
