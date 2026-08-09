#!/bin/bash
# Ydisks 批量转存助手 —— macOS 首次打开修复脚本
#
# 作用：本项目未购买 Apple 开发者证书、未做公证，从浏览器下载的 DMG 安装后
#       首次打开会被 Gatekeeper 拦截（提示「无法验证开发者」或「已损坏」）。
#       本脚本清除 com.apple.quarantine 隔离属性，使应用可正常打开。
#
# 用法：把应用从 DMG 拖到「应用程序」后，双击本文件即可。
#       若双击无反应，在终端执行  chmod +x ~/Downloads/macos-unblock.command  后再双击，
#       或直接使用 README 里的 xattr 一行命令。
#
# 该脚本随 GitHub Release 一并提供（与 .dmg 同一发布页）。

set -u

APP_NAME="Ydisks批量转存助手"

find_app() {
  for candidate in \
    "/Applications/${APP_NAME}.app" \
    "$HOME/Applications/${APP_NAME}.app"; do
    [ -d "$candidate" ] && { printf '%s' "$candidate"; return 0; }
  done
  return 1
}

APP_PATH="$(find_app)" || true

if [ -z "${APP_PATH:-}" ]; then
  echo "=============================================="
  echo " 未找到 ${APP_NAME}.app"
  echo "=============================================="
  echo "请先打开 DMG，把 ${APP_NAME} 拖到「应用程序」文件夹，再运行本脚本。"
  echo "若应用装在别处，可直接在终端运行："
  echo "  xattr -dr com.apple.quarantine \"/路径/到/${APP_NAME}.app\""
  echo
  read -n 1 -s -r -p "按任意键关闭本窗口..."
  exit 1
fi

echo "找到应用：$APP_PATH"
echo "正在清除隔离属性（com.apple.quarantine）..."
xattr -dr com.apple.quarantine "$APP_PATH" 2>/dev/null || true
echo "完成，正在打开 ${APP_NAME} ..."
open "$APP_PATH"
echo
echo "可以关闭本窗口了。"
read -n 1 -s -r -p "按任意键关闭..."
