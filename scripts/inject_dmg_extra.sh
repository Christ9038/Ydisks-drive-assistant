#!/bin/bash
# 把 macos-unblock.command 注入到 Tauri 生成的 DMG 根目录。
#
# 背景：Tauri v2 没有内置配置把额外文件放进 DMG 根目录（bundle.macOS.files /
#       bundle.resources 都是塞进 .app/Contents）。本脚本在 Tauri 构建出只读
#       压缩 DMG 之后，用 hdiutil 转读写 -> 挂载注入 .command -> 转回压缩只读，
#       使 DMG 打开后用户能直接看到并双击修复脚本。
#
# 用法：inject_dmg_extra.sh <dmg目录> <要注入的文件...>
#   例：inject_dmg_extra.sh src-tauri/target/release/bundle/dmg scripts/macos-unblock.command
#
# 仅 macOS 可用（依赖 hdiutil）。注入完成后原地覆盖原 DMG。

set -euo pipefail

DMG_DIR="$1"
shift
EXTRA_FILES=("$@")

if [ "$(uname)" != "Darwin" ]; then
  echo "inject_dmg_extra.sh: 仅 macOS 可用，跳过。" >&2
  exit 0
fi

if [ ! -d "$DMG_DIR" ]; then
  echo "inject_dmg_extra.sh: DMG 目录不存在: $DMG_DIR" >&2
  exit 1
fi

shopt -s nullglob
DMGS=("$DMG_DIR"/*.dmg)
if [ "${#DMGS[@]}" -eq 0 ]; then
  echo "inject_dmg_extra.sh: 未找到 DMG，跳过。" >&2
  exit 0
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

for dmg in "${DMGS[@]}"; do
  echo "==> 注入额外文件到 $(basename "$dmg")"
  base="${dmg%.dmg}"
  rw="$WORK/rw.dmg"
  final="$WORK/final.dmg"

  # 1. 只读压缩 DMG -> 读写镜像
  hdiutil convert "$dmg" -format UDRW -o "$rw" -quiet
  # 2. 挂载读写镜像（固定挂载点，避免空格/中文卷名导致路径解析问题）
  mnt="$WORK/mnt"
  hdiutil attach "$rw" -nobrowse -noautoopen -mountpoint "$mnt" -quiet
  # 3. 拷入额外文件，保留执行位
  for f in "${EXTRA_FILES[@]}"; do
    cp "$f" "$mnt/"
  done
  # 4. 卸载并转回压缩只读 DMG
  hdiutil detach "$mnt" -quiet
  hdiutil convert "$rw" -format UDZO -o "$final" -quiet
  # 5. 原地覆盖原 DMG
  mv -f "$final" "$dmg"
  echo "    完成。"
done

echo "==> 所有 DMG 注入完成。"
