#!/bin/bash

set -e

DIST_DIR="./dist"
SERVER_USER="root"
SERVER_IP="YOUR_SERVER_IP"
SERVER_PATH="/www/wwwroot/model"

echo "===== 1. 构建项目 ====="
npm run build

echo ""
echo "===== 2. 上传到服务器 ====="
echo "目标: ${SERVER_USER}@${SERVER_IP}:${SERVER_PATH}"
echo ""

# 方式一: scp (需要配置 SSH 密钥)
# scp -r ${DIST_DIR}/* ${SERVER_USER}@${SERVER_IP}:${SERVER_PATH}/

# 方式二: rsync (推荐，增量同步)
rsync -avz --delete ${DIST_DIR}/ ${SERVER_USER}@${SERVER_IP}:${SERVER_PATH}/

echo ""
echo "===== 部署完成 ====="
echo "请确保宝塔面板中已配置 Nginx 站点，根目录指向 ${SERVER_PATH}"
echo "Nginx 配置参考: nginx.conf"
