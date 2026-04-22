#!/bin/bash
# ===== 3DPartHub 镜像构建与推送脚本 =====
#
# 使用方式:
#   ./deploy.sh build        — 本地构建镜像
#   ./deploy.sh push         — 推送镜像到 ghcr.io
#   ./deploy.sh build-push   — 构建 + 推送
#
# 前置条件:
#   1. docker login ghcr.io -u liaoweixiang2024-blip -p <GITHUB_PAT>
#      (PAT 需要 write:packages 权限)

set -e

REGISTRY="ghcr.io/liaoweixiang2024-blip"
API_IMAGE="${REGISTRY}/3dparthub-api"
WEB_IMAGE="${REGISTRY}/3dparthub-web"
TAG="${1:-latest}"

# 如果第一个参数是 build/push/build-push，用第二个参数作为 tag
ACTION="$1"
TAG="${2:-latest}"

if [ -z "$ACTION" ]; then
  echo "用法: $0 <build|push|build-push> [tag]"
  echo "  $0 build          — 构建镜像 (tag=latest)"
  echo "  $0 push v1.4.0    — 推送镜像 (tag=v1.4.0)"
  echo "  $0 build-push     — 构建+推送 (tag=latest)"
  exit 1
fi

build() {
  echo "🔧 构建 API 镜像..."
  docker build -t "${API_IMAGE}:${TAG}" -t "${API_IMAGE}:latest" ./server

  echo "🔧 构建 Web 镜像..."
  docker build -t "${WEB_IMAGE}:${TAG}" -t "${WEB_IMAGE}:latest" ./client

  echo "✅ 构建完成"
  docker images | grep 3dparthub
}

push() {
  echo "📤 推送 API 镜像..."
  docker push "${API_IMAGE}:${TAG}"
  [ "$TAG" != "latest" ] && docker push "${API_IMAGE}:latest"

  echo "📤 推送 Web 镜像..."
  docker push "${WEB_IMAGE}:${TAG}"
  [ "$TAG" != "latest" ] && docker push "${WEB_IMAGE}:latest"

  echo "✅ 推送完成"
}

case "$ACTION" in
  build)       build ;;
  push)        push ;;
  build-push)  build && push ;;
  *)
    echo "未知操作: $ACTION"
    echo "可用: build, push, build-push"
    exit 1
    ;;
esac
