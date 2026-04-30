<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from "vue"
import { useRouter } from "vue-router"
import ProfileEditSidebar from "@/components/layout/ProfileEditSidebar.vue"
const emit = defineEmits(["logout", "edit-profile", "toggle-sidebar"])

const props = defineProps({
  title: { type: String, default: "Dashboard" },
  user: {
    type: Object,
    default: () => ({
      fullName: "ผู้ใช้งานตัวอย่าง",
      employeeId: "EMP-0001",
      role: "Admin",
      position: "Manager",
    }),
  },
})

const router = useRouter()

const menuOpen = ref(false)
const profileRef = ref(null)
const notificationsOpen = ref(false)
const notificationsRef = ref(null)
const isDark = ref(document.documentElement.classList.contains("dark"))
const now = ref(new Date())
const isCompact = ref(window.matchMedia("(max-width: 640px)").matches)
const switchOpen = ref(false)
const showEditProfile = ref(false)

const dateTimeText = computed(() => {
  const formatter = new Intl.DateTimeFormat(
    "th-TH",
    isCompact.value
      ? {
          year: "2-digit",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }
      : {
          year: "numeric",
          month: "long",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }
  )
  return formatter.format(now.value)
})

const notifications = ref([
  {
    id: "n1",
    title: "มีรายการใหม่",
    description: "มีคำขอใหม่รอการตรวจสอบ",
    time: "เมื่อสักครู่",
    unread: true,
  },
  {
    id: "n2",
    title: "อัปเดตระบบ",
    description: "ปรับปรุงสิทธิ์การใช้งานเรียบร้อย",
    time: "1 ชม. ที่แล้ว",
    unread: false,
  },
  {
    id: "n3",
    title: "แจ้งเตือน",
    description: "มีการเข้าสู่ระบบจากอุปกรณ์ใหม่",
    time: "เมื่อวาน",
    unread: false,
  },
])

function toggleNotifications() {
  menuOpen.value = false
  switchOpen.value = false
  notificationsOpen.value = !notificationsOpen.value
}

function closeNotifications() {
  notificationsOpen.value = false
}

function goToStoreSystem() {
  switchOpen.value = false
  menuOpen.value = false
  router.push("/dashboard")
}

function markAllNotificationsRead() {
  notifications.value = notifications.value.map((n) => ({ ...n, unread: false }))
}

function markNotificationRead(id) {
  notifications.value = notifications.value.map((n) =>
    n.id === id ? { ...n, unread: false } : n
  )
}

function toggleMenu() {
  notificationsOpen.value = false
  switchOpen.value = false
  menuOpen.value = !menuOpen.value
}

function closeMenu() {
  menuOpen.value = false
  switchOpen.value = false
}

function toggleSwitch() {
  switchOpen.value = !switchOpen.value
}

function openEditProfile() {
  notificationsOpen.value = false
  switchOpen.value = false
  menuOpen.value = false
  showEditProfile.value = true
}

function toggleTheme() {
  isDark.value = !isDark.value
  document.documentElement.classList.toggle("dark", isDark.value)
  localStorage.setItem("theme", isDark.value ? "dark" : "light")
  if (typeof CustomEvent === "function") {
    window.dispatchEvent(
      new CustomEvent("themechange", { detail: { isDark: isDark.value } })
    )
  }
}

function onThemeChange(event) {
  if (!(event instanceof CustomEvent)) return
  if (!event.detail || typeof event.detail.isDark !== "boolean") return
  isDark.value = event.detail.isDark
  document.documentElement.classList.toggle("dark", isDark.value)
}

function onPointerDown(event) {
  const profileEl = profileRef.value
  if (
    menuOpen.value &&
    profileEl instanceof HTMLElement &&
    !profileEl.contains(event.target)
  ) {
    closeMenu()
  }

  const notiEl = notificationsRef.value
  if (
    notificationsOpen.value &&
    notiEl instanceof HTMLElement &&
    !notiEl.contains(event.target)
  ) {
    closeNotifications()
  }
}

let timerId
const onResize = () => {
  isCompact.value = window.matchMedia("(max-width: 640px)").matches
}

onMounted(() => {
  timerId = window.setInterval(() => {
    now.value = new Date()
  }, 1000)
  window.addEventListener("resize", onResize)
  window.addEventListener("pointerdown", onPointerDown)
  window.addEventListener("themechange", onThemeChange)
})

onBeforeUnmount(() => {
  window.clearInterval(timerId)
  window.removeEventListener("resize", onResize)
  window.removeEventListener("pointerdown", onPointerDown)
  window.removeEventListener("themechange", onThemeChange)
})
</script>

<template>
  <header
    class="flex items-center justify-between bg-white dark:bg-gray-950 border-b border-gray-200 dark:border-gray-800 px-3 sm:px-6 py-2.5 sm:py-3"
  >
    <div class="flex items-center gap-2 min-w-0">
      <button
        type="button"
        class="sm:hidden inline-flex items-center justify-center w-9 h-9 rounded-lg bg-gray-100 text-gray-600 hover:text-gray-900 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:text-white dark:hover:bg-gray-700 transition"
        @click="emit('toggle-sidebar')"
        aria-label="เมนู"
      >
        <i class="fa-solid fa-bars text-[18px]"></i>
      </button>
      <h1
        class="text-gray-900 dark:text-white font-semibold text-base sm:text-lg truncate"
      >
        {{ props.title }}
      </h1>
    </div>
    <div class="flex items-center gap-2 sm:gap-3 flex-shrink-0">
      <div
        class="rounded-lg px-2 sm:px-3 py-1.5 text-xs sm:text-sm bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-200 whitespace-nowrap"
      >
        {{ dateTimeText }}
      </div>

      <button
        type="button"
        class="text-gray-600 hover:text-gray-900 bg-gray-100 dark:text-gray-400 dark:hover:text-white dark:bg-gray-800 rounded-lg p-1.5 transition"
        @click="toggleTheme"
        :aria-label="isDark ? 'เปลี่ยนเป็นโหมดสว่าง' : 'เปลี่ยนเป็นโหมดมืด'"
      >
        <i v-if="isDark" class="fa-solid fa-sun text-[18px]"></i>
        <i v-else class="fa-solid fa-moon text-[18px]"></i>
      </button>

      <div ref="notificationsRef" class="relative">
        <button
          type="button"
          class="relative text-gray-600 hover:text-gray-900 bg-gray-100 dark:text-gray-400 dark:hover:text-white dark:bg-gray-800 rounded-lg p-1.5 transition"
          @click="toggleNotifications"
          aria-haspopup="menu"
          :aria-expanded="notificationsOpen"
        >
          <i class="fa-solid fa-bell text-[18px]"></i>
          <span
            v-if="notifications.some((n) => n.unread)"
            class="absolute top-0.5 right-0.5 w-2 h-2 bg-blue-500 rounded-full"
          />
        </button>

        <div
          v-if="notificationsOpen"
          class="absolute right-0 mt-2 w-80 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 shadow-lg z-50 overflow-hidden"
          role="menu"
        >
          <div
            class="px-3 py-2 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between"
          >
            <p class="text-sm font-semibold text-gray-900 dark:text-white">
              แจ้งเตือน
            </p>
            <button
              type="button"
              class="text-xs text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
              @click="markAllNotificationsRead"
            >
              อ่านทั้งหมด
            </button>
          </div>

          <div class="max-h-80 overflow-auto">
            <button
              v-for="n in notifications"
              :key="n.id"
              type="button"
              class="w-full text-left px-3 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-900 transition flex gap-3"
              @click="markNotificationRead(n.id)"
            >
              <span
                class="mt-1 w-2 h-2 rounded-full flex-shrink-0"
                :class="n.unread ? 'bg-blue-500' : 'bg-transparent'"
              />
              <span class="min-w-0 flex-1">
                <span class="flex items-center justify-between gap-3">
                  <span
                    class="text-sm font-medium truncate"
                    :class="
                      n.unread
                        ? 'text-gray-900 dark:text-white'
                        : 'text-gray-700 dark:text-gray-300'
                    "
                  >
                    {{ n.title }}
                  </span>
                  <span class="text-xs text-gray-500 dark:text-gray-400 flex-shrink-0">
                    {{ n.time }}
                  </span>
                </span>
                <span class="block text-xs text-gray-500 dark:text-gray-400 truncate">
                  {{ n.description }}
                </span>
              </span>
            </button>
          </div>

          <div class="px-3 py-2 border-t border-gray-200 dark:border-gray-800">
            <button
              type="button"
              class="w-full rounded-lg bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 text-sm py-2 transition"
              @click="closeNotifications"
            >
              ปิด
            </button>
          </div>
        </div>
      </div>
      <div ref="profileRef" class="relative">
        <button
          type="button"
          class="flex items-center justify-center w-9 h-9 rounded-full bg-gray-100 text-gray-600 hover:text-gray-900 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:text-white dark:hover:bg-gray-700 transition"
          @click="toggleMenu"
          aria-haspopup="menu"
          :aria-expanded="menuOpen"
        >
          <i class="fa-solid fa-circle-user text-[24px]"></i>
        </button>

        <div
          v-if="menuOpen"
          class="absolute right-0 mt-2 w-80 rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 shadow-2xl z-50 overflow-hidden"
          role="menu"
        >
          <div class="px-5 py-6 text-center">
            <div class="mx-auto w-20 h-20 rounded-full bg-blue-600/10 p-1 mb-3">
              <div class="w-full h-full rounded-full bg-white dark:bg-gray-900 flex items-center justify-center">
                <span class="text-2xl font-bold text-blue-600">
                  {{ (props.user.fullName || '-').charAt(0) }}
                </span>
              </div>
            </div>

            <p class="text-[15px] font-bold text-gray-900 dark:text-white">
              {{ props.user.fullName }}
            </p>
            <p class="text-[12px] text-gray-500 dark:text-gray-400">
              {{ props.user.employeeId }} <span v-if="props.user.username">({{ props.user.username }})</span>
            </p>

            <div class="mt-2 flex items-center justify-center gap-2 flex-wrap">
              <span
                class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 text-[10px] font-semibold"
              >
                <i class="fa-solid fa-briefcase"></i>
                {{ props.user.position }}
              </span>
              <span
                class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200 text-[10px] font-semibold"
              >
                <i class="fa-solid fa-user-shield"></i>
                {{ props.user.role }}
              </span>
            </div>

            <p v-if="props.user.department" class="text-[10px] mt-2 text-gray-500 dark:text-gray-400">
              ( {{ props.user.department }} )
            </p>
          </div>

          <div class="border-t border-gray-200 dark:border-gray-800" />

          <div class="p-2">
            <button
              type="button"
              class="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-[13px] font-medium transition-colors hover:bg-gray-50 dark:hover:bg-gray-900/40 text-left"
              style="color: var(--color-text-secondary)"
              @click="openEditProfile"
            >
              <div class="w-8 h-8 rounded-lg bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
                <i class="fa-solid fa-user-pen text-blue-600 dark:text-blue-300"></i>
              </div>
              แก้ไขข้อมูลโปรไฟล์
            </button>

            <div v-if="props.user.role === 'super_admin'">
              <button
                type="button"
                class="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-[13px] font-medium transition-colors hover:bg-gray-50 dark:hover:bg-gray-900/40 text-left"
                style="color: var(--color-text-secondary)"
                @click="toggleSwitch"
              >
                <div class="w-8 h-8 rounded-lg bg-purple-50 dark:bg-purple-900/20 flex items-center justify-center">
                  <i class="fa-solid fa-right-left text-purple-700 dark:text-purple-300"></i>
                </div>
                สลับระบบ
                <i
                  class="fa-solid fa-chevron-down text-[10px] ml-auto transition-transform duration-200"
                  :class="{ 'rotate-180': switchOpen }"
                  style="color: var(--color-text-muted)"
                ></i>
              </button>

              <div v-if="switchOpen" class="px-4 pb-2">
                <button
                  type="button"
                  class="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-[13px] font-medium transition-colors hover:bg-gray-50 dark:hover:bg-gray-900/40 text-left"
                  style="color: var(--color-text-secondary)"
                  @click="goToStoreSystem(); closeMenu()"
                >
                  <div class="w-7 h-7 rounded-lg bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center">
                    <i class="fa-solid fa-warehouse text-blue-700 dark:text-blue-300"></i>
                  </div>
                  ไป ระบบคลัง
                </button>
              </div>
            </div>

            <button
              type="button"
              class="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-[13px] font-medium transition-colors hover:bg-red-50 dark:hover:bg-red-900/10 text-left text-red-600 dark:text-red-300"
              @click="emit('logout'); closeMenu()"
            >
              <div class="w-8 h-8 rounded-lg bg-red-50 dark:bg-red-900/20 flex items-center justify-center">
                <i class="fa-solid fa-right-from-bracket"></i>
              </div>
              ออกจากระบบ
            </button>
          </div>

          <div
            class="px-5 py-3 border-t border-gray-200 dark:border-gray-800 text-center text-[10px] text-gray-500 dark:text-gray-400"
          >
            เข้าสู่ระบบเมื่อ: {{ new Date().toLocaleDateString('th-TH') }}
          </div>
        </div>
      </div>
    </div>

    <ProfileEditSidebar
      :show="showEditProfile"
      @close="showEditProfile = false"
    />
  </header>
</template>
