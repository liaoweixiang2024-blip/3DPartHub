#!/bin/sh
set -eu

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPORT_VERIFIER="$ROOT_DIR/scripts/verify-deploy-health-report.mjs"
MAX_AGE_HOURS="${MAX_AGE_HOURS:-24}"
SUMMARY_FILE="${SUMMARY_FILE:-deploy-health-acceptance.md}"
SUMMARY_JSON_FILE="${SUMMARY_JSON_FILE:-deploy-health-acceptance.json}"
WRITE_SUMMARY=1
WRITE_SUMMARY_JSON=1
ALLOW_WARNINGS=0
ALLOW_REPORT_ONLY=0
ALLOW_MISSING_SIDECAR=0
REQUIRE_FINAL_CONCLUSION=1
REQUIRE_TEXT=""
INPUT=""

usage() {
  cat <<'EOF'
3DPartHub 生产部署证据验收

用法:
  sh scripts/verify-production-deploy-evidence.sh deploy-evidence-YYYYMMDD-HHMMSS.tar.gz
  sh scripts/verify-production-deploy-evidence.sh deploy-health-report.json --require-text deploy-health-report.txt --allow-report-only

参数:
  --max-age-hours HOURS  报告最大有效小时数，默认 24
  --summary FILE         生成 Markdown 验收摘要，默认 deploy-health-acceptance.md
  --summary-json FILE    生成 JSON 验收摘要，默认 deploy-health-acceptance.json
  --no-summary           不生成验收摘要文件
  --no-summary-json      不生成 JSON 验收摘要
  --allow-warnings       临时接受只有警告、没有失败项的报告
  --allow-report-only    允许只验收 JSON/TXT 报告；默认要求完整证据包
  --allow-missing-sidecar
                         允许证据包缺少同名 .tar.gz.sha256；默认要求回传
  --require-text FILE    同时校验纯文本报告
  -h, --help             显示帮助

说明:
  默认要求传入完整 deploy-evidence-*.tar.gz 证据包或完整证据目录；这样会同时
  校验 manifest、证据文件哈希、同名 .tar.gz.sha256、版本/镜像追踪、
  Compose 状态、API 日志、Docker 概览，并拒绝 .env、符号链接、特殊文件和
  不安全路径。默认还会强制 productionEvidence.finalConclusionReady=true，
  因此退出码可作为最终生产证据闭环判断。只有在无法回传完整证据包时才使用
  --allow-report-only，且必须同时传入 --require-text；只有在旧证据包遗失摘要
  文件时才使用 --allow-missing-sidecar。
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --max-age-hours)
      shift
      MAX_AGE_HOURS="${1:-}"
      ;;
    --summary)
      shift
      SUMMARY_FILE="${1:-}"
      WRITE_SUMMARY=1
      ;;
    --summary-json)
      shift
      SUMMARY_JSON_FILE="${1:-}"
      WRITE_SUMMARY_JSON=1
      ;;
    --no-summary)
      WRITE_SUMMARY=0
      WRITE_SUMMARY_JSON=0
      ;;
    --no-summary-json)
      WRITE_SUMMARY_JSON=0
      ;;
    --allow-warnings)
      ALLOW_WARNINGS=1
      REQUIRE_FINAL_CONCLUSION=0
      ;;
    --allow-report-only)
      ALLOW_REPORT_ONLY=1
      REQUIRE_FINAL_CONCLUSION=0
      ;;
    --allow-missing-sidecar)
      ALLOW_MISSING_SIDECAR=1
      REQUIRE_FINAL_CONCLUSION=0
      ;;
    --require-text)
      shift
      REQUIRE_TEXT="${1:-}"
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    -*)
      echo "未知参数: $1" >&2
      usage >&2
      exit 2
      ;;
    *)
      if [ -n "$INPUT" ]; then
        echo "只能指定一个证据包或报告文件: $1" >&2
        usage >&2
        exit 2
      fi
      INPUT="$1"
      ;;
  esac
  shift
done

if [ -z "$INPUT" ]; then
  usage >&2
  exit 2
fi
if [ -z "$MAX_AGE_HOURS" ]; then
  echo "--max-age-hours 不能为空" >&2
  exit 2
fi
case "$INPUT" in
  *.tar.gz|*.tgz)
    if [ ! -f "$INPUT" ]; then
      echo "证据包不存在: $INPUT" >&2
      exit 2
    fi
    if [ "$ALLOW_MISSING_SIDECAR" != "1" ] && [ ! -f "${INPUT}.sha256" ]; then
      echo "生产验收默认要求同时回传证据包摘要: ${INPUT}.sha256" >&2
      echo "请从服务器一起回传同名 .tar.gz.sha256；只有旧证据包遗失摘要时才添加 --allow-missing-sidecar。" >&2
      exit 2
    fi
    ;;
  *)
    if [ -d "$INPUT" ]; then
      :
    elif [ "$ALLOW_REPORT_ONLY" != "1" ]; then
      echo "生产验收默认要求完整 deploy-evidence 证据包或证据目录。" >&2
      echo "如果只能回传 JSON/TXT 报告，请显式添加 --allow-report-only。" >&2
      exit 2
    elif [ ! -f "$INPUT" ]; then
      echo "JSON 报告不存在: $INPUT" >&2
      exit 2
    elif [ -z "$REQUIRE_TEXT" ]; then
      echo "报告模式必须同时提供纯文本报告: --require-text deploy-health-report.txt" >&2
      exit 2
    fi
    ;;
esac
if [ "$WRITE_SUMMARY" = "1" ] && [ -z "$SUMMARY_FILE" ]; then
  echo "--summary 不能为空" >&2
  exit 2
fi
if [ "$WRITE_SUMMARY_JSON" = "1" ] && [ -z "$SUMMARY_JSON_FILE" ]; then
  echo "--summary-json 不能为空" >&2
  exit 2
fi
if [ -n "$REQUIRE_TEXT" ] && [ ! -f "$REQUIRE_TEXT" ]; then
  echo "纯文本报告不存在: $REQUIRE_TEXT" >&2
  exit 2
fi

set -- "$INPUT" --max-age-hours "$MAX_AGE_HOURS"
if [ "$ALLOW_WARNINGS" = "1" ]; then
  set -- "$@" --allow-warnings
fi
if [ -n "$REQUIRE_TEXT" ]; then
  set -- "$@" --require-text "$REQUIRE_TEXT"
fi
if [ "$REQUIRE_FINAL_CONCLUSION" = "1" ]; then
  set -- "$@" --require-final-conclusion
fi
if [ "$WRITE_SUMMARY" = "1" ]; then
  set -- "$@" --summary "$SUMMARY_FILE"
fi
if [ "$WRITE_SUMMARY_JSON" = "1" ]; then
  set -- "$@" --summary-json "$SUMMARY_JSON_FILE"
fi

exec node "$REPORT_VERIFIER" "$@"
