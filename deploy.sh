#!/usr/bin/env bash
# ============================================================================
# deploy.sh — build แล้วส่งขึ้น pr.tdlmc.com
#
# เดิม deploy ผ่าน GitHub Actions → GitHub Pages (.github/workflows/deploy.yml)
# ย้ายมา VPS ของบริษัทเมื่อ 2 ก.ย. 2026 เพราะ:
#   - GitHub Pages บังคับให้ repo เป็น public — repo นี้เคยมีรหัส TRCloud
#     หลุดอยู่ในคอมเมนต์และในไฟล์ Ex.txt
#   - proxy เดิมอยู่ *.deno.net ซึ่งอยู่ใน class โดเมนที่ DPI ปลายทางบล็อกเป็นชุด
#   - อยู่โดเมนตัวเองแล้วได้ด่าน login ของ acct-auth ครอบให้ด้วย
#
# ใช้: ./deploy.sh [--allow-dirty]
# ============================================================================
set -uo pipefail
cd "$(dirname "$0")" || exit 1

HOST=tdl@tdlmc.com
DEST=/var/www/pr
ALLOW_DIRTY=0
[ "${1:-}" = "--allow-dirty" ] && ALLOW_DIRTY=1

# ── ค่าที่ต่างจาก .env ของเครื่อง dev ─────────────────────────────────────
# ไม่ใช่ความลับ (เป็นแค่ที่อยู่) จึงเขียนไว้ตรงนี้ได้ ค่าลับอื่นมาจาก .env
export VITE_BASE_PATH=/
export VITE_TRCLOUD_PROXY_BASE=https://pr.tdlmc.com/trc
export VITE_USE_MOCK_DB=false   # mock = localStorage ต่อ browser ไม่แชร์ข้าม user

echo "════ ตรวจก่อน build ════"
DIRTY="$(git status --porcelain)"
if [ -n "$DIRTY" ]; then
  echo "  ✗ working tree ไม่สะอาด — ของที่ deploy จะไม่ตรงกับ commit ไหนเลย"
  echo "$DIRTY" | head -8 | sed 's/^/      /'
  if [ "$ALLOW_DIRTY" -eq 1 ]; then echo "  ⚠️  ข้ามด่านด้วย --allow-dirty"
  else echo "     commit ก่อน หรือใช้ --allow-dirty"; exit 1; fi
else
  echo "  ✓ working tree สะอาด"
fi

SHA="$(git rev-parse HEAD)"
if git ls-remote gitea 2>/dev/null | grep -q "^$SHA"; then
  echo "  ✓ commit $(git rev-parse --short HEAD) อยู่บน Gitea แล้ว"
else
  echo "  ⚠️  commit นี้ยังไม่อยู่บน Gitea — ถ้าเครื่องหาย โค้ดที่รันอยู่หายด้วย"
  echo "     สั่ง: git push gitea $(git rev-parse --abbrev-ref HEAD)"
fi

echo
echo "════ build ════"
npm run build || exit 1
[ -f dist/index.html ] || { echo "  ✗ ไม่มี dist/index.html — build ไม่ได้ผลลัพธ์"; exit 1; }
echo "  ได้ $(find dist -type f | wc -l) ไฟล์ · $(du -sh dist | cut -f1)"

# กันพลาดที่เจอง่าย: ถ้า base path ผิด index.html จะอ้าง /pr-warehouse/assets/...
if grep -q '/pr-warehouse/' dist/index.html; then
  echo "  ✗ dist ยังอ้าง /pr-warehouse/ — VITE_BASE_PATH ไม่ถูกใช้ หยุดก่อนจะได้เว็บจอขาว"
  exit 1
fi

echo
echo "════ ส่งขึ้น $HOST:$DEST ════"
# --delete ล้างไฟล์ build เก่าที่ไม่มีในรอบนี้ (ชื่อไฟล์มี hash ไม่ล้างจะกองไปเรื่อย ๆ)
rsync -az --delete --info=stats1 dist/ "$HOST:$DEST/" || exit 1

echo
echo "════ ยืนยันจากภายนอก ════"
CODE="$(curl -s -o /dev/null -w '%{http_code}' https://pr.tdlmc.com/)"
case "$CODE" in
  200) echo "  ✓ pr.tdlmc.com ตอบ 200 (เข้าได้โดยไม่ต้องล็อกอิน — ตรวจด่านด้วย)" ;;
  302|303) echo "  ✓ ตอบ $CODE = เด้งไปหน้า login ตามที่ตั้งไว้" ;;
  *) echo "  ⚠️  ตอบ $CODE" ;;
esac
