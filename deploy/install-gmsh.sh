#!/bin/bash
# gmsh SDK 一键安装（宿主下载 + readelf 依赖闭包打包 + compose 挂载 + 容器验证）
# 仓库源：https://github.com/liaoweixiang2024-blip/3DPartHub/blob/main/deploy/install-gmsh.sh
# 用法：
#   bash /opt/3dparthub/install-gmsh.sh              # 安装/修复默认版本（幂等可重跑）
#   GMSH_VER=4.14.1 bash /opt/3dparthub/install-gmsh.sh  # 升级到指定版本
# 背景：api 容器是 node:24-alpine（musl），跑不了 glibc 二进制。
# 方案（已在本机 alpine 容器端到端实测：STEP 读入+网格化 OK）：
#   1) glibc loader 单独挂载到 /lib64/ld-linux-x86-64.so.2（内核 PT_INTERP 正常启动
#      ——显式 `ld.so 程序` 调用在部分环境段错误，不可用）
#   2) wrapper 用 LD_LIBRARY_PATH 指向挂载进来的 glibc 库目录
#   3) 依赖库用 readelf 递归解析 NEEDED 闭包收集（手写清单必漏：实测漏过
#      libgomp/libxcb/libbz2）
# server 端探测路径 /usr/local/host-bin/gmsh（server/src/services/gmshFallback.ts）
set -euo pipefail

VER="${GMSH_VER:-4.13.1}"
SO_VER="${VER%.*}"          # 4.13.1 -> 4.13（libgmsh.so 版本号）
SDK=/usr/local/lib/gmsh-sdk
DEPS=/usr/local/lib/gmsh-deps

echo "==> [1/6] 下载安装 gmsh SDK ${VER}"
if [ -x /usr/local/bin/gmsh.real ] && [ -f "$SDK/libgmsh.so.${SO_VER}" ]; then
  echo "    已安装 ${VER}，跳过"
else
  cd /tmp
  curl -fLO "https://gmsh.info/bin/Linux/gmsh-${VER}-Linux64-sdk.tgz"
  rm -rf "gmsh-${VER}-Linux64-sdk"
  tar xzf "gmsh-${VER}-Linux64-sdk.tgz"
  rm -f /usr/local/bin/gmsh.real
  install -m 755 "gmsh-${VER}-Linux64-sdk/bin/gmsh" /usr/local/bin/gmsh.real
  rm -rf "$SDK"                 # 清掉旧版本残留 so
  mkdir -p "$SDK"
  cp -a "gmsh-${VER}-Linux64-sdk/lib/." "$SDK/"
fi

echo "==> [2/6] 收集依赖闭包（readelf 递归解析 NEEDED）"
command -v readelf >/dev/null 2>&1 || apt-get install -y binutils >/dev/null 2>&1 || {
  echo "    !! 需要 readelf，请先执行: apt-get install -y binutils" >&2; exit 1; }
mkdir -p "$DEPS"
export SDK DEPS
collect_deps() {
  readelf -d "$1" 2>/dev/null | grep NEEDED | sed -e 's/.*\[\(.*\)\]$/\1/' | while read -r name; do
    [ -f "$DEPS/$name" ] && continue
    for dir in "$SDK" /lib/x86_64-linux-gnu /usr/lib/x86_64-linux-gnu /lib64 /usr/lib; do
      if [ -e "$dir/$name" ]; then
        cp -L "$dir/$name" "$DEPS/"
        collect_deps "$DEPS/$name"
        break
      fi
    done
  done
}
collect_deps /usr/local/bin/gmsh.real
cp -L /lib64/ld-linux-x86-64.so.2 "$DEPS/"
echo "    依赖闭包 $(ls "$DEPS" | wc -l) 个文件"

echo "==> [3/6] 写入 wrapper（LD_LIBRARY_PATH 指挂载库目录；loader 由 /lib64 挂载提供）"
printf '%s\n' \
  '#!/bin/sh' \
  'export LD_LIBRARY_PATH="/usr/local/host-lib/gmsh-sdk:/usr/local/host-lib/gmsh-deps:$LD_LIBRARY_PATH"' \
  'exec /usr/local/host-bin/gmsh.real "$@"' \
  > /usr/local/bin/gmsh
chmod 755 /usr/local/bin/gmsh

echo "==> [4/6] 宿主机验证（同时校验依赖闭包自包含性）"
if LD_LIBRARY_PATH="$SDK:$DEPS" /usr/local/bin/gmsh.real -version 2>&1; then
  :
else
  echo "    !! 依赖闭包不完整（宿主缺库）。Ubuntu 下执行后重跑本脚本：" >&2
  echo "       apt-get install -y libglu1-mesa libgl1 libgomp1 libxcb1 libbz2-1.0 libfontconfig1 libxrender1 libxcursor1 libxft2 libxinerama1 libxext6" >&2
  exit 1
fi

echo "==> [5/6] 配置 docker-compose 挂载（五条：bin/real/sdk/deps + loader→/lib64）"
cd /opt/3dparthub
if grep -q '/usr/local/host-lib/gmsh-deps' docker-compose.yml; then
  echo "    挂载已存在，跳过"
else
  BAK="docker-compose.yml.bak.$(date +%Y%m%d%H%M%S)"
  cp -a docker-compose.yml "$BAK"
  MOUNTS='      - /usr/local/bin/gmsh:/usr/local/host-bin/gmsh:ro\n      - /usr/local/bin/gmsh.real:/usr/local/host-bin/gmsh.real:ro\n      - /usr/local/lib/gmsh-sdk:/usr/local/host-lib/gmsh-sdk:ro\n      - /usr/local/lib/gmsh-deps:/usr/local/host-lib/gmsh-deps:ro\n      - /usr/local/lib/gmsh-deps/ld-linux-x86-64.so.2:/lib64/ld-linux-x86-64.so.2:ro'
  # 注意：sed 插入必须用 s 命令（a 命令会剥掉首行缩进）；第二锚点必须整行匹配
  #（api 与 web 都有 static-data 挂载，web 行带 :ro 后缀，子串匹配会误插 web 服务）
  if grep -q '# - /usr/bin/gmsh:/usr/local/host-bin/gmsh:ro' docker-compose.yml; then
    sed -i "s|# - /usr/bin/gmsh:/usr/local/host-bin/gmsh:ro|&\n$MOUNTS|" docker-compose.yml
  elif grep -q '^      - static-data:/app/static$' docker-compose.yml; then
    sed -i "s|^      - static-data:/app/static$|&\n$MOUNTS|" docker-compose.yml
  else
    echo "    !! 未找到插入锚点，请手动把五条 gmsh 挂载加入 api 服务 volumes 段后重跑" >&2
    exit 1
  fi
  if docker-compose config >/dev/null 2>&1; then
    echo "    已插入五条挂载（原文件备份为 $BAK）"
  else
    cp -a "$BAK" docker-compose.yml
    echo "    !! compose 校验失败，已恢复原文件" >&2
    exit 1
  fi
fi

echo "==> [6/6] 重建 api 容器并验证"
docker-compose up -d --force-recreate api
sleep 3
docker exec 3dparthub-api /usr/local/host-bin/gmsh -version
echo "✅ 完成：容器内 gmsh 已可用，后台「修复预览（gmsh）」按钮将亮起"
