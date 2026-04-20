#!/bin/bash

set -e

DIST_DIR="./dist"
PACKAGE_NAME="model-dist.tar.gz"

echo "===== 构建项目 ====="
npm run build

echo ""
echo "===== 打包 dist 目录 ====="
tar -czf ${PACKAGE_NAME} -C ${DIST_DIR} .

FILE_SIZE=$(du -h ${PACKAGE_NAME} | cut -f1)
echo ""
echo "===== 打包完成 ====="
echo "文件: ${PACKAGE_NAME} (${FILE_SIZE})"
echo ""
echo "===== 部署步骤 ====="
echo "1. 在宝塔面板 [文件] 中上传 ${PACKAGE_NAME} 到 /www/wwwroot/model/"
echo "2. 在宝塔终端执行:"
echo "   cd /www/wwwroot/model && tar -xzf ${PACKAGE_NAME} && rm ${PACKAGE_NAME}"
echo "3. 在宝塔 [网站] 中创建站点，配置参考 nginx.conf"
echo ""
echo "或者用 scp 直接传:"
echo "   scp ${PACKAGE_NAME} root@YOUR_SERVER_IP:/www/wwwroot/model/"
