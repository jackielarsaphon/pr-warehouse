<script setup>
import { computed, onMounted, ref } from "vue"
import { useTrcloudStore } from "@/stores/trcloud"

const trcloudStore = useTrcloudStore()
const trcloudLoading = computed(() => trcloudStore.loading)
const filter = ref("")

function normalizeKey(v) {
  return String(v || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
}

function firstValue(...values) {
  for (const v of values) {
    if (v !== null && v !== undefined && String(v).trim() !== "") return v
  }
  return ""
}

function splitRefTokens(v) {
  const raw = String(v || "").toUpperCase()
  return raw
    .split(/[^A-Z0-9]+/g)
    .map((x) => x.trim())
    .filter(Boolean)
}

function getPrNo(r) {
  return String(firstValue(r.document_number, r.pr_id, r.id) || "")
}
function getPoNo(r) {
  return String(firstValue(r.document_number, r.po_id, r.id) || "")
}
function getApNo(r) {
  return String(firstValue(r.invoice_number, r.document_number, r.expense_id, r.id) || "")
}
function getPvNo(r) {
  return String(firstValue(r.document_number, r.payment_id, r.id) || "")
}

function includesDocRef(refValue, docNo) {
  const refNorm = normalizeKey(refValue)
  const docNorm = normalizeKey(docNo)
  if (!refNorm || !docNorm) return false
  if (refNorm.includes(docNorm)) return true
  return splitRefTokens(refValue).includes(docNorm)
}

const relationRows = computed(() => {
  const prRows = trcloudStore.prRows || []
  const poRows = trcloudStore.poRows || []
  const apRows = trcloudStore.apRows || []
  const pvRows = trcloudStore.pvRows || []

  const rows = prRows.map((pr) => {
    const prNo = getPrNo(pr)
    const pos = poRows.filter((po) => includesDocRef(po.reference, prNo))
    const poNos = pos.map(getPoNo).filter(Boolean)

    const aps = apRows.filter((ap) => {
      const apRef = firstValue(ap.po, ap.reference)
      return poNos.some((poNo) => includesDocRef(apRef, poNo))
    })
    const apNos = aps.map(getApNo).filter(Boolean)

    const pvs = pvRows.filter((pv) => {
      const pvRef = firstValue(pv.reference, pv.remark, pv.note)
      return apNos.some((apNo) => includesDocRef(pvRef, apNo)) || poNos.some((poNo) => includesDocRef(pvRef, poNo))
    })

    return {
      prNo: prNo || "-",
      prDate: firstValue(pr.issue_date, pr.date, "-"),
      prStatus: firstValue(pr.status, "-"),
      poNos: pos.map(getPoNo).filter(Boolean),
      poDates: pos.map((po) => firstValue(po.issue_date, po.date, "")).filter(Boolean),
      apNos: aps.map(getApNo).filter(Boolean),
      apDates: aps.map((ap) => firstValue(ap.issue_date, ap.date, "")).filter(Boolean),
      pvNos: pvs.map(getPvNo).filter(Boolean),
      pvDates: pvs.map((pv) => firstValue(pv.issue_date, pv.date, "")).filter(Boolean)
    }
  })

  const q = filter.value.trim().toLowerCase()
  if (!q) return rows
  return rows.filter((r) => JSON.stringify(r).toLowerCase().includes(q))
})

function showValues(values) {
  if (!values || !values.length) return "-"
  return values.join(", ")
}

function mergeDocDate(docNo, docDate) {
  const no = String(docNo || "").trim()
  const dt = String(docDate || "").trim()
  if (!no && !dt) return "-"
  if (!no) return dt
  if (!dt) return no
  return `${no} (${dt})`
}

function mergeDocDateList(docNos, docDates) {
  const docs = Array.isArray(docNos) ? docNos : []
  const dates = Array.isArray(docDates) ? docDates : []
  const size = Math.max(docs.length, dates.length)
  if (size === 0) return "-"
  const merged = []
  for (let i = 0; i < size; i += 1) {
    merged.push(mergeDocDate(docs[i], dates[i]))
  }
  return merged.join("\n")
}

onMounted(() => {
  if (!trcloudStore.isLoaded) trcloudStore.fetchAll()
})
</script>

<template>
  <div>
    <div class="mb-6">
      <h1 class="text-[20px] font-semibold" style="color: var(--color-text-primary)">สถานะเชื่อมโยง PR-PO-AP-PV</h1>
      <p class="text-[13px] mt-0.5" style="color: var(--color-text-muted)">
        ตรวจสอบความต่อเนื่องของเอกสารว่า PR ต่อไป PO, AP และ PV ตรงกันหรือไม่
      </p>
    </div>

    <div class="mb-5 p-4 rounded-xl border" style="background: var(--color-bg-card); border-color: var(--color-border)">
      <div class="relative w-full">
        <i class="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-[14px]" style="color: var(--color-text-muted)"></i>
        <input
          v-model="filter"
          type="text"
          placeholder="ค้นหา PR/PO/AP/PV..."
          class="w-full pl-9 pr-4 py-2 bg-transparent border rounded-lg text-[13px] focus:outline-none focus:ring-1 transition-all"
          style="border-color: var(--color-border); color: var(--color-text-primary)"
        />
      </div>
    </div>

    <div class="rounded-xl border overflow-hidden" style="background: var(--color-bg-card); border-color: var(--color-border)">
      <div class="overflow-x-auto">
        <table class="w-full text-[13px] min-w-[980px] border-collapse">
          <thead>
            <tr style="background: var(--color-bg-body); border-bottom: 1px solid var(--color-border)">
              <th class="px-4 py-3 text-left font-medium" style="color: var(--color-text-muted); border-right: 1px solid var(--color-border)">PR / วันที่</th>
              <th class="px-4 py-3 text-left font-medium" style="color: var(--color-text-muted); border-right: 1px solid var(--color-border)">PO / วันที่</th>
              <th class="px-4 py-3 text-left font-medium" style="color: var(--color-text-muted); border-right: 1px solid var(--color-border)">AP / วันที่</th>
              <th class="px-4 py-3 text-left font-medium" style="color: var(--color-text-muted); border-right: 1px solid var(--color-border)">PV / วันที่</th>
              <th class="px-4 py-3 text-left font-medium" style="color: var(--color-text-muted)">สถานะ PR</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="trcloudLoading">
              <td colspan="5" class="px-4 py-12 text-center">
                <i class="fa-solid fa-circle-notch fa-spin text-2xl text-blue-500"></i>
              </td>
            </tr>
            <tr v-else-if="!relationRows.length">
              <td colspan="5" class="px-4 py-12 text-center" style="color: var(--color-text-muted)">ไม่พบข้อมูลสำหรับตรวจสอบความเชื่อมโยง</td>
            </tr>
            <tr
              v-for="row in relationRows"
              :key="row.prNo"
              class="hover:bg-gray-50/50 transition-colors"
              style="border-bottom: 1px solid var(--color-border)"
            >
              <td
                class="px-4 py-3 font-mono font-semibold text-cyan-600 break-words whitespace-normal align-top"
                style="border-right: 1px solid var(--color-border); word-break: break-word"
              >
                {{ mergeDocDate(row.prNo, row.prDate) }}
              </td>
              <td
                class="px-4 py-3 font-mono break-words whitespace-pre-line align-top"
                style="color: var(--color-text-primary); border-right: 1px solid var(--color-border); word-break: break-word"
              >
                {{ mergeDocDateList(row.poNos, row.poDates) }}
              </td>
              <td
                class="px-4 py-3 font-mono break-words whitespace-pre-line align-top"
                style="color: var(--color-text-primary); border-right: 1px solid var(--color-border); word-break: break-word"
              >
                {{ mergeDocDateList(row.apNos, row.apDates) }}
              </td>
              <td
                class="px-4 py-3 font-mono break-words whitespace-pre-line align-top"
                style="color: var(--color-text-primary); border-right: 1px solid var(--color-border); word-break: break-word"
              >
                {{ mergeDocDateList(row.pvNos, row.pvDates) }}
              </td>
              <td class="px-4 py-3 break-words whitespace-normal align-top" style="color: var(--color-text-primary); word-break: break-word">{{ row.prStatus || "-" }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
