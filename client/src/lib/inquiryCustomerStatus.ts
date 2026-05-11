export type CustomerInquiryStatusView = {
  label: string;
  progress: string;
  guide: string;
  badgeClassName: string;
};

export type CustomerInquiryFlowStep = {
  key: string;
  title: string;
  description: string;
};

const DEFAULT_VIEW: CustomerInquiryStatusView = {
  label: '处理中',
  progress: '业务正在处理，请留意沟通记录',
  guide: '询价已保存，业务人员会根据产品明细继续处理。',
  badgeClassName: 'bg-surface-container-high text-on-surface-variant',
};

const STATUS_VIEWS: Record<string, CustomerInquiryStatusView> = {
  submitted: {
    label: '业务确认中',
    progress: '已提交，等待业务确认',
    guide: '业务人员会先核对产品、数量和联系方式，确认后会在沟通记录里回复。',
    badgeClassName: 'bg-primary-container/10 text-primary-container',
  },
  quoted: {
    label: '业务已回复',
    progress: '业务已回复，请查看沟通记录',
    guide: '业务已回复报价、交期或确认意见，如需补充需求可继续留言。',
    badgeClassName: 'bg-green-500/15 text-green-600',
  },
  accepted: {
    label: '销售跟进中',
    progress: '已转销售，等待线下对接',
    guide: '该询价已转销售跟进，请留意后续线下对接信息。',
    badgeClassName: 'bg-emerald-500/15 text-emerald-600',
  },
  rejected: {
    label: '已关闭',
    progress: '询价已关闭，可重新提交需求',
    guide: '该询价已关闭，历史记录仍可查看；如需继续沟通请重新提交询价。',
    badgeClassName: 'bg-red-500/10 text-red-500',
  },
  cancelled: {
    label: '已取消',
    progress: '询价已取消',
    guide: '该询价已取消，历史记录仍可查看；如需继续沟通请重新提交询价。',
    badgeClassName: 'bg-surface-container-high text-on-surface-variant',
  },
};

export function getCustomerInquiryStatusView(status: string): CustomerInquiryStatusView {
  return STATUS_VIEWS[status] || DEFAULT_VIEW;
}

export function getCustomerInquiryFlow(status: string, assigneeName?: string) {
  const terminalStatus = status === 'rejected' || status === 'cancelled';
  const activeIndex = terminalStatus ? 3 : status === 'accepted' ? 3 : status === 'quoted' ? 2 : 1;
  const finalTitle = terminalStatus ? (status === 'cancelled' ? '已取消' : '已关闭') : '销售跟进';
  const salesDescription = assigneeName ? `由 ${assigneeName} 继续跟进。` : '需要线下推进时会安排对接人。';
  const steps: CustomerInquiryFlowStep[] = [
    {
      key: 'submitted',
      title: '提交需求',
      description: '询价需求已提交。',
    },
    {
      key: 'review',
      title: '业务确认',
      description: '业务正在核对产品、数量和联系方式。',
    },
    {
      key: 'reply',
      title: '业务回复',
      description: '查看报价、交期或参数确认意见。',
    },
    {
      key: 'follow',
      title: finalTitle,
      description: terminalStatus ? '该询价流程已结束。' : salesDescription,
    },
  ];
  const nextText = terminalStatus
    ? '流程已结束，记录会保留用于查看。'
    : status === 'submitted'
      ? '下一步：业务回复'
      : status === 'quoted'
        ? '下一步：销售跟进或继续沟通'
        : '下一步：线下对接确认';

  return {
    activeIndex,
    nextText,
    steps,
    status: getCustomerInquiryStatusView(status),
    terminalStatus,
  };
}
