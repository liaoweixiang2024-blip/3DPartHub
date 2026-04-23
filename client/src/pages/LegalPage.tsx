import { useParams, Link } from "react-router-dom";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import Icon from "../components/shared/Icon";

const PRIVACY = [
  { title: "信息收集", content: "我们收集您主动提供的信息，包括：注册账号时的用户名和邮箱、上传的 3D 模型文件及其元数据、评论和反馈内容。系统会自动收集：登录时间和 IP 地址（用于安全审计）、浏览器类型和设备信息（用于优化体验）。" },
  { title: "信息使用", content: "您的信息仅用于：提供和维护平台服务、处理模型上传和格式转换、改善用户体验和平台功能、安全防护和异常检测。我们不会将您的个人信息出售或分享给第三方。" },
  { title: "数据存储", content: "所有数据存储在您部署的服务器上，由您完全掌控。数据通过数据库加密存储，文件通过操作系统权限保护。平台开发者无法访问您的数据。" },
  { title: "数据安全", content: "我们采取以下措施保护您的数据：所有 API 通信使用 HTTPS 加密、密码使用 bcrypt 哈希存储、JWT 令牌认证和授权、定期安全审计和漏洞修复。" },
  { title: "Cookie 使用", content: "平台使用本地存储（LocalStorage）保存：登录状态和偏好设置、主题和界面配置。不使用第三方跟踪 Cookie。" },
  { title: "数据删除", content: "您可以随时：删除自己上传的模型和评论、联系管理员删除您的账号和所有关联数据。删除操作不可恢复。" },
  { title: "政策更新", content: "我们可能会不时更新本隐私声明。重大变更会通过平台公告通知用户。继续使用平台即表示您同意更新后的政策。" },
];

const TERMS = [
  { title: "服务说明", content: "3DPartHub 是一个开源的 3D 零件模型管理平台，提供模型上传、格式转换、在线预览和团队协作功能。平台按「现状」提供服务，不保证服务的持续可用性。" },
  { title: "用户账号", content: "您需要注册账号才能使用完整功能。您应当：提供真实准确的注册信息、妥善保管账号密码、对账号下的所有活动负责。如发现未授权使用，请立即通知管理员。" },
  { title: "用户内容", content: "您保留对上传内容的所有权。您声明并保证：拥有上传内容的合法权利、内容不侵犯他人的知识产权、内容不违反法律法规。平台有权删除违规内容。" },
  { title: "使用规范", content: "您不得：上传恶意软件或病毒、尝试未授权访问系统、干扰平台正常运行、利用平台从事违法活动。违反规定的账号将被暂停或删除。" },
  { title: "免责声明", content: "平台不承担以下责任：因网络故障导致的数据丢失、模型格式转换的精度损失、因不可抗力导致的服务中断。建议定期使用备份功能保存数据。" },
  { title: "知识产权", content: "3DPartHub 基于 MIT 开源许可证发布。平台源代码可自由使用、修改和分发。用户上传的内容版权归原所有者所有。" },
  { title: "终止服务", content: "管理员有权暂停或终止违反使用条款的账号。您可以在管理员的协助下删除您的账号。账号删除后，相关数据将从服务器永久移除。" },
];

export default function LegalPage() {
  const { type } = useParams<{ type: string }>();
  const isPrivacy = type === "privacy";
  useDocumentTitle(isPrivacy ? "隐私声明" : "用户协议");

  const sections = isPrivacy ? PRIVACY : TERMS;

  return (
    <div className="min-h-screen bg-surface">
      <div className="max-w-2xl mx-auto px-4 py-12">
        <Link to="/" className="inline-flex items-center gap-1 text-sm text-on-surface-variant hover:text-on-surface transition-colors mb-8">
          <Icon name="arrow_back" size={16} />
          返回首页
        </Link>

        <div className="flex gap-3 mb-8">
          <Link
            to="/legal/privacy"
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
              isPrivacy ? "bg-primary-container text-on-primary" : "bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest"
            }`}
          >
            隐私声明
          </Link>
          <Link
            to="/legal/terms"
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
              !isPrivacy ? "bg-primary-container text-on-primary" : "bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest"
            }`}
          >
            用户协议
          </Link>
        </div>

        <h1 className="text-2xl font-headline font-bold text-on-surface mb-2">
          {isPrivacy ? "隐私声明" : "用户协议"}
        </h1>
        <p className="text-sm text-on-surface-variant mb-8">
          最后更新：2026 年 4 月
        </p>

        <div className="space-y-6">
          {sections.map((section, i) => (
            <div key={i} className="bg-surface-container-low rounded-lg border border-outline-variant/10 p-5">
              <h2 className="text-base font-bold text-on-surface mb-2">
                {i + 1}. {section.title}
              </h2>
              <p className="text-sm text-on-surface-variant leading-relaxed">
                {section.content}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
