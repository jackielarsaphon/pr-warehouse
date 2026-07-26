import { createRouter, createWebHashHistory } from 'vue-router'

// หน้า Login เท่านั้นที่ import แบบ static — เป็นหน้าแรกที่ทุกคนเห็น ไม่ควรมี round trip เพิ่ม
import LoginView from '@/views/LoginView.vue'

// ── หน้าอื่นโหลดแบบ lazy (route-level code splitting) ─────────────────────────
// เดิม import ทุกหน้าแบบ static → โค้ดของทุกหน้า (พร้อม xlsx/jspdf/chart.js ที่หน้านั้น ๆ
// เรียกใช้) ถูกยัดรวมเป็น bundle ก้อนเดียว ผู้ใช้ต้องรอดาวน์โหลด+parse ทั้งหมด
// ก่อนเห็นหน้าจอแรก vue-router รับ () => import() ได้ตรง ๆ จึงโหลดเฉพาะหน้าที่เข้าจริง
const DashboardView = () => import('@/views/DashboardView.vue')
const ItemListView = () => import('@/views/ItemListView.vue')
const InventoryImportsView = () => import('@/views/InventoryImportsView.vue')
const InventoryhistoryLisView = () => import('@/views/InventoryhistoryLisView.vue')
const OrderListView = () => import('@/views/OrderListView.vue')
const TransactionsListView = () => import('@/views/TransactionsListView.vue')
const HistoryListView = () => import('@/views/historyListView.vue')
const EmployeeLisView = () => import('@/views/EmployeeLisView.vue')
const SystemusersLisView = () => import('@/views/SystemusersLisView.vue')
const UserLogsLisView = () => import('@/views/userLogsLisView.vue')
const ImportMoreListView = () => import('@/views/ImportMoreListView.vue')
const SummaryDetailView = () => import('@/views/summary_detailView.vue')
const InspectionView = () => import('@/views/inspectionView.vue')
const InspectionItemsView = () => import('@/views/inspection_itemsView.vue')
const HomepageView = () => import('@/views/localState/users/HomepageView.vue')
const CreateOrderView = () => import('@/views/localState/users/CreateOrderView.vue')
const CreatePRView = () => import('@/views/localState/users/CreatePRView.vue')
const HistoryView = () => import('@/views/localState/users/HistoryView.vue')
const WithdrawFormView = () => import('@/views/localState/users/WithdrawFormView.vue')
const PrAdminView = () => import('@/views/PrSystem/AdminView.vue')
// PrSystem Views
const SystemadminLisView = () => import('@/views/PrSystem/Views/SystemadminLisView.vue')
const AdminLogsView = () => import('@/views/PrSystem/Views/adminLogsView.vue')
// LocalState Views
const InspectionUser = () => import('@/views/localState/users/inspectionUser.vue')



const routes = [
  { path: '/', component: LoginView, meta: { requiresAuth: false } },
  { path: '/dashboard', component: DashboardView, meta: { requiresAuth: true, isAdmin: true } },
  { path: '/reports', component: SummaryDetailView, meta: { requiresAuth: true, isAdmin: true } },
  { path: '/item-list', component: ItemListView, meta: { requiresAuth: true, isAdmin: true } },
  { path: '/inventory-imports', component: InventoryImportsView, meta: { requiresAuth: true, isAdmin: true } },
  { path: '/inventory-history', component: InventoryhistoryLisView, meta: { requiresAuth: true, isAdmin: true } },
  { path: '/order-list', component: OrderListView, meta: { requiresAuth: true, isAdmin: true } },
  { path: '/withdraw', component: TransactionsListView, meta: { requiresAuth: true, isAdmin: true } },
  { path: '/history', component: HistoryListView, meta: { requiresAuth: true, isAdmin: true } },
  { path: '/employees', component: EmployeeLisView, meta: { requiresAuth: true, isAdmin: true } },
  { path: '/system-users', component: SystemusersLisView, meta: { requiresAuth: true, isAdmin: true } },
  { path: '/logs', component: UserLogsLisView, meta: { requiresAuth: true, isAdmin: true } },
  { path: '/imports', component: ImportMoreListView, meta: { requiresAuth: true, isAdmin: true } },
  { path: '/return', component: InspectionView, meta: { requiresAuth: true, isAdmin: true } },
  { path: '/return-history', component: InspectionItemsView, meta: { requiresAuth: true, isAdmin: true } },
  { path: '/u/home', component: HomepageView, meta: { requiresAuth: true } },
  { path: '/u/create', component: CreateOrderView, meta: { requiresAuth: true } },
  { path: '/u/create-pr', component: CreatePRView, meta: { requiresAuth: true } },
  { path: '/u/history', component: HistoryView, meta: { requiresAuth: true } },
  { path: '/u/withdraw', component: WithdrawFormView, meta: { requiresAuth: true } },
  { path: '/pr/admin', component: PrAdminView, meta: { requiresAuth: true, isSuperAdmin: true } },
  // PrSystem Routes
  { path: '/pr/system-admins', component: SystemadminLisView, meta: { requiresAuth: true, isSuperAdmin: true, isAdmin: true } },
  { path: '/pr/logs-usage', component: AdminLogsView, meta: { requiresAuth: true, isSuperAdmin: true, isAdmin: true } },
  // LocalState Routes
  { path: '/u/inspectionuser', component: InspectionUser, meta: { requiresAuth: true } },
]

const router = createRouter({
  history: createWebHashHistory(),
  routes,
})

router.beforeEach((to) => {
  const sessionStr = localStorage.getItem('mwm_session')
  const user = sessionStr ? JSON.parse(sessionStr) : null

  // 1. ถ้าหน้าต้องการ Auth แต่ไม่มี Session
  if (to.meta.requiresAuth && !user) {
    return '/'
  }

  // 2. ถ้าเข้าหน้า Admin (isAdmin: true) แต่ไม่ใช่ admin_store/super_admin
  if (to.meta.isAdmin && !['admin_store', 'super_admin'].includes(user?.role)) {
    return '/u/home'
  }

  // 2.1 ถ้าเข้าหน้า Super Admin แต่ไม่ใช่ super_admin
  if (to.meta.isSuperAdmin && user?.role !== 'super_admin') {
    return user?.role === 'admin_store' ? '/dashboard' : '/u/home'
  }

  // 3. ถ้าเข้าหน้า Login ทั้งที่มี Session แล้ว
  if (to.path === '/' && user) {
    if (user.role === 'super_admin') return '/pr/admin'
    if (user.role === 'admin_store') return '/dashboard'
    return '/u/home'
  }
})

export default router
