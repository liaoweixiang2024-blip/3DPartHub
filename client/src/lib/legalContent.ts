export type LegalSection = {
  title: string;
  content: string;
};

const paragraph = (...items: string[]) => items.join('\n');

export const DEFAULT_LEGAL_UPDATED_AT_ZH = '2026 年 4 月';

export const DEFAULT_PRIVACY_SECTIONS: LegalSection[] = [
  {
    title: '定义与适用主体',
    content: paragraph(
      '本声明所称“本站”或“平台”，是指由部署方用于模型资料管理、产品选型、规格查询、产品图库、询价沟通、工单协作及后台管理的内部业务系统。',
      '本声明所称“用户”，是指注册、登录、访问或使用本站功能的个人，包括普通用户、管理员以及经授权使用本站的其他人员。',
    ),
  },
  {
    title: '适用范围',
    content: paragraph(
      '本声明适用于用户访问和使用本站提供的模型搜索、模型浏览、模型下载、产品选型、规格查询、产品图库、询价沟通、工单处理及后台管理等功能。',
      '本站主要用于企业内部资料管理和业务协作，相关信息的处理应以公司授权范围、岗位职责和业务必要性为边界。',
    ),
  },
  {
    title: '本站处理的信息',
    content: paragraph(
      '为实现账号登录、权限控制、业务协作和安全审计，本站可能处理用户的用户名、邮箱、角色、账号状态、密码哈希、首次登录改密状态、登录凭证、IP 地址、浏览器信息、操作时间及接口访问记录。',
      '用户在使用过程中主动提交或产生的模型文件、STEP/GLB 预览文件、缩略图、模型名称、分类标签、选型参数、询价内容、工单消息、产品图库图片、上传附件、分享链接和下载记录，也属于本站业务数据。',
    ),
  },
  {
    title: '信息使用目的',
    content: paragraph(
      '本站处理相关信息的目的包括身份验证、权限校验、模型检索与预览、文件转换、选型计算、资料分享、下载统计、通知提醒、工单协作、问题排查、性能优化、安全防护和备份恢复。',
      '除法律法规要求、公司授权管理要求或用户明确授权外，本站不会将个人信息用于与业务无关的用途，也不会出售、出租或向无关第三方提供。',
    ),
  },
  {
    title: '权限与访问控制',
    content: paragraph(
      '本站根据用户角色、部门职责和业务需要控制数据可见范围。普通用户通常只能访问被授权的模型、下载记录、个人询价和工单；管理员可根据职责维护用户、模型、分类、选型、日志、下载统计和系统设置等管理数据。',
      '管理员应遵循最小必要原则分配权限，避免过度授权、共享账号或将敏感资料开放给无关人员。',
    ),
  },
  {
    title: '模型、图片与附件资料',
    content: paragraph(
      '模型文件、工程图纸、产品图片、产品图库图片和附件可能包含企业资料、客户资料、产品结构信息或其他敏感内容。用户上传、分享或下载前，应确认其拥有相应权限，并确认资料版本、客户范围和公开级别。',
      '用户对外发送资料前，应根据资料敏感程度谨慎配置分享有效期、下载权限、密码保护和公开预览范围。',
    ),
  },
  {
    title: '日志与安全审计',
    content: paragraph(
      '本站会记录登录、访问、下载、上传、分享、后台修改、异常错误和数据变更等日志，用于账号安全、问题排查、审计追溯、风险识别和防止未授权访问。',
      '安全日志通常不用于评价个人绩效，但在发生异常下载、资料泄露、越权访问、系统攻击或合规调查时，可能作为追溯依据。',
    ),
  },
  {
    title: 'Cookie 与本地存储',
    content: paragraph(
      '本站可能通过 Cookie、本地存储或浏览器缓存保存登录状态、访问令牌、主题偏好、界面配置、搜索状态和临时表单数据，以维持会话并提升使用体验。',
      '本站不使用第三方广告追踪 Cookie。用户清理浏览器缓存后，部分登录状态、界面偏好或未提交表单内容可能被删除。',
    ),
  },
  {
    title: '数据存储、备份与保留',
    content: paragraph(
      '本站数据存储在部署方控制的服务器、数据库、对象存储或文件目录中。系统可能按照配置生成备份文件，用于灾难恢复、迁移、版本回滚和运维排查。',
      '备份文件与正式数据具有同等敏感性，应限制访问、妥善保存并定期清理过期备份。涉及业务审计、下载追溯或安全事件的记录，可能按公司制度保留必要期限。',
    ),
  },
  {
    title: '数据安全措施',
    content: paragraph(
      '本站通过密码哈希、令牌认证、角色权限、接口访问限制、操作日志、静态资源保护、备份校验、安全响应头和异常提示等方式降低数据泄露、越权访问和误操作风险。',
      '部署方仍应结合实际环境启用 HTTPS、强密码策略、最小权限、防火墙、服务器补丁、数据库备份和访问审计等安全措施。',
    ),
  },
  {
    title: '更正、删除与权限调整',
    content: paragraph(
      '用户如需更正账号资料、删除个人相关记录、移除已上传内容或调整访问权限，可以联系管理员处理。',
      '模型、选型、工单、询价、下载记录和操作日志可能涉及业务协作或审计追溯，删除前应确认不会影响公司业务、客户交付或安全调查。备份中的历史数据将在对应保留周期结束后按策略清理。',
    ),
  },
  {
    title: '第三方组件与外部服务',
    content: paragraph(
      '本站可能使用浏览器、模型转换工具、邮件服务、对象存储、数据库、缓存、容器和开源依赖等基础组件。上述组件仅用于支撑本站功能运行，不改变本站对业务数据的管理要求。',
      '如部署方接入外部邮件、对象存储、CDN、监控或备份服务，应根据公司制度评估其数据安全、访问权限和合规要求。',
    ),
  },
  {
    title: '声明更新',
    content: paragraph(
      '当本站功能、部署方式、权限策略或公司管理要求发生变化时，本隐私声明可能相应更新。重大调整建议通过系统公告、内部通知或管理员说明告知用户。',
      '更新后的隐私声明发布后，用户继续使用本站即表示已了解并接受更新后的信息处理方式。',
    ),
  },
];

export const DEFAULT_PRIVACY_SECTIONS_EN: LegalSection[] = [
  {
    title: 'Definitions and Covered Users',
    content: paragraph(
      'In this notice, "this site" or "the platform" means the internal business system deployed for model data management, product selection, specification lookup, product gallery, inquiry communication, ticket collaboration, and administration.',
      'A "user" means any person who registers, logs in, accesses, or uses site features, including regular users, administrators, and other authorized personnel.',
    ),
  },
  {
    title: 'Scope',
    content: paragraph(
      'This notice applies when users access or use model search, model browsing, model downloads, product selection, specification lookup, product gallery, inquiry communication, ticket handling, and administration features provided by this site.',
      'This site is mainly intended for internal company data management and business collaboration. Information processing should stay within company authorization, job responsibilities, and business necessity.',
    ),
  },
  {
    title: 'Information Processed by This Site',
    content: paragraph(
      'To support account login, permission control, business collaboration, and security audit, this site may process usernames, email addresses, roles, account status, password hashes, first-login password-change status, login credentials, IP addresses, browser information, operation times, and API access records.',
      'Model files, STEP/GLB preview files, thumbnails, model names, category tags, selection parameters, inquiry content, ticket messages, product gallery images, uploaded attachments, share links, and download records generated or submitted during use are also business data of this site.',
    ),
  },
  {
    title: 'Purposes of Use',
    content: paragraph(
      'Information is processed for identity verification, permission checks, model search and preview, file conversion, product selection, data sharing, download statistics, notifications, ticket collaboration, troubleshooting, performance optimization, security protection, and backup recovery.',
      'Unless required by law, company authorization rules, or explicit user authorization, this site does not use personal information for unrelated purposes and does not sell, rent, or provide it to unrelated third parties.',
    ),
  },
  {
    title: 'Permissions and Access Control',
    content: paragraph(
      'This site controls data visibility based on user role, department responsibilities, and business needs. Regular users usually access only authorized models, download records, personal inquiries, and tickets. Administrators may maintain users, models, categories, selections, logs, download statistics, and system settings according to their duties.',
      'Administrators should follow the principle of least privilege, avoid excessive authorization or shared accounts, and avoid exposing sensitive data to unrelated personnel.',
    ),
  },
  {
    title: 'Models, Images, and Attachments',
    content: paragraph(
      'Model files, engineering drawings, product images, gallery images, and attachments may contain company data, customer data, product structure information, or other sensitive content. Before uploading, sharing, or downloading, users should confirm that they have the required permission and that the data version, customer scope, and disclosure level are appropriate.',
      'Before sending data externally, users should carefully configure share expiry, download permission, password protection, and public preview scope according to the sensitivity of the data.',
    ),
  },
  {
    title: 'Logs and Security Audit',
    content: paragraph(
      'This site records logins, visits, downloads, uploads, shares, admin changes, errors, and data changes for account security, troubleshooting, audit traceability, risk detection, and prevention of unauthorized access.',
      'Security logs are normally not used for personal performance evaluation, but they may be used as trace evidence in abnormal downloads, data leaks, unauthorized access, system attacks, or compliance investigations.',
    ),
  },
  {
    title: 'Cookies and Local Storage',
    content: paragraph(
      'This site may use cookies, local storage, or browser cache to store login status, access tokens, theme preferences, interface settings, search state, and temporary form data to maintain sessions and improve usability.',
      'This site does not use third-party advertising tracking cookies. After users clear browser cache, some login status, interface preferences, or unsubmitted form content may be removed.',
    ),
  },
  {
    title: 'Data Storage, Backups, and Retention',
    content: paragraph(
      'Site data is stored on servers, databases, object storage, or file directories controlled by the deploying organization. The system may generate backup files according to configuration for disaster recovery, migration, version rollback, and operations troubleshooting.',
      'Backup files are as sensitive as production data and should be access-controlled, properly stored, and regularly cleaned up after expiry. Records related to business audit, download traceability, or security incidents may be retained for necessary periods under company rules.',
    ),
  },
  {
    title: 'Data Security Measures',
    content: paragraph(
      'This site uses password hashing, token authentication, role permissions, API access limits, operation logs, static resource protection, backup verification, security response headers, and exception prompts to reduce data leakage, unauthorized access, and misoperation risks.',
      'The deploying organization should still enable HTTPS, strong password policies, least privilege, firewalls, server patching, database backups, and access audits according to the actual environment.',
    ),
  },
  {
    title: 'Correction, Deletion, and Permission Changes',
    content: paragraph(
      'Users who need to correct account information, delete personal records, remove uploaded content, or adjust access permissions may contact an administrator.',
      'Models, selections, tickets, inquiries, download records, and operation logs may involve business collaboration or audit traceability. Before deletion, confirm that company business, customer delivery, or security investigations will not be affected. Historical data in backups will be cleaned according to the corresponding retention policy.',
    ),
  },
  {
    title: 'Third-Party Components and External Services',
    content: paragraph(
      'This site may use browsers, model conversion tools, email services, object storage, databases, caches, containers, and open-source dependencies as infrastructure components. These components support site operation and do not change the site data management requirements.',
      'If the deploying organization connects external email, object storage, CDN, monitoring, or backup services, it should evaluate data security, access permissions, and compliance requirements under company rules.',
    ),
  },
  {
    title: 'Notice Updates',
    content: paragraph(
      'This Privacy Notice may be updated when site features, deployment methods, permission policies, or company management requirements change. Major adjustments should be announced through system notices, internal notifications, or administrator explanations where appropriate.',
      'After the updated Privacy Notice is published, continued use of this site means the user understands and accepts the updated information processing practices.',
    ),
  },
];

export const DEFAULT_TERMS_SECTIONS: LegalSection[] = [
  {
    title: '定义与适用主体',
    content: paragraph(
      '本协议所称“本站”或“平台”，是指由部署方用于模型资料管理、产品选型、规格查询、产品图库、询价沟通、工单协作及后台管理的内部业务系统。',
      '本协议所称“用户”，是指注册、登录、访问或使用本站功能的个人，包括普通用户、管理员以及经授权使用本站的其他人员。',
    ),
  },
  {
    title: '服务定位',
    content: paragraph(
      '本站用于企业内部模型资料管理、模型搜索下载、产品选型、规格查询、产品图库展示、询价沟通和工单协作。',
      '本站不是合同审批、财务结算、正式报价或法律文件签署系统。涉及价格、合同、付款、交付承诺、售后责任和商业条款的事项，应以公司正式流程、授权文件和对应部门确认为准。',
    ),
  },
  {
    title: '账号与登录',
    content: paragraph(
      '用户应使用本人账号登录平台，不得共享、转借、出售、出租或冒用他人账号。首次登录后应按要求修改默认密码，并妥善保管密码、验证码和登录设备。',
      '因账号保管不当、共享账号或未及时退出登录造成的数据泄露、误操作或业务风险，由账号使用人及相应管理责任人按公司制度处理。',
    ),
  },
  {
    title: '权限使用边界',
    content: paragraph(
      '用户仅可在授权范围内查看、下载、上传、编辑、分享和管理资料。管理员应根据岗位职责、项目范围和业务必要性分配权限，避免过度授权。',
      '任何绕过权限控制、批量抓取资料、探测接口、复制敏感数据、访问无关业务信息或利用他人账号操作的行为，均属于违规使用。',
    ),
  },
  {
    title: '资料上传与维护',
    content: paragraph(
      '上传模型、图纸、图片、表格、选型数据和附件前，用户应确认文件来源合法、内容准确、版本有效，并确认适合在平台中保存和共享。',
      '禁止上传恶意程序、攻击脚本、无关文件、侵犯第三方权益的资料、客户禁止传播的资料，或违反法律法规、客户协议和公司制度的内容。',
    ),
  },
  {
    title: '模型预览与转换',
    content: paragraph(
      '平台提供模型格式转换、在线预览、缩略图生成、测量、材质显示和分享预览等辅助能力。由于源文件质量、格式兼容性、浏览器性能、转换工具和显示设备差异，预览结果可能与原始设计或实物存在偏差。',
      '正式生产、采购、加工、安装和交付应以工程图纸、技术文件、样本资料、实物确认和专业人员复核结果为准。',
    ),
  },
  {
    title: '下载、分享与外发',
    content: paragraph(
      '模型下载、图纸下载、图片下载和分享链接仅供授权业务使用。用户不得将链接、文件或账号提供给无关人员，不得绕过登录、有效期、下载次数、密码保护或权限控制。',
      '对外发送资料前，应确认客户、项目、版本、用途和资料权限，避免误发旧版资料、内部资料或敏感内容。',
    ),
  },
  {
    title: '产品选型与规格查询',
    content: paragraph(
      '产品选型、螺纹管径、油管规格、接头资料和其他查询工具用于提高内部检索和沟通效率，属于业务辅助信息。',
      '由于产品批次、供应商样本、现场工况、标准版本和库存状态可能变化，最终型号、规格、压力、材质、接口、适配关系和可供状态应以正式样本、图纸、技术确认或业务流程结果为准。',
    ),
  },
  {
    title: '询价与工单协作',
    content: paragraph(
      '平台内的询价、留言和工单用于记录沟通过程、需求描述和处理进度，不当然构成最终报价、合同承诺、售后结论或责任认定。',
      '涉及价格、交期、付款、退换货、责任划分、合同条款和客户承诺的内容，应由对应部门通过公司正式流程确认。',
    ),
  },
  {
    title: '行为规范',
    content: paragraph(
      '用户不得利用平台从事违法违规活动，不得上传病毒或攻击脚本，不得干扰系统运行，不得恶意删除、篡改、伪造数据，不得滥用批量下载、分享、上传和接口访问能力。',
      '发现异常账号、异常下载、敏感资料泄露、错误数据、系统漏洞或疑似攻击行为时，应及时通知管理员或相关负责人。',
    ),
  },
  {
    title: '数据质量与维护',
    content: paragraph(
      '用户在创建模型、分类、选型参数、产品图片、规格资料和产品图库图片时，应尽量保证名称、型号、分类、单位、图片、说明和版本信息准确。',
      '管理员有权对明显错误、重复、过期、不完整或不符合命名规范的数据进行调整、合并、禁用、归档或删除。',
    ),
  },
  {
    title: '知识产权与保密',
    content: paragraph(
      '平台中的模型、图纸、图片、选型资料、客户案例、现场照片和业务记录可能受知识产权、商业秘密、客户保密要求或公司制度保护。',
      '未经授权，用户不得复制、传播、公开展示、转交第三方或用于与公司业务无关的目的。平台代码许可不改变用户上传业务资料、客户资料和企业资料的权属及保密要求。',
    ),
  },
  {
    title: '系统维护与可用性',
    content: paragraph(
      '平台可能因版本升级、数据备份、文件恢复、模型重建、服务器维护、资源迁移或故障处理而短暂不可用。管理员可根据需要开启维护模式、限制部分功能或清理异常任务。',
      '用户应避免将平台作为唯一资料保存位置，重要资料应按公司要求进行备份、归档和版本管理。',
    ),
  },
  {
    title: '责任限制',
    content: paragraph(
      '在法律允许范围内，平台不对因网络故障、服务器异常、第三方组件、浏览器兼容、用户误操作、资料填写错误、模型转换偏差、缓存延迟或不可抗力造成的间接损失承担责任。',
      '企业内部管理责任和业务责任应以公司制度、岗位职责、授权边界和正式业务文件为准。',
    ),
  },
  {
    title: '违规处理',
    content: paragraph(
      '如用户违反本协议、公司制度或客户保密要求，管理员可根据情节采取提醒、限制功能、撤销权限、禁用账号、删除违规内容、保留操作日志并上报相关负责人等措施。',
      '涉嫌违法、重大安全事件或严重资料泄露的，可按公司制度和法律要求进一步处理。',
    ),
  },
  {
    title: '协议更新',
    content: paragraph(
      '本站功能、组织流程、合规要求、部署环境或业务管理策略发生变化时，本用户协议可能更新。',
      '更新后的协议发布后，用户继续使用本站即表示已了解并接受新的条款；如不同意更新内容，应停止使用相关功能并联系管理员处理。',
    ),
  },
];

export const DEFAULT_TERMS_SECTIONS_EN: LegalSection[] = [
  {
    title: 'Definitions and Covered Users',
    content: paragraph(
      'In these Terms, "this site" or "the platform" means the internal business system deployed for model data management, product selection, specification lookup, product gallery, inquiry communication, ticket collaboration, and administration.',
      'A "user" means any person who registers, logs in, accesses, or uses site features, including regular users, administrators, and other authorized personnel.',
    ),
  },
  {
    title: 'Service Positioning',
    content: paragraph(
      'This site is used for internal model data management, model search and downloads, product selection, specification lookup, product gallery display, inquiry communication, and ticket collaboration.',
      'This site is not a contract approval, financial settlement, formal quotation, or legal document signing system. Matters involving price, contract, payment, delivery commitments, after-sales responsibility, and commercial terms should be confirmed through formal company processes, authorization documents, and the responsible departments.',
    ),
  },
  {
    title: 'Accounts and Login',
    content: paragraph(
      'Users should log in with their own accounts and must not share, lend, sell, rent, or impersonate another account. After first login, users should change default passwords as required and properly keep passwords, verification codes, and login devices secure.',
      'Data leakage, misoperation, or business risks caused by improper account custody, shared accounts, or failure to log out in time should be handled under company rules by the account user and relevant management owners.',
    ),
  },
  {
    title: 'Permission Boundaries',
    content: paragraph(
      'Users may view, download, upload, edit, share, and manage data only within their authorized scope. Administrators should assign permissions according to job responsibilities, project scope, and business necessity, and avoid excessive authorization.',
      'Any attempt to bypass permission controls, bulk-scrape data, probe APIs, copy sensitive data, access unrelated business information, or operate through another person account is prohibited.',
    ),
  },
  {
    title: 'Data Upload and Maintenance',
    content: paragraph(
      'Before uploading models, drawings, images, spreadsheets, selection data, or attachments, users should confirm that the file source is lawful, the content is accurate, the version is valid, and the data is suitable for storage and sharing on the platform.',
      'Users must not upload malware, attack scripts, unrelated files, materials infringing third-party rights, customer-restricted materials, or content that violates laws, customer agreements, or company rules.',
    ),
  },
  {
    title: 'Model Preview and Conversion',
    content: paragraph(
      'The platform provides model conversion, online preview, thumbnail generation, measurement, material display, and share preview as auxiliary capabilities. Due to source file quality, format compatibility, browser performance, conversion tools, and display device differences, preview results may differ from the original design or physical product.',
      'Formal production, procurement, machining, installation, and delivery should be based on engineering drawings, technical files, sample data, physical confirmation, and professional review.',
    ),
  },
  {
    title: 'Downloads, Sharing, and External Sending',
    content: paragraph(
      'Model downloads, drawing downloads, image downloads, and share links are for authorized business use only. Users must not provide links, files, or accounts to unrelated personnel, or bypass login, expiry, download limits, password protection, or permission controls.',
      'Before sending data externally, users should confirm the customer, project, version, purpose, and data permission to avoid sending outdated, internal, or sensitive materials by mistake.',
    ),
  },
  {
    title: 'Product Selection and Specification Lookup',
    content: paragraph(
      'Product selection, thread and pipe size lookup, hose specifications, fitting data, and other query tools are auxiliary business information intended to improve internal search and communication efficiency.',
      'Because product batches, supplier samples, site conditions, standard versions, and stock status may change, final model numbers, specifications, pressure ratings, materials, interfaces, compatibility, and availability should be confirmed through formal samples, drawings, technical confirmation, or business process results.',
    ),
  },
  {
    title: 'Inquiry and Ticket Collaboration',
    content: paragraph(
      'Inquiries, messages, and tickets in the platform are used to record communication, requirement descriptions, and processing progress. They do not automatically constitute final quotations, contract commitments, after-sales conclusions, or liability determinations.',
      'Content involving price, lead time, payment, returns, responsibility allocation, contract terms, and customer commitments should be confirmed by the responsible departments through formal company processes.',
    ),
  },
  {
    title: 'Code of Conduct',
    content: paragraph(
      'Users must not use the platform for illegal or non-compliant activities, upload viruses or attack scripts, interfere with system operation, maliciously delete, tamper with, or forge data, or abuse bulk download, sharing, upload, or API access capabilities.',
      'When abnormal accounts, abnormal downloads, sensitive data leakage, incorrect data, system vulnerabilities, or suspected attacks are found, users should promptly notify administrators or relevant owners.',
    ),
  },
  {
    title: 'Data Quality and Maintenance',
    content: paragraph(
      'When creating models, categories, selection parameters, product images, specification data, and gallery images, users should keep names, model numbers, categories, units, images, descriptions, and version information as accurate as possible.',
      'Administrators may adjust, merge, disable, archive, or delete data that is clearly incorrect, duplicated, expired, incomplete, or not compliant with naming rules.',
    ),
  },
  {
    title: 'Intellectual Property and Confidentiality',
    content: paragraph(
      'Models, drawings, images, selection data, customer cases, site photos, and business records in the platform may be protected by intellectual property rights, trade secrets, customer confidentiality requirements, or company rules.',
      'Without authorization, users must not copy, distribute, publicly display, transfer to third parties, or use such data for purposes unrelated to company business. The platform code license does not change the ownership or confidentiality requirements of business data, customer data, or company data uploaded by users.',
    ),
  },
  {
    title: 'System Maintenance and Availability',
    content: paragraph(
      'The platform may be temporarily unavailable due to version upgrades, data backups, file restoration, model rebuilding, server maintenance, resource migration, or incident handling. Administrators may enable maintenance mode, restrict some features, or clean abnormal tasks when needed.',
      'Users should avoid using the platform as the only storage location for important materials. Important data should be backed up, archived, and version-managed according to company requirements.',
    ),
  },
  {
    title: 'Limitation of Liability',
    content: paragraph(
      'To the extent permitted by law, the platform is not responsible for indirect losses caused by network failures, server exceptions, third-party components, browser compatibility, user misoperation, incorrect data entry, model conversion deviations, cache delays, or force majeure.',
      'Internal management responsibility and business responsibility should be determined according to company rules, job responsibilities, authorization boundaries, and formal business documents.',
    ),
  },
  {
    title: 'Violation Handling',
    content: paragraph(
      'If a user violates these Terms, company rules, or customer confidentiality requirements, administrators may take measures such as reminders, feature restrictions, permission revocation, account disabling, deletion of non-compliant content, log retention, and escalation to relevant owners according to the severity.',
      'Suspected illegal conduct, major security incidents, or serious data leakage may be handled further under company rules and legal requirements.',
    ),
  },
  {
    title: 'Terms Updates',
    content: paragraph(
      'These Terms may be updated when site features, organization processes, compliance requirements, deployment environments, or business management policies change.',
      'After updated Terms are published, continued use of this site means the user understands and accepts the new terms. If the user does not agree to the updated content, the user should stop using the relevant features and contact an administrator.',
    ),
  },
];

export const DEFAULT_PRIVACY_SECTIONS_JA: LegalSection[] = [
  {
    title: '定義と対象ユーザー',
    content: paragraph(
      '本声明における「本サイト」または「プラットフォーム」とは、モデル資料管理、製品選定、仕様検索、製品ギャラリー、問い合わせ連絡、チケット協業および管理機能のために導入された社内業務システムを指します。',
      '「ユーザー」とは、本サイトに登録、ログイン、アクセス、または機能を利用する個人を指し、一般ユーザー、管理者、および本サイトの利用を許可されたその他の担当者を含みます。',
    ),
  },
  {
    title: '適用範囲',
    content: paragraph(
      '本声明は、ユーザーが本サイトのモデル検索、モデル閲覧、モデルダウンロード、製品選定、仕様検索、製品ギャラリー、問い合わせ連絡、チケット対応および管理機能を利用する場合に適用されます。',
      '本サイトは主に企業内部の資料管理と業務協業を目的としています。情報の取扱いは、会社の権限、職務範囲および業務上必要な範囲に限定されるべきです。',
    ),
  },
  {
    title: '本サイトが処理する情報',
    content: paragraph(
      'アカウントログイン、権限管理、業務協業およびセキュリティ監査のため、本サイトはユーザー名、メールアドレス、ロール、アカウント状態、パスワードハッシュ、初回ログイン時のパスワード変更状態、ログイン認証情報、IPアドレス、ブラウザー情報、操作時刻およびAPIアクセス記録を処理する場合があります。',
      '利用中に送信または生成されるモデルファイル、STEP/GLBプレビューファイル、サムネイル、モデル名、カテゴリタグ、選定パラメータ、問い合わせ内容、チケットメッセージ、製品ギャラリー画像、添付ファイル、共有リンクおよびダウンロード記録も、本サイトの業務データに含まれます。',
    ),
  },
  {
    title: '利用目的',
    content: paragraph(
      '本サイトは、本人確認、権限確認、モデル検索とプレビュー、ファイル変換、製品選定、資料共有、ダウンロード統計、通知、チケット協業、問題調査、性能改善、セキュリティ保護およびバックアップ復旧のために関連情報を処理します。',
      '法令、会社の権限管理要件、またはユーザーの明示的な許可がある場合を除き、本サイトは個人情報を業務と無関係な目的に使用せず、無関係な第三者に販売、貸与、提供しません。',
    ),
  },
  {
    title: '権限とアクセス制御',
    content: paragraph(
      '本サイトは、ユーザーロール、部門責任および業務上の必要性に基づいてデータの閲覧範囲を制御します。一般ユーザーは通常、許可されたモデル、ダウンロード記録、個人の問い合わせおよびチケットにのみアクセスできます。管理者は職務に応じてユーザー、モデル、カテゴリ、選定、ログ、ダウンロード統計およびシステム設定を管理できます。',
      '管理者は最小権限の原則に従い、過剰な権限付与、アカウント共有、または機密資料の不要な公開を避ける必要があります。',
    ),
  },
  {
    title: 'モデル、画像、添付資料',
    content: paragraph(
      'モデルファイル、図面、製品画像、ギャラリー画像および添付ファイルには、企業資料、顧客資料、製品構造情報、その他の機密情報が含まれる場合があります。アップロード、共有、ダウンロードの前に、必要な権限、資料バージョン、顧客範囲および公開レベルを確認してください。',
      '社外へ資料を送付する前に、資料の機密度に応じて共有期限、ダウンロード権限、パスワード保護および公開プレビュー範囲を慎重に設定してください。',
    ),
  },
  {
    title: 'ログとセキュリティ監査',
    content: paragraph(
      '本サイトは、アカウント保護、問題調査、監査追跡、リスク検出および不正アクセス防止のため、ログイン、アクセス、ダウンロード、アップロード、共有、管理変更、異常エラーおよびデータ変更を記録します。',
      'セキュリティログは通常、個人評価には使用されません。ただし、異常なダウンロード、資料漏えい、権限外アクセス、システム攻撃またはコンプライアンス調査が発生した場合、追跡資料として使用される場合があります。',
    ),
  },
  {
    title: 'Cookie とローカルストレージ',
    content: paragraph(
      '本サイトは、セッション維持と利便性向上のため、Cookie、ローカルストレージまたはブラウザーキャッシュにログイン状態、アクセストークン、テーマ設定、画面設定、検索状態および一時フォームデータを保存する場合があります。',
      '本サイトは第三者広告追跡Cookieを使用しません。ブラウザーキャッシュを削除すると、一部のログイン状態、画面設定または未送信フォーム内容が削除される場合があります。',
    ),
  },
  {
    title: 'データ保存、バックアップ、保持',
    content: paragraph(
      '本サイトのデータは、導入組織が管理するサーバー、データベース、オブジェクトストレージまたはファイルディレクトリに保存されます。システムは設定に従い、災害復旧、移行、バージョン戻しおよび運用調査のためバックアップファイルを生成する場合があります。',
      'バックアップファイルは正式データと同じく機密性があります。アクセスを制限し、適切に保管し、期限切れのバックアップを定期的に整理してください。業務監査、ダウンロード追跡またはセキュリティ事案に関わる記録は、会社規定に従い必要期間保持される場合があります。',
    ),
  },
  {
    title: 'データ保護措置',
    content: paragraph(
      '本サイトは、パスワードハッシュ、トークン認証、ロール権限、APIアクセス制限、操作ログ、静的リソース保護、バックアップ検証、セキュリティ応答ヘッダーおよび異常通知により、データ漏えい、権限外アクセスおよび誤操作のリスクを低減します。',
      '導入組織は実際の環境に応じて、HTTPS、強力なパスワードポリシー、最小権限、ファイアウォール、サーバーパッチ、データベースバックアップおよびアクセス監査を有効にする必要があります。',
    ),
  },
  {
    title: '訂正、削除、権限変更',
    content: paragraph(
      'ユーザーがアカウント情報の訂正、個人関連記録の削除、アップロード済み内容の削除、またはアクセス権限の調整を希望する場合は、管理者に連絡してください。',
      'モデル、選定、チケット、問い合わせ、ダウンロード記録および操作ログは、業務協業または監査追跡に関係する場合があります。削除前に、会社業務、顧客納品またはセキュリティ調査に影響しないことを確認してください。バックアップ内の履歴データは対応する保持期間終了後に方針に従って整理されます。',
    ),
  },
  {
    title: '第三者コンポーネントと外部サービス',
    content: paragraph(
      '本サイトは、ブラウザー、モデル変換ツール、メールサービス、オブジェクトストレージ、データベース、キャッシュ、コンテナおよびオープンソース依存関係などの基盤コンポーネントを使用する場合があります。これらは本サイトの機能を支えるものであり、業務データの管理要件を変更するものではありません。',
      '導入組織が外部メール、オブジェクトストレージ、CDN、監視またはバックアップサービスを接続する場合、会社制度に基づいてデータセキュリティ、アクセス権限およびコンプライアンス要件を評価してください。',
    ),
  },
  {
    title: '声明の更新',
    content: paragraph(
      '本サイトの機能、導入方法、権限方針または会社管理要件が変更された場合、本プライバシー声明は更新されることがあります。重要な変更は、システム通知、社内通知または管理者説明により周知することが推奨されます。',
      '更新後のプライバシー声明が公開された後も本サイトを継続利用する場合、ユーザーは更新後の情報処理方法を理解し受け入れたものとみなされます。',
    ),
  },
];

export const DEFAULT_TERMS_SECTIONS_JA: LegalSection[] = [
  {
    title: '定義と対象ユーザー',
    content: paragraph(
      '本規約における「本サイト」または「プラットフォーム」とは、モデル資料管理、製品選定、仕様検索、製品ギャラリー、問い合わせ連絡、チケット協業および管理機能のために導入された社内業務システムを指します。',
      '「ユーザー」とは、本サイトに登録、ログイン、アクセス、または機能を利用する個人を指し、一般ユーザー、管理者、および本サイトの利用を許可されたその他の担当者を含みます。',
    ),
  },
  {
    title: 'サービスの位置づけ',
    content: paragraph(
      '本サイトは、企業内部のモデル資料管理、モデル検索とダウンロード、製品選定、仕様検索、製品ギャラリー表示、問い合わせ連絡およびチケット協業のために使用されます。',
      '本サイトは、契約承認、財務精算、正式見積または法的文書署名のシステムではありません。価格、契約、支払い、納期約束、アフターサービス責任および商取引条件に関する事項は、会社の正式プロセス、権限文書および担当部門の確認を基準とします。',
    ),
  },
  {
    title: 'アカウントとログイン',
    content: paragraph(
      'ユーザーは本人のアカウントでログインし、他人のアカウントを共有、貸与、販売、賃貸、またはなりすまして使用してはなりません。初回ログイン後は要求に従って初期パスワードを変更し、パスワード、確認コードおよびログイン端末を適切に管理してください。',
      'アカウント管理不備、共有アカウント、または適時ログアウトしないことによるデータ漏えい、誤操作または業務リスクは、アカウント利用者および関連管理責任者が会社制度に従って対応します。',
    ),
  },
  {
    title: '権限利用の範囲',
    content: paragraph(
      'ユーザーは許可された範囲内でのみ資料の閲覧、ダウンロード、アップロード、編集、共有および管理を行うことができます。管理者は職務、プロジェクト範囲および業務上の必要性に基づき権限を付与し、過剰な権限付与を避ける必要があります。',
      '権限制御の回避、一括取得、API探索、機密データの複製、無関係な業務情報へのアクセス、または他人のアカウントを利用した操作は禁止されています。',
    ),
  },
  {
    title: '資料のアップロードと保守',
    content: paragraph(
      'モデル、図面、画像、表計算ファイル、選定データおよび添付ファイルをアップロードする前に、ファイルの出所が合法で、内容が正確で、バージョンが有効であり、本サイトで保存および共有することに適していることを確認してください。',
      '悪意あるプログラム、攻撃スクリプト、無関係なファイル、第三者の権利を侵害する資料、顧客が拡散を禁止した資料、または法令、顧客契約、会社制度に違反する内容をアップロードしてはなりません。',
    ),
  },
  {
    title: 'モデルプレビューと変換',
    content: paragraph(
      '本サイトは、モデル形式変換、オンラインプレビュー、サムネイル生成、測定、材質表示および共有プレビューなどの補助機能を提供します。元ファイルの品質、形式互換性、ブラウザー性能、変換ツールおよび表示端末の違いにより、プレビュー結果が元設計または実物と異なる場合があります。',
      '正式な生産、調達、加工、取付および納品は、図面、技術文書、サンプル資料、実物確認および専門担当者の確認結果を基準としてください。',
    ),
  },
  {
    title: 'ダウンロード、共有、外部送付',
    content: paragraph(
      'モデルダウンロード、図面ダウンロード、画像ダウンロードおよび共有リンクは、許可された業務目的にのみ使用できます。ユーザーはリンク、ファイルまたはアカウントを無関係な者に提供したり、ログイン、有効期限、ダウンロード回数、パスワード保護または権限制御を回避してはなりません。',
      '社外へ資料を送る前に、顧客、プロジェクト、バージョン、用途および資料権限を確認し、旧版資料、内部資料または機密資料の誤送付を避けてください。',
    ),
  },
  {
    title: '製品選定と仕様検索',
    content: paragraph(
      '製品選定、ねじ・管径検索、ホース仕様、継手資料およびその他の検索ツールは、社内検索とコミュニケーション効率を高めるための業務補助情報です。',
      '製品ロット、サプライヤー資料、現場条件、標準の版数および在庫状態は変化する可能性があります。最終的な型番、仕様、圧力、材質、インターフェース、適合関係および供給可否は、正式サンプル、図面、技術確認または業務プロセスの結果を基準とします。',
    ),
  },
  {
    title: '問い合わせとチケット協業',
    content: paragraph(
      '本サイト内の問い合わせ、メッセージおよびチケットは、コミュニケーション過程、要求内容および対応進捗を記録するためのものであり、最終見積、契約約束、アフターサービス結論または責任認定を当然に構成するものではありません。',
      '価格、納期、支払い、返品交換、責任分担、契約条項および顧客への約束に関する内容は、担当部門が会社の正式プロセスにより確認する必要があります。',
    ),
  },
  {
    title: '行動規範',
    content: paragraph(
      'ユーザーは本サイトを違法または不適切な活動に利用してはならず、ウイルスや攻撃スクリプトのアップロード、システム運用の妨害、データの悪意ある削除、改ざん、偽造、一括ダウンロード、共有、アップロードおよびAPIアクセス能力の濫用をしてはなりません。',
      '異常アカウント、異常ダウンロード、機密資料漏えい、誤ったデータ、システム脆弱性または攻撃の疑いを発見した場合は、速やかに管理者または関連責任者へ通知してください。',
    ),
  },
  {
    title: 'データ品質と保守',
    content: paragraph(
      'モデル、カテゴリ、選定パラメータ、製品画像、仕様資料およびギャラリー画像を作成する際、名称、型番、カテゴリ、単位、画像、説明およびバージョン情報の正確性をできる限り確保してください。',
      '管理者は、明らかに誤り、重複、期限切れ、不完全、または命名規則に適合しないデータを調整、統合、無効化、アーカイブまたは削除できます。',
    ),
  },
  {
    title: '知的財産と秘密保持',
    content: paragraph(
      '本サイト内のモデル、図面、画像、選定資料、顧客事例、現場写真および業務記録は、知的財産権、営業秘密、顧客の秘密保持要件または会社制度により保護される場合があります。',
      '許可なく、ユーザーはこれらの資料を複製、配布、公開表示、第三者へ提供、または会社業務と無関係な目的に使用してはなりません。本サイトのコードライセンスは、ユーザーがアップロードした業務資料、顧客資料および企業資料の権利帰属や秘密保持要件を変更しません。',
    ),
  },
  {
    title: 'システム保守と利用可能性',
    content: paragraph(
      '本サイトは、バージョンアップ、データバックアップ、ファイル復旧、モデル再構築、サーバー保守、リソース移行または障害対応により一時的に利用できない場合があります。管理者は必要に応じて保守モードを有効にし、一部機能を制限し、または異常タスクを整理できます。',
      'ユーザーは本サイトを重要資料の唯一の保存場所として使用しないようにしてください。重要資料は会社要件に従ってバックアップ、アーカイブおよびバージョン管理する必要があります。',
    ),
  },
  {
    title: '責任制限',
    content: paragraph(
      '法令で認められる範囲において、本サイトはネットワーク障害、サーバー異常、第三者コンポーネント、ブラウザー互換性、ユーザー誤操作、資料入力ミス、モデル変換差異、キャッシュ遅延または不可抗力による間接損失について責任を負いません。',
      '企業内部の管理責任および業務責任は、会社制度、職務責任、権限範囲および正式な業務文書に従って判断されます。',
    ),
  },
  {
    title: '違反対応',
    content: paragraph(
      'ユーザーが本規約、会社制度または顧客の秘密保持要件に違反した場合、管理者は状況に応じて注意、機能制限、権限取消、アカウント無効化、違反内容削除、操作ログ保持および関連責任者への報告などの措置を取ることができます。',
      '違法行為、重大なセキュリティ事案または深刻な資料漏えいの疑いがある場合、会社制度および法令要件に従ってさらに対応されることがあります。',
    ),
  },
  {
    title: '規約の更新',
    content: paragraph(
      '本サイトの機能、組織プロセス、コンプライアンス要件、導入環境または業務管理方針が変化した場合、本ユーザー規約は更新されることがあります。',
      '更新後の規約が公開された後も本サイトを継続利用する場合、ユーザーは新しい条項を理解し受け入れたものとみなされます。更新内容に同意しない場合は、関連機能の利用を停止し、管理者へ連絡してください。',
    ),
  },
];

export const DEFAULT_PRIVACY_SECTIONS_KO: LegalSection[] = [
  {
    title: '정의 및 적용 대상',
    content: paragraph(
      '본 고지에서 “본 사이트” 또는 “플랫폼”은 모델 자료 관리, 제품 선정, 사양 조회, 제품 갤러리, 문의 소통, 티켓 협업 및 관리 기능을 위해 배포된 내부 업무 시스템을 의미합니다.',
      '“사용자”는 본 사이트에 등록, 로그인, 접근하거나 기능을 사용하는 개인을 의미하며, 일반 사용자, 관리자 및 사용 권한을 받은 기타 인원을 포함합니다.',
    ),
  },
  {
    title: '적용 범위',
    content: paragraph(
      '본 고지는 사용자가 본 사이트의 모델 검색, 모델 열람, 모델 다운로드, 제품 선정, 사양 조회, 제품 갤러리, 문의 소통, 티켓 처리 및 관리 기능을 이용할 때 적용됩니다.',
      '본 사이트는 주로 기업 내부 자료 관리와 업무 협업을 위한 시스템입니다. 정보 처리는 회사의 승인 범위, 직무 책임 및 업무상 필요한 범위 안에서 이루어져야 합니다.',
    ),
  },
  {
    title: '본 사이트가 처리하는 정보',
    content: paragraph(
      '계정 로그인, 권한 제어, 업무 협업 및 보안 감사를 위해 본 사이트는 사용자명, 이메일 주소, 역할, 계정 상태, 비밀번호 해시, 최초 로그인 비밀번호 변경 상태, 로그인 자격 증명, IP 주소, 브라우저 정보, 작업 시간 및 API 접근 기록을 처리할 수 있습니다.',
      '사용 중 제출되거나 생성되는 모델 파일, STEP/GLB 미리보기 파일, 썸네일, 모델명, 카테고리 태그, 선정 파라미터, 문의 내용, 티켓 메시지, 제품 갤러리 이미지, 업로드 첨부, 공유 링크 및 다운로드 기록도 본 사이트의 업무 데이터에 포함됩니다.',
    ),
  },
  {
    title: '이용 목적',
    content: paragraph(
      '본 사이트는 신원 확인, 권한 확인, 모델 검색 및 미리보기, 파일 변환, 제품 선정, 자료 공유, 다운로드 통계, 알림, 티켓 협업, 문제 해결, 성능 최적화, 보안 보호 및 백업 복구를 위해 관련 정보를 처리합니다.',
      '법령, 회사 승인 관리 요건 또는 사용자의 명시적 동의가 있는 경우를 제외하고, 본 사이트는 개인정보를 업무와 무관한 목적으로 사용하지 않으며 무관한 제3자에게 판매, 임대 또는 제공하지 않습니다.',
    ),
  },
  {
    title: '권한 및 접근 제어',
    content: paragraph(
      '본 사이트는 사용자 역할, 부서 책임 및 업무 필요성에 따라 데이터 가시 범위를 제어합니다. 일반 사용자는 보통 승인된 모델, 다운로드 기록, 개인 문의 및 티켓에만 접근할 수 있습니다. 관리자는 직무에 따라 사용자, 모델, 카테고리, 선정, 로그, 다운로드 통계 및 시스템 설정을 유지할 수 있습니다.',
      '관리자는 최소 권한 원칙을 따라야 하며 과도한 권한 부여, 계정 공유 또는 민감 자료를 무관한 사람에게 공개하는 일을 피해야 합니다.',
    ),
  },
  {
    title: '모델, 이미지 및 첨부 자료',
    content: paragraph(
      '모델 파일, 도면, 제품 이미지, 갤러리 이미지 및 첨부 파일에는 기업 자료, 고객 자료, 제품 구조 정보 또는 기타 민감한 내용이 포함될 수 있습니다. 업로드, 공유 또는 다운로드 전에 필요한 권한, 자료 버전, 고객 범위 및 공개 수준을 확인해야 합니다.',
      '외부로 자료를 보내기 전에 자료의 민감도에 따라 공유 만료일, 다운로드 권한, 비밀번호 보호 및 공개 미리보기 범위를 신중하게 설정해야 합니다.',
    ),
  },
  {
    title: '로그 및 보안 감사',
    content: paragraph(
      '본 사이트는 계정 보안, 문제 해결, 감사 추적, 위험 식별 및 미승인 접근 방지를 위해 로그인, 방문, 다운로드, 업로드, 공유, 관리자 변경, 오류 및 데이터 변경 로그를 기록합니다.',
      '보안 로그는 일반적으로 개인 성과 평가에 사용되지 않습니다. 다만 비정상 다운로드, 자료 유출, 권한 없는 접근, 시스템 공격 또는 컴플라이언스 조사 시 추적 근거로 사용될 수 있습니다.',
    ),
  },
  {
    title: '쿠키 및 로컬 저장소',
    content: paragraph(
      '본 사이트는 세션 유지와 사용성 향상을 위해 쿠키, 로컬 저장소 또는 브라우저 캐시에 로그인 상태, 접근 토큰, 테마 선호, 인터페이스 설정, 검색 상태 및 임시 양식 데이터를 저장할 수 있습니다.',
      '본 사이트는 제3자 광고 추적 쿠키를 사용하지 않습니다. 사용자가 브라우저 캐시를 삭제하면 일부 로그인 상태, 인터페이스 선호 또는 제출하지 않은 양식 내용이 삭제될 수 있습니다.',
    ),
  },
  {
    title: '데이터 저장, 백업 및 보관',
    content: paragraph(
      '본 사이트의 데이터는 배포 조직이 관리하는 서버, 데이터베이스, 객체 저장소 또는 파일 디렉터리에 저장됩니다. 시스템은 설정에 따라 재해 복구, 이전, 버전 롤백 및 운영 문제 해결을 위해 백업 파일을 생성할 수 있습니다.',
      '백업 파일은 운영 데이터와 동일한 민감도를 가집니다. 접근을 제한하고 적절히 보관하며 만료된 백업을 정기적으로 정리해야 합니다. 업무 감사, 다운로드 추적 또는 보안 사건 관련 기록은 회사 규정에 따라 필요한 기간 보관될 수 있습니다.',
    ),
  },
  {
    title: '데이터 보안 조치',
    content: paragraph(
      '본 사이트는 비밀번호 해시, 토큰 인증, 역할 권한, API 접근 제한, 작업 로그, 정적 리소스 보호, 백업 검증, 보안 응답 헤더 및 예외 알림을 통해 데이터 유출, 권한 없는 접근 및 오작동 위험을 줄입니다.',
      '배포 조직은 실제 환경에 맞게 HTTPS, 강력한 비밀번호 정책, 최소 권한, 방화벽, 서버 패치, 데이터베이스 백업 및 접근 감사를 활성화해야 합니다.',
    ),
  },
  {
    title: '정정, 삭제 및 권한 조정',
    content: paragraph(
      '사용자가 계정 정보 정정, 개인 관련 기록 삭제, 업로드한 내용 제거 또는 접근 권한 조정을 원할 경우 관리자에게 문의할 수 있습니다.',
      '모델, 선정, 티켓, 문의, 다운로드 기록 및 작업 로그는 업무 협업 또는 감사 추적과 관련될 수 있습니다. 삭제 전 회사 업무, 고객 납품 또는 보안 조사에 영향이 없는지 확인해야 합니다. 백업의 이력 데이터는 해당 보관 기간 종료 후 정책에 따라 정리됩니다.',
    ),
  },
  {
    title: '제3자 구성 요소 및 외부 서비스',
    content: paragraph(
      '본 사이트는 브라우저, 모델 변환 도구, 메일 서비스, 객체 저장소, 데이터베이스, 캐시, 컨테이너 및 오픈소스 의존성 등 기반 구성 요소를 사용할 수 있습니다. 이러한 구성 요소는 사이트 기능을 지원하기 위한 것이며 업무 데이터 관리 요구사항을 변경하지 않습니다.',
      '배포 조직이 외부 메일, 객체 저장소, CDN, 모니터링 또는 백업 서비스를 연결하는 경우 회사 제도에 따라 데이터 보안, 접근 권한 및 컴플라이언스 요구사항을 평가해야 합니다.',
    ),
  },
  {
    title: '고지 업데이트',
    content: paragraph(
      '본 사이트의 기능, 배포 방식, 권한 정책 또는 회사 관리 요구사항이 변경되면 본 개인정보 고지가 업데이트될 수 있습니다. 중요한 변경은 시스템 공지, 내부 알림 또는 관리자 설명을 통해 안내하는 것이 좋습니다.',
      '업데이트된 개인정보 고지가 게시된 후에도 본 사이트를 계속 사용하는 경우, 사용자는 업데이트된 정보 처리 방식을 이해하고 수락한 것으로 간주됩니다.',
    ),
  },
];

export const DEFAULT_TERMS_SECTIONS_KO: LegalSection[] = [
  {
    title: '정의 및 적용 대상',
    content: paragraph(
      '본 약관에서 “본 사이트” 또는 “플랫폼”은 모델 자료 관리, 제품 선정, 사양 조회, 제품 갤러리, 문의 소통, 티켓 협업 및 관리 기능을 위해 배포된 내부 업무 시스템을 의미합니다.',
      '“사용자”는 본 사이트에 등록, 로그인, 접근하거나 기능을 사용하는 개인을 의미하며, 일반 사용자, 관리자 및 사용 권한을 받은 기타 인원을 포함합니다.',
    ),
  },
  {
    title: '서비스의 위치',
    content: paragraph(
      '본 사이트는 기업 내부 모델 자료 관리, 모델 검색 및 다운로드, 제품 선정, 사양 조회, 제품 갤러리 표시, 문의 소통 및 티켓 협업에 사용됩니다.',
      '본 사이트는 계약 승인, 재무 정산, 공식 견적 또는 법적 문서 서명 시스템이 아닙니다. 가격, 계약, 결제, 납품 약속, A/S 책임 및 상업 조건과 관련된 사항은 회사의 공식 절차, 승인 문서 및 담당 부서의 확인을 기준으로 해야 합니다.',
    ),
  },
  {
    title: '계정 및 로그인',
    content: paragraph(
      '사용자는 본인 계정으로 로그인해야 하며, 타인의 계정을 공유, 대여, 판매, 임대하거나 사칭해서는 안 됩니다. 최초 로그인 후 요구에 따라 기본 비밀번호를 변경하고 비밀번호, 인증 코드 및 로그인 기기를 안전하게 관리해야 합니다.',
      '계정 관리 부주의, 공유 계정 또는 제때 로그아웃하지 않아 발생한 데이터 유출, 오작동 또는 업무 위험은 계정 사용자와 관련 관리 책임자가 회사 제도에 따라 처리합니다.',
    ),
  },
  {
    title: '권한 사용 범위',
    content: paragraph(
      '사용자는 승인된 범위 내에서만 자료를 열람, 다운로드, 업로드, 편집, 공유 및 관리할 수 있습니다. 관리자는 직무 책임, 프로젝트 범위 및 업무 필요성에 따라 권한을 배정하고 과도한 권한 부여를 피해야 합니다.',
      '권한 제어 우회, 대량 수집, API 탐색, 민감 데이터 복사, 무관한 업무 정보 접근 또는 타인 계정을 이용한 작업은 모두 금지됩니다.',
    ),
  },
  {
    title: '자료 업로드 및 유지관리',
    content: paragraph(
      '모델, 도면, 이미지, 표, 선정 데이터 및 첨부 파일을 업로드하기 전에 파일 출처가 적법하고 내용이 정확하며 버전이 유효하고 플랫폼에 저장 및 공유하기에 적합한지 확인해야 합니다.',
      '악성 프로그램, 공격 스크립트, 무관한 파일, 제3자 권리를 침해하는 자료, 고객이 전파를 금지한 자료 또는 법령, 고객 계약, 회사 제도에 위반되는 내용을 업로드해서는 안 됩니다.',
    ),
  },
  {
    title: '모델 미리보기 및 변환',
    content: paragraph(
      '플랫폼은 모델 형식 변환, 온라인 미리보기, 썸네일 생성, 측정, 재질 표시 및 공유 미리보기 등의 보조 기능을 제공합니다. 원본 파일 품질, 형식 호환성, 브라우저 성능, 변환 도구 및 표시 장치 차이로 인해 미리보기 결과가 원 설계 또는 실제 제품과 다를 수 있습니다.',
      '공식 생산, 구매, 가공, 설치 및 납품은 도면, 기술 문서, 샘플 자료, 실물 확인 및 전문가 검토 결과를 기준으로 해야 합니다.',
    ),
  },
  {
    title: '다운로드, 공유 및 외부 발송',
    content: paragraph(
      '모델 다운로드, 도면 다운로드, 이미지 다운로드 및 공유 링크는 승인된 업무 용도로만 사용할 수 있습니다. 사용자는 링크, 파일 또는 계정을 무관한 사람에게 제공하거나 로그인, 유효기간, 다운로드 횟수, 비밀번호 보호 또는 권한 제어를 우회해서는 안 됩니다.',
      '외부로 자료를 보내기 전에 고객, 프로젝트, 버전, 용도 및 자료 권한을 확인하여 구버전 자료, 내부 자료 또는 민감 자료를 잘못 보내는 일을 피해야 합니다.',
    ),
  },
  {
    title: '제품 선정 및 사양 조회',
    content: paragraph(
      '제품 선정, 나사 및 관경 조회, 호스 사양, 피팅 자료 및 기타 조회 도구는 내부 검색과 소통 효율을 높이기 위한 업무 보조 정보입니다.',
      '제품 로트, 공급업체 샘플, 현장 조건, 표준 버전 및 재고 상태는 변경될 수 있으므로 최종 모델, 사양, 압력, 재질, 인터페이스, 호환 관계 및 공급 가능 여부는 공식 샘플, 도면, 기술 확인 또는 업무 절차 결과를 기준으로 해야 합니다.',
    ),
  },
  {
    title: '문의 및 티켓 협업',
    content: paragraph(
      '플랫폼 내 문의, 메시지 및 티켓은 소통 과정, 요구사항 설명 및 처리 진행 상황을 기록하기 위한 것이며 최종 견적, 계약 약속, A/S 결론 또는 책임 인정으로 자동 간주되지 않습니다.',
      '가격, 납기, 결제, 반품, 책임 구분, 계약 조항 및 고객 약속과 관련된 내용은 담당 부서가 회사의 공식 절차를 통해 확인해야 합니다.',
    ),
  },
  {
    title: '행동 규범',
    content: paragraph(
      '사용자는 플랫폼을 불법 또는 비준수 활동에 이용해서는 안 되며, 바이러스나 공격 스크립트 업로드, 시스템 운영 방해, 데이터의 악의적 삭제, 변조, 위조, 대량 다운로드, 공유, 업로드 및 API 접근 기능 남용을 해서는 안 됩니다.',
      '비정상 계정, 비정상 다운로드, 민감 자료 유출, 잘못된 데이터, 시스템 취약점 또는 공격 의심 행위를 발견하면 즉시 관리자 또는 관련 책임자에게 알려야 합니다.',
    ),
  },
  {
    title: '데이터 품질 및 유지관리',
    content: paragraph(
      '모델, 카테고리, 선정 파라미터, 제품 이미지, 사양 자료 및 제품 갤러리 이미지를 생성할 때 명칭, 모델번호, 카테고리, 단위, 이미지, 설명 및 버전 정보가 최대한 정확하도록 해야 합니다.',
      '관리자는 명백히 잘못되었거나 중복, 만료, 불완전 또는 명명 규칙에 맞지 않는 데이터를 조정, 병합, 비활성화, 보관 또는 삭제할 수 있습니다.',
    ),
  },
  {
    title: '지식재산권 및 비밀유지',
    content: paragraph(
      '플랫폼의 모델, 도면, 이미지, 선정 자료, 고객 사례, 현장 사진 및 업무 기록은 지식재산권, 영업비밀, 고객 비밀유지 요구사항 또는 회사 제도의 보호를 받을 수 있습니다.',
      '승인 없이 사용자는 이러한 자료를 복사, 배포, 공개 전시, 제3자에게 전달하거나 회사 업무와 무관한 목적으로 사용할 수 없습니다. 플랫폼 코드 라이선스는 사용자가 업로드한 업무 자료, 고객 자료 및 기업 자료의 권리 귀속과 비밀유지 요구사항을 변경하지 않습니다.',
    ),
  },
  {
    title: '시스템 유지관리 및 가용성',
    content: paragraph(
      '플랫폼은 버전 업그레이드, 데이터 백업, 파일 복구, 모델 재구축, 서버 유지관리, 리소스 이전 또는 장애 처리로 인해 일시적으로 사용할 수 없을 수 있습니다. 관리자는 필요에 따라 유지관리 모드를 켜거나 일부 기능을 제한하거나 비정상 작업을 정리할 수 있습니다.',
      '사용자는 플랫폼을 중요한 자료의 유일한 저장 위치로 사용하지 않아야 합니다. 중요한 자료는 회사 요구사항에 따라 백업, 보관 및 버전 관리해야 합니다.',
    ),
  },
  {
    title: '책임 제한',
    content: paragraph(
      '법이 허용하는 범위 내에서 플랫폼은 네트워크 장애, 서버 이상, 제3자 구성 요소, 브라우저 호환성, 사용자 오작동, 자료 입력 오류, 모델 변환 편차, 캐시 지연 또는 불가항력으로 인한 간접 손실에 대해 책임을 지지 않습니다.',
      '기업 내부 관리 책임과 업무 책임은 회사 제도, 직무 책임, 승인 범위 및 공식 업무 문서에 따라 판단됩니다.',
    ),
  },
  {
    title: '위반 처리',
    content: paragraph(
      '사용자가 본 약관, 회사 제도 또는 고객 비밀유지 요구사항을 위반하면 관리자는 사안의 정도에 따라 알림, 기능 제한, 권한 회수, 계정 비활성화, 위반 내용 삭제, 작업 로그 보관 및 관련 책임자 보고 등의 조치를 취할 수 있습니다.',
      '불법 행위, 중대한 보안 사건 또는 심각한 자료 유출이 의심되는 경우 회사 제도와 법적 요구사항에 따라 추가로 처리될 수 있습니다.',
    ),
  },
  {
    title: '약관 업데이트',
    content: paragraph(
      '본 사이트 기능, 조직 절차, 컴플라이언스 요구사항, 배포 환경 또는 업무 관리 정책이 변경되면 본 사용자 약관이 업데이트될 수 있습니다.',
      '업데이트된 약관이 게시된 후에도 본 사이트를 계속 사용하는 경우 사용자는 새로운 조항을 이해하고 수락한 것으로 간주됩니다. 업데이트 내용에 동의하지 않으면 관련 기능 사용을 중단하고 관리자에게 문의해야 합니다.',
    ),
  },
];

export const DEFAULT_PRIVACY_SECTIONS_DE: LegalSection[] = [
  {
    title: 'Definitionen und betroffene Nutzer',
    content: paragraph(
      'In dieser Erklärung bezeichnet „diese Website“ oder „die Plattform“ das interne Geschäftssystem für Modelldatenverwaltung, Produktauswahl, Spezifikationssuche, Produktgalerie, Anfragekommunikation, Ticket-Zusammenarbeit und Administration.',
      '„Nutzer“ sind Personen, die sich registrieren, anmelden, auf die Website zugreifen oder Funktionen nutzen, einschließlich regulärer Nutzer, Administratoren und sonstiger autorisierter Personen.',
    ),
  },
  {
    title: 'Geltungsbereich',
    content: paragraph(
      'Diese Erklärung gilt für die Nutzung von Modellsuche, Modellansicht, Modelldownload, Produktauswahl, Spezifikationssuche, Produktgalerie, Anfragekommunikation, Ticketbearbeitung und Administrationsfunktionen.',
      'Die Website dient hauptsächlich der internen Datenverwaltung und geschäftlichen Zusammenarbeit. Die Verarbeitung von Informationen sollte auf Unternehmensfreigaben, Zuständigkeiten und geschäftliche Notwendigkeit beschränkt bleiben.',
    ),
  },
  {
    title: 'Verarbeitete Informationen',
    content: paragraph(
      'Zur Unterstützung von Anmeldung, Berechtigungssteuerung, Zusammenarbeit und Sicherheitsprüfung kann die Website Benutzernamen, E-Mail-Adressen, Rollen, Kontostatus, Passwort-Hashes, Status der Erstpasswortänderung, Anmeldeinformationen, IP-Adressen, Browserinformationen, Vorgangszeiten und API-Zugriffsprotokolle verarbeiten.',
      'Auch während der Nutzung eingereichte oder erzeugte Modelldateien, STEP/GLB-Vorschaudateien, Miniaturbilder, Modellnamen, Kategorietags, Auswahlparameter, Anfrageinhalte, Ticketnachrichten, Galeriebilder, Anhänge, Freigabelinks und Downloadprotokolle gelten als Geschäftsdaten dieser Website.',
    ),
  },
  {
    title: 'Zwecke der Verarbeitung',
    content: paragraph(
      'Informationen werden für Identitätsprüfung, Berechtigungsprüfung, Modellsuche und Vorschau, Dateikonvertierung, Produktauswahl, Datenfreigabe, Downloadstatistik, Benachrichtigungen, Ticket-Zusammenarbeit, Fehleranalyse, Leistungsoptimierung, Sicherheitsschutz und Backup-Wiederherstellung verarbeitet.',
      'Sofern nicht gesetzlich vorgeschrieben, durch Unternehmensregeln autorisiert oder ausdrücklich vom Nutzer erlaubt, verwendet die Website personenbezogene Informationen nicht für fachfremde Zwecke und verkauft, vermietet oder übermittelt sie nicht an unbeteiligte Dritte.',
    ),
  },
  {
    title: 'Berechtigungen und Zugriffskontrolle',
    content: paragraph(
      'Die Website steuert die Sichtbarkeit von Daten anhand von Rollen, Abteilungszuständigkeiten und geschäftlichem Bedarf. Reguläre Nutzer greifen in der Regel nur auf autorisierte Modelle, Downloadprotokolle, eigene Anfragen und Tickets zu. Administratoren können entsprechend ihrer Aufgaben Nutzer, Modelle, Kategorien, Auswahlen, Protokolle, Downloadstatistiken und Systemeinstellungen pflegen.',
      'Administratoren sollten dem Prinzip der minimal erforderlichen Rechte folgen und übermäßige Berechtigungen, geteilte Konten sowie die Offenlegung sensibler Daten gegenüber Unbeteiligten vermeiden.',
    ),
  },
  {
    title: 'Modelle, Bilder und Anhänge',
    content: paragraph(
      'Modelldateien, Zeichnungen, Produktbilder, Galeriebilder und Anhänge können Unternehmensdaten, Kundendaten, Produktstrukturinformationen oder andere sensible Inhalte enthalten. Vor Upload, Freigabe oder Download sollten Nutzer prüfen, ob sie die erforderlichen Rechte besitzen und ob Version, Kundenumfang und Offenlegungsstufe passen.',
      'Vor dem externen Versand von Daten sollten Freigabeablauf, Downloadberechtigung, Passwortschutz und öffentlicher Vorschauumfang entsprechend der Sensibilität sorgfältig konfiguriert werden.',
    ),
  },
  {
    title: 'Protokolle und Sicherheitsprüfung',
    content: paragraph(
      'Die Website protokolliert Anmeldungen, Zugriffe, Downloads, Uploads, Freigaben, Admin-Änderungen, Fehler und Datenänderungen zur Kontosicherheit, Fehleranalyse, Nachvollziehbarkeit, Risikoerkennung und Verhinderung unberechtigter Zugriffe.',
      'Sicherheitsprotokolle werden normalerweise nicht zur Leistungsbewertung einzelner Personen genutzt, können aber bei auffälligen Downloads, Datenlecks, unberechtigtem Zugriff, Systemangriffen oder Compliance-Untersuchungen als Nachweis dienen.',
    ),
  },
  {
    title: 'Cookies und lokaler Speicher',
    content: paragraph(
      'Die Website kann Cookies, lokalen Speicher oder Browsercache verwenden, um Anmeldestatus, Zugriffstoken, Theme-Präferenzen, Oberflächeneinstellungen, Suchzustand und temporäre Formulardaten zu speichern.',
      'Die Website verwendet keine Tracking-Cookies für Drittanbieterwerbung. Nach dem Löschen des Browsercaches können Anmeldestatus, Einstellungen oder nicht gesendete Formularinhalte entfernt sein.',
    ),
  },
  {
    title: 'Speicherung, Backups und Aufbewahrung',
    content: paragraph(
      'Website-Daten werden auf Servern, Datenbanken, Objektspeichern oder Dateiverzeichnissen gespeichert, die von der bereitstellenden Organisation kontrolliert werden. Das System kann gemäß Konfiguration Backups für Notfallwiederherstellung, Migration, Versionsrücknahme und Betriebsanalyse erzeugen.',
      'Backupdateien sind ebenso sensibel wie Produktivdaten und sollten zugriffsbeschränkt, sicher aufbewahrt und regelmäßig nach Ablauf bereinigt werden. Protokolle mit Bezug zu Geschäftsaudit, Downloadnachverfolgung oder Sicherheitsvorfällen können gemäß Unternehmensregeln für erforderliche Zeiträume aufbewahrt werden.',
    ),
  },
  {
    title: 'Sicherheitsmaßnahmen',
    content: paragraph(
      'Die Website nutzt Passwort-Hashing, Token-Authentifizierung, Rollenberechtigungen, API-Zugriffslimits, Betriebsprotokolle, Schutz statischer Ressourcen, Backup-Prüfung, Sicherheitsheader und Fehlermeldungen, um Risiken durch Datenlecks, unberechtigte Zugriffe und Fehlbedienung zu reduzieren.',
      'Die bereitstellende Organisation sollte zusätzlich HTTPS, starke Passwortregeln, minimale Rechte, Firewalls, Serverpatches, Datenbankbackups und Zugriffsaudits entsprechend der realen Umgebung aktivieren.',
    ),
  },
  {
    title: 'Berichtigung, Löschung und Rechteänderung',
    content: paragraph(
      'Nutzer können sich an Administratoren wenden, wenn Kontodaten berichtigt, personenbezogene Einträge gelöscht, hochgeladene Inhalte entfernt oder Zugriffsrechte angepasst werden sollen.',
      'Modelle, Auswahlen, Tickets, Anfragen, Downloadprotokolle und Betriebsprotokolle können mit geschäftlicher Zusammenarbeit oder Prüfpflichten verbunden sein. Vor einer Löschung sollte geprüft werden, dass Geschäftsprozesse, Kundenlieferungen oder Sicherheitsuntersuchungen nicht beeinträchtigt werden. Historische Daten in Backups werden nach Ende der jeweiligen Aufbewahrungsfrist gemäß Richtlinie bereinigt.',
    ),
  },
  {
    title: 'Drittkomponenten und externe Dienste',
    content: paragraph(
      'Die Website kann Browser, Modellkonvertierungstools, E-Mail-Dienste, Objektspeicher, Datenbanken, Caches, Container und Open-Source-Abhängigkeiten als Infrastrukturkomponenten verwenden. Diese Komponenten unterstützen den Betrieb und ändern nicht die Anforderungen an die Verwaltung von Geschäftsdaten.',
      'Wenn externe E-Mail-, Speicher-, CDN-, Monitoring- oder Backup-Dienste angebunden werden, sollte die bereitstellende Organisation Datensicherheit, Zugriffsrechte und Compliance-Anforderungen gemäß Unternehmensregeln prüfen.',
    ),
  },
  {
    title: 'Aktualisierung der Erklärung',
    content: paragraph(
      'Diese Datenschutzerklärung kann aktualisiert werden, wenn sich Funktionen, Bereitstellungsart, Berechtigungsregeln oder Unternehmensanforderungen ändern. Wesentliche Änderungen sollten möglichst über Systemhinweise, interne Mitteilungen oder Administratorinformationen bekannt gemacht werden.',
      'Nach Veröffentlichung der aktualisierten Erklärung bedeutet die weitere Nutzung der Website, dass der Nutzer die aktualisierte Informationsverarbeitung versteht und akzeptiert.',
    ),
  },
];

export const DEFAULT_TERMS_SECTIONS_DE: LegalSection[] = [
  {
    title: 'Definitionen und betroffene Nutzer',
    content: paragraph(
      'In diesen Nutzungsbedingungen bezeichnet „diese Website“ oder „die Plattform“ das interne Geschäftssystem für Modelldatenverwaltung, Produktauswahl, Spezifikationssuche, Produktgalerie, Anfragekommunikation, Ticket-Zusammenarbeit und Administration.',
      '„Nutzer“ sind Personen, die sich registrieren, anmelden, auf die Website zugreifen oder Funktionen nutzen, einschließlich regulärer Nutzer, Administratoren und sonstiger autorisierter Personen.',
    ),
  },
  {
    title: 'Zweck des Dienstes',
    content: paragraph(
      'Die Website dient der internen Verwaltung von Modelldaten, der Modellsuche und dem Download, der Produktauswahl, Spezifikationssuche, Produktgalerie, Anfragekommunikation und Ticket-Zusammenarbeit.',
      'Die Website ist kein System für Vertragsfreigabe, finanzielle Abrechnung, formelle Angebote oder rechtliche Unterzeichnung. Fragen zu Preisen, Verträgen, Zahlungen, Lieferzusagen, Serviceverantwortung und Geschäftsbedingungen sind über offizielle Unternehmensprozesse, Freigabedokumente und zuständige Abteilungen zu bestätigen.',
    ),
  },
  {
    title: 'Konten und Anmeldung',
    content: paragraph(
      'Nutzer müssen sich mit ihrem eigenen Konto anmelden und dürfen Konten nicht teilen, verleihen, verkaufen, vermieten oder sich als andere Person ausgeben. Nach der ersten Anmeldung ist das Standardpasswort wie gefordert zu ändern; Passwörter, Codes und Geräte sind sicher aufzubewahren.',
      'Datenlecks, Fehlbedienungen oder Geschäftsrisiken durch unsachgemäße Kontoverwahrung, geteilte Konten oder nicht rechtzeitiges Abmelden werden gemäß Unternehmensregeln durch den Kontonutzer und die verantwortlichen Stellen behandelt.',
    ),
  },
  {
    title: 'Grenzen der Berechtigungsnutzung',
    content: paragraph(
      'Nutzer dürfen Daten nur im autorisierten Umfang ansehen, herunterladen, hochladen, bearbeiten, freigeben und verwalten. Administratoren vergeben Rechte nach Zuständigkeit, Projektumfang und geschäftlicher Notwendigkeit und vermeiden übermäßige Berechtigungen.',
      'Das Umgehen von Berechtigungskontrollen, massenhafte Auslesen von Daten, API-Sondierung, Kopieren sensibler Daten, Zugriff auf fachfremde Geschäftsinformationen oder Bedienung über fremde Konten ist untersagt.',
    ),
  },
  {
    title: 'Upload und Pflege von Daten',
    content: paragraph(
      'Vor dem Upload von Modellen, Zeichnungen, Bildern, Tabellen, Auswahldaten oder Anhängen müssen Nutzer prüfen, dass die Quelle rechtmäßig ist, der Inhalt korrekt ist, die Version gültig ist und die Daten für Speicherung und Freigabe auf der Plattform geeignet sind.',
      'Malware, Angriffsskripte, irrelevante Dateien, Materialien mit Verletzung von Rechten Dritter, kundenseitig gesperrte Materialien oder Inhalte, die gegen Gesetze, Kundenverträge oder Unternehmensregeln verstoßen, dürfen nicht hochgeladen werden.',
    ),
  },
  {
    title: 'Modellvorschau und Konvertierung',
    content: paragraph(
      'Die Plattform stellt Modellkonvertierung, Online-Vorschau, Thumbnail-Erzeugung, Messung, Materialanzeige und Freigabevorschau als Hilfsfunktionen bereit. Aufgrund von Quelldateiqualität, Formatkompatibilität, Browserleistung, Konvertierungstools und Anzeigegeräten können Vorschauergebnisse vom Originalentwurf oder vom realen Produkt abweichen.',
      'Formelle Produktion, Beschaffung, Bearbeitung, Montage und Lieferung sollten auf Zeichnungen, technischen Unterlagen, Musterdaten, physischer Bestätigung und fachlicher Prüfung basieren.',
    ),
  },
  {
    title: 'Downloads, Freigaben und externe Weitergabe',
    content: paragraph(
      'Modelldownloads, Zeichnungsdownloads, Bilddownloads und Freigabelinks dürfen nur für autorisierte Geschäftszwecke verwendet werden. Nutzer dürfen Links, Dateien oder Konten nicht an Unbeteiligte weitergeben und keine Anmeldung, Ablaufzeit, Downloadlimits, Passwortschutz oder Berechtigungskontrollen umgehen.',
      'Vor externer Weitergabe sind Kunde, Projekt, Version, Zweck und Datenberechtigung zu prüfen, um versehentliche Weitergabe alter, interner oder sensibler Daten zu vermeiden.',
    ),
  },
  {
    title: 'Produktauswahl und Spezifikationssuche',
    content: paragraph(
      'Produktauswahl, Gewinde- und Rohrgrößensuche, Schlauchspezifikationen, Fittingdaten und weitere Suchwerkzeuge sind geschäftliche Hilfsinformationen zur Verbesserung interner Suche und Kommunikation.',
      'Da Chargen, Lieferantenmuster, Einsatzbedingungen, Normversionen und Bestand variieren können, sind endgültige Modellnummern, Spezifikationen, Druckwerte, Materialien, Schnittstellen, Kompatibilität und Verfügbarkeit anhand offizieller Muster, Zeichnungen, technischer Bestätigung oder Geschäftsprozesse zu bestätigen.',
    ),
  },
  {
    title: 'Anfragen und Ticket-Zusammenarbeit',
    content: paragraph(
      'Anfragen, Nachrichten und Tickets auf der Plattform dienen der Dokumentation von Kommunikation, Anforderungen und Bearbeitungsfortschritt. Sie stellen nicht automatisch endgültige Angebote, Vertragszusagen, Serviceentscheidungen oder Haftungsfeststellungen dar.',
      'Inhalte zu Preisen, Lieferzeiten, Zahlungen, Rückgaben, Verantwortlichkeiten, Vertragsbedingungen und Kundenzusagen müssen durch die zuständigen Abteilungen über offizielle Unternehmensprozesse bestätigt werden.',
    ),
  },
  {
    title: 'Verhaltensregeln',
    content: paragraph(
      'Nutzer dürfen die Plattform nicht für rechtswidrige oder regelwidrige Aktivitäten nutzen, keine Viren oder Angriffsskripte hochladen, den Betrieb nicht stören, Daten nicht böswillig löschen, verändern oder fälschen und Funktionen für Massendownload, Freigabe, Upload oder API-Zugriff nicht missbrauchen.',
      'Bei ungewöhnlichen Konten, auffälligen Downloads, Lecks sensibler Daten, falschen Daten, Systemschwachstellen oder Angriffsverdacht sind Administratoren oder zuständige Verantwortliche zeitnah zu informieren.',
    ),
  },
  {
    title: 'Datenqualität und Pflege',
    content: paragraph(
      'Beim Erstellen von Modellen, Kategorien, Auswahlparametern, Produktbildern, Spezifikationsdaten und Galeriebildern sollten Namen, Modellnummern, Kategorien, Einheiten, Bilder, Beschreibungen und Versionsinformationen möglichst korrekt gehalten werden.',
      'Administratoren dürfen offensichtlich falsche, doppelte, abgelaufene, unvollständige oder regelwidrig benannte Daten anpassen, zusammenführen, deaktivieren, archivieren oder löschen.',
    ),
  },
  {
    title: 'Geistiges Eigentum und Vertraulichkeit',
    content: paragraph(
      'Modelle, Zeichnungen, Bilder, Auswahldaten, Kundenfälle, Standortfotos und Geschäftsaufzeichnungen auf der Plattform können durch geistige Eigentumsrechte, Geschäftsgeheimnisse, Kundenanforderungen oder Unternehmensregeln geschützt sein.',
      'Ohne Autorisierung dürfen Nutzer solche Daten nicht kopieren, verbreiten, öffentlich zeigen, an Dritte weitergeben oder für Zwecke außerhalb des Unternehmensgeschäfts verwenden. Die Codelizenz der Plattform ändert nicht Eigentums- oder Vertraulichkeitsanforderungen für hochgeladene Geschäfts-, Kunden- oder Unternehmensdaten.',
    ),
  },
  {
    title: 'Systemwartung und Verfügbarkeit',
    content: paragraph(
      'Die Plattform kann wegen Versionsupdates, Backups, Dateiwiederherstellung, Modellneuaufbau, Serverwartung, Ressourcenmigration oder Störungsbehebung vorübergehend nicht verfügbar sein. Administratoren können bei Bedarf Wartungsmodus aktivieren, Funktionen einschränken oder auffällige Aufgaben bereinigen.',
      'Nutzer sollten die Plattform nicht als einzigen Speicherort für wichtige Materialien verwenden. Wichtige Daten sind gemäß Unternehmensanforderungen zu sichern, zu archivieren und versioniert zu verwalten.',
    ),
  },
  {
    title: 'Haftungsbeschränkung',
    content: paragraph(
      'Soweit gesetzlich zulässig, haftet die Plattform nicht für mittelbare Verluste durch Netzwerkfehler, Serverausfälle, Drittkomponenten, Browserkompatibilität, Fehlbedienung, fehlerhafte Eingaben, Abweichungen bei Modellkonvertierung, Cache-Verzögerungen oder höhere Gewalt.',
      'Interne Management- und Geschäftsverantwortung richtet sich nach Unternehmensregeln, Zuständigkeiten, Berechtigungsgrenzen und formellen Geschäftsdokumenten.',
    ),
  },
  {
    title: 'Umgang mit Verstößen',
    content: paragraph(
      'Bei Verstößen gegen diese Bedingungen, Unternehmensregeln oder Kundenanforderungen zur Vertraulichkeit können Administratoren je nach Schwere Hinweise geben, Funktionen beschränken, Rechte entziehen, Konten deaktivieren, regelwidrige Inhalte löschen, Protokolle sichern und Verantwortliche informieren.',
      'Bei Verdacht auf rechtswidrige Handlungen, schwere Sicherheitsvorfälle oder erhebliche Datenlecks kann eine weitergehende Behandlung gemäß Unternehmensregeln und gesetzlichen Anforderungen erfolgen.',
    ),
  },
  {
    title: 'Aktualisierung der Bedingungen',
    content: paragraph(
      'Diese Nutzungsbedingungen können aktualisiert werden, wenn sich Funktionen, Organisationsprozesse, Compliance-Anforderungen, Bereitstellungsumgebung oder Geschäftsrichtlinien ändern.',
      'Nach Veröffentlichung aktualisierter Bedingungen bedeutet die weitere Nutzung der Website, dass der Nutzer die neuen Bedingungen versteht und akzeptiert. Wer nicht zustimmt, sollte die betroffenen Funktionen nicht weiter nutzen und einen Administrator kontaktieren.',
    ),
  },
];

export function getDefaultLegalSectionsForLocale(
  isPrivacy: boolean,
  locale: 'zh-CN' | 'zh-TW' | 'en-US' | 'ja-JP' | 'ko-KR' | 'de-DE',
) {
  if (locale === 'en-US') return isPrivacy ? DEFAULT_PRIVACY_SECTIONS_EN : DEFAULT_TERMS_SECTIONS_EN;
  if (locale === 'ja-JP') return isPrivacy ? DEFAULT_PRIVACY_SECTIONS_JA : DEFAULT_TERMS_SECTIONS_JA;
  if (locale === 'ko-KR') return isPrivacy ? DEFAULT_PRIVACY_SECTIONS_KO : DEFAULT_TERMS_SECTIONS_KO;
  if (locale === 'de-DE') return isPrivacy ? DEFAULT_PRIVACY_SECTIONS_DE : DEFAULT_TERMS_SECTIONS_DE;
  return isPrivacy ? DEFAULT_PRIVACY_SECTIONS : DEFAULT_TERMS_SECTIONS;
}

function normalizeComparableSection(section: LegalSection) {
  return {
    title: section.title.trim(),
    content: section.content
      .split(/\n+/)
      .map((item) => item.trim())
      .filter(Boolean)
      .join('\n'),
  };
}

export function isDefaultLegalSections(sections: LegalSection[], fallback: LegalSection[]) {
  if (sections.length !== fallback.length) return false;
  return sections.every((section, index) => {
    const current = normalizeComparableSection(section);
    const expected = normalizeComparableSection(fallback[index]);
    return current.title === expected.title && current.content === expected.content;
  });
}

function normalizeLegalSections(value: unknown): LegalSection[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const section = item as Partial<LegalSection>;
      const title = typeof section.title === 'string' ? section.title.trim() : '';
      const content = typeof section.content === 'string' ? section.content.trim() : '';
      return title && content ? { title, content } : null;
    })
    .filter((item): item is LegalSection => Boolean(item));
}

export function parseLegalSections(value: unknown, fallback: LegalSection[]): LegalSection[] {
  if (Array.isArray(value)) {
    const sections = normalizeLegalSections(value);
    return sections.length > 0 ? sections : fallback;
  }
  if (typeof value !== 'string' || !value.trim()) return fallback;
  try {
    const sections = normalizeLegalSections(JSON.parse(value));
    return sections.length > 0 ? sections : fallback;
  } catch {
    return fallback;
  }
}
