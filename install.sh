#!/usr/bin/env bash
# 3DPartHub remote installer.
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/liaoweixiang2024-blip/3DPartHub/main/install.sh | bash

set -e

DEPLOY_URL="${DEPLOY_URL:-https://raw.githubusercontent.com/liaoweixiang2024-blip/3DPartHub/main/deploy.sh}"

if [ -f ./deploy.sh ]; then
  bash ./deploy.sh "$@"
  exit $?
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "错误: 未找到 curl。请先安装 curl，或下载 deploy.sh 后执行。"
  exit 1
fi

curl -fsSL "$DEPLOY_URL" | bash -s -- "$@"
