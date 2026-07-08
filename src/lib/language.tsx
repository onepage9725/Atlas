import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type AppLanguage = "en" | "zh";

type LanguageContextValue = {
  language: AppLanguage;
  setLanguage: (language: AppLanguage) => void;
  toggleLanguage: () => void;
};

const STORAGE_KEY = "atlas-language";

const ZH_TRANSLATIONS: Record<string, string> = {
  "Dashboard": "仪表板",
  "Events": "活动",
  "Users": "用户",
  "Sales Cases": "销售案例",
  "Team": "团队",
  "Ranking": "排行榜",
  "Rank Progress": "晋升进度",
  "Manage Cases": "案例管理",
  "Cases Approval": "案例审批",
  "Payout Approval": "付款审批",
  "Payment Voucher": "付款凭证",
  "My Payment Voucher": "我的付款凭证",
  "Finance": "财务",
  "Projects": "项目",
  "Sign out": "退出登录",
  "Notifications": "通知",
  "No notifications yet.": "暂无通知。",
  "Search...": "搜索...",
  "Open notifications": "打开通知",
  "Open profile": "打开个人资料",
  "Open navigation menu": "打开导航菜单",
  "Delete notification": "删除通知",
  "Close": "关闭",
  "Loading...": "加载中...",
  "Total GDV": "总销售额（GDV）",
  "Total Nett Sales": "总净销售额",
  "Total Sales": "总佣金",
  "Total Converted": "已转化总额",
  "Total Number of Cases": "案例总数",
  "Total Paid Out To Agent": "已支付给成员",
  "Total Amount": "总金额",
  "Total Payment Voucher": "付款凭证总数",
  "Payment Voucher History": "付款凭证记录",
  "Generated Payment Voucher History": "已生成付款凭证记录",
  "Generated Date": "生成日期",
  "Voucher": "凭证",
  "Amount (RM)": "金额（RM）",
  "Details": "详情",
  "Action": "操作",
  "Delete": "删除",
  "Download PDF": "下载 PDF",
  "No payment voucher found.": "未找到付款凭证。",
  "Loading vouchers...": "正在加载凭证...",
  "Track by Month": "按月份筛选",
  "Track by Year": "按年份筛选",
  "Filter by Month": "按月份筛选",
  "Filter by Year": "按年份筛选",
  "Filter by Project": "按项目筛选",
  "Filter by Status": "按状态筛选",
  "Filter by Row Type": "按记录类型筛选",
  "All projects": "全部项目",
  "All status": "全部状态",
  "All rows": "全部记录",
  "Pending": "待处理",
  "Signed LO": "已签 LO",
  "Claimable": "可领取",
  "Approve": "已批准",
  "Completed": "已完成",
  "Cancel": "已取消",
  "Reject": "已拒绝",
  "Created Date": "创建日期",
  "Booking Date": "认购日期",
  "Project": "项目",
  "Unit": "单位",
  "SPA Price (RM)": "SPA 价格（RM）",
  "Nett Price (RM)": "净价（RM）",
  "Created By": "创建人",
  "Booking Form": "认购表",
  "Row Type": "记录类型",
  "Status": "状态",
  "Direct Comm": "直佣",
  "Holding Comm": "Holding 佣金",
  "Top-up": "补差",
  "Sales case approved": "销售案例已批准",
  "Signed LO draft uploaded": "已上传签署 LO 草稿",
  "New sales case added": "新增销售案例",
  "Sales case deleted": "销售案例已删除",
  "Payment voucher generated": "付款凭证已生成",
  "Actions": "操作",
  "Create Event": "创建活动",
  "Edit Event": "编辑活动",
  "Save Event": "保存活动",
  "Saving...": "保存中...",
  "Add event details, dates, and image attachments": "添加活动详情、日期和图片附件",
  "Event Details": "活动详情",
  "Event Name": "活动名称",
  "Start Date": "开始日期",
  "End Date": "结束日期",
  "Optional for single-day events.": "单日活动可不填。",
  "Description": "描述",
  "Add event description": "添加活动描述",
  "Attach Image": "上传图片",
  "Upload Image": "上传图片",
  "No file selected": "未选择文件",
  "Click the image to replace it.": "点击图片可更换。",
  "View full image": "查看完整图片",
  "Saved Events": "已保存活动",
  "Cancel edit": "取消编辑",
  "Event": "活动",
  "Dates": "日期",
  "Image": "图片",
  "No description": "暂无描述",
  "No image": "暂无图片",
  "No events yet. Add your first event above.": "暂无活动。请先在上方添加第一个活动。",
  "Create Account": "创建账号",
  "Create a new user with a temporary password and role.": "使用临时密码和角色创建新用户。",
  "Creating...": "创建中...",
  "Create User": "创建用户",
  "New Account": "新账号",
  "Name": "姓名",
  "User full name": "用户全名",
  "Email": "邮箱",
  "Temporary Password": "临时密码",
  "Temporary password": "临时密码",
  "Role": "角色",
  "Starting Role": "初始等级",
  "Personal Points": "个人积分",
  "Enter member points": "输入成员积分",
  "1 point = RM 1 commission.": "1 积分 = RM 1 佣金。",
  "Enter group points": "输入团队积分",
  "Recruit By": "推荐人",
  "None": "无",
  "Leader Name": "上级 Leader",
  "Personal points:": "个人积分：",
  "Group points:": "团队积分：",
  "Direct recruits:": "直属招募：",
  "Total Admin": "管理员总数",
  "Total Leader": "Leader 总数",
  "Total Pre Leader": "Pre Leader 总数",
  "Total Agent": "Agent 总数",
  "User Directory": "用户目录",
  "Refresh": "刷新",
  "Search User": "搜索用户",
  "All ranks": "全部等级",
  "Profile": "档案",
  "Bank Name": "银行名称",
  "Account Number": "银行账号",
  "Member Rank": "成员等级",
  "Personal": "个人",
  "Group": "团队",
  "recruits": "人招募",
  "Active": "启用",
  "Inactive": "停用",
  "Deactivating...": "停用中...",
  "Activating...": "启用中...",
  "Deactivate": "停用",
  "Activate": "启用",
  "Deleting...": "删除中...",
  "No profiles found.": "未找到用户。",
  "Edit Profile": "编辑资料",
  "Update member details, points, rank, and profile picture.": "更新成员资料、积分、等级与头像。",
  "Display Name": "显示名称",
  "User name": "用户名",
  "Track the monthly leaderboard for agents, pre leaders, and leaders.": "追踪 Agent、Pre Leader 与 Leader 的月度排行榜。",
  "All Time": "全部时间",
  "Agent": "Agent",
  "Pre Leader": "Pre Leader",
  "Leader": "Leader",
  "Personal GDV": "个人 GDV",
  "Personal Sales": "个人销售额",
  "Team GDV": "团队 GDV",
  "Team Sales": "团队销售额",
  "Rank Category": "排行榜类别",
  "Ranking Metric": "排行指标",
  "Champion": "冠军",
  "1st Runner Up": "亚军",
  "2nd Runner Up": "季军",
  "No ranking data for this slot yet.": "该名次暂无排行数据。",
  "Monthly Ranking": "月度排行",
  "No members found for this rank in the selected month.": "所选月份中该等级暂无成员数据。",
  "Member": "成员",
  "Current Rank": "当前等级",
  "Search Unit / Project": "搜索单位 / 项目",
  "Sort by Signed LO Date": "按签署 LO 日期排序",
  "Signed LO From": "签署 LO 起始日期",
  "Signed LO To": "签署 LO 截止日期",
  "Leave blank for all time.": "留空表示不限时间。",
  "Newest first": "最新优先",
  "Oldest first": "最早优先",
  "Project & Unit": "项目与单位",
  "SPA (RM)": "SPA（RM）",
  "Nett (RM)": "净价（RM）",
  "Commission %": "佣金 %",
  "Pre Leader Override %": "Pre Leader Override %",
  "Leader Override %": "Leader Override %",
  "Payout Comm (RM)": "支付佣金（RM）",
  "Approve 1st Comm": "批准第一笔佣金",
  "Approve Holding Comm": "批准 Holding 佣金",
  "Approving...": "审批中...",
  "No payout rows found.": "未找到付款记录。",
  "Review and settle commission payout rows for approved cases.": "审核并结算已批准案例的佣金支付记录。",
  "Company Pending Case": "公司待收案例",
  "Company Pending Comm": "公司待收佣金",
  "Agent Pending Case": "成员待付案例",
  "Agent Pending Comm": "成员待付佣金",
  "Cases waiting for developer payment.": "等待开发商付款的案例。",
  "Company commission pending from developers.": "开发商待支付的公司佣金。",
  "Cases with unpaid member commission rows.": "包含未支付成员佣金的案例。",
  "Total unpaid member commission amount.": "成员未支付佣金总额。",
  "All Ranks": "全部等级",
  "All Leaders": "全部 Leaders",
  "Filter by Leader": "按 Leader 筛选",
  "Search User Name": "搜索用户名",
  "Current rank:": "当前等级：",
  "Eligible rank:": "可晋升等级：",
  "Click to view related cases": "点击查看相关案例",
  "Review each member's progress toward the next rank, with leader rows shown first.": "查看每位成员的晋升进度（Leader 排在前面）。",
  "Showing all agent members ranked by personal sales for the selected month.": "显示所选月份按个人销售额排序的所有 Agent 成员。",
};

const ZH_PREFIX_TRANSLATIONS: Array<{ prefix: string; translatedPrefix: string }> = [
  { prefix: "Current rank: ", translatedPrefix: "当前等级：" },
  { prefix: "Eligible rank: ", translatedPrefix: "可晋升等级：" },
  { prefix: "Highest rank benchmark: ", translatedPrefix: "最高等级基准：" },
  { prefix: "Next rank: ", translatedPrefix: "下一等级：" },
  { prefix: "Viewer: ", translatedPrefix: "查看者：" },
];

const translateDynamicText = (source: string) => {
  for (const item of ZH_PREFIX_TRANSLATIONS) {
    if (source.startsWith(item.prefix)) {
      return `${item.translatedPrefix}${source.slice(item.prefix.length)}`;
    }
  }

  const eventCountMatch = source.match(/^(\d+)\s+events saved$/);

  if (eventCountMatch) {
    return `${eventCountMatch[1]} 个活动已保存`;
  }

  const rankingSummaryMatch = source.match(/^Showing all (.+) members ranked by (.+) for the selected month\.$/);

  if (rankingSummaryMatch) {
    return `显示所选月份按${rankingSummaryMatch[2]}排序的所有${rankingSummaryMatch[1]}成员。`;
  }

  return null;
};

const LanguageContext = createContext<LanguageContextValue | null>(null);

type AtlasTextNode = Text & { __atlasOriginal?: string; __atlasWasTranslated?: boolean };
type AtlasElement = HTMLElement & { __atlasAttrOriginal?: Record<string, string | null> };

const applyTranslationToTextNode = (node: AtlasTextNode, language: AppLanguage) => {
  const currentValue = node.nodeValue ?? "";

  if (node.__atlasOriginal === undefined) {
    node.__atlasOriginal = currentValue;
  }

  if (language === "en") {
    if (node.__atlasWasTranslated && node.nodeValue !== node.__atlasOriginal) {
      node.nodeValue = node.__atlasOriginal;
    }

    // Keep the source text in sync with live UI updates while English is active.
    node.__atlasOriginal = node.nodeValue ?? "";
    node.__atlasWasTranslated = false;
    return;
  }

  const source = node.__atlasOriginal;
  const leadingWhitespace = source.match(/^\s*/)?.[0] ?? "";
  const trailingWhitespace = source.match(/\s*$/)?.[0] ?? "";
  const trimmedSource = source.trim();

  if (!trimmedSource) {
    return;
  }

  const translated = ZH_TRANSLATIONS[trimmedSource];

  if (translated) {
    const nextValue = `${leadingWhitespace}${translated}${trailingWhitespace}`;

    if (node.nodeValue !== nextValue) {
      node.nodeValue = nextValue;
    }

    node.__atlasWasTranslated = true;

    return;
  }

  const dynamicTranslated = translateDynamicText(trimmedSource);

  if (dynamicTranslated) {
    const nextValue = `${leadingWhitespace}${dynamicTranslated}${trailingWhitespace}`;

    if (node.nodeValue !== nextValue) {
      node.nodeValue = nextValue;
    }

    node.__atlasWasTranslated = true;
    return;
  }

  node.__atlasWasTranslated = false;
};

const applyTranslationToElementAttributes = (element: AtlasElement, language: AppLanguage) => {
  const attrs: Array<"placeholder" | "title" | "aria-label"> = ["placeholder", "title", "aria-label"];

  if (!element.__atlasAttrOriginal) {
    element.__atlasAttrOriginal = {};

    attrs.forEach((attr) => {
      element.__atlasAttrOriginal![attr] = element.getAttribute(attr);
    });
  }

  attrs.forEach((attr) => {
    const original = element.__atlasAttrOriginal?.[attr] ?? null;

    if (language === "en") {
      if (original === null) {
        element.removeAttribute(attr);
      } else {
        if (element.getAttribute(attr) !== original) {
          element.setAttribute(attr, original);
        }
      }
      return;
    }

    if (!original) {
      return;
    }

    const translated = ZH_TRANSLATIONS[original.trim()];

    if (translated) {
      if (element.getAttribute(attr) !== translated) {
        element.setAttribute(attr, translated);
      }
    }
  });
};

const applyLanguageToDocument = (language: AppLanguage) => {
  const root = document.body;

  if (!root) {
    return;
  }

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      const parent = node.parentElement;

      if (!parent) {
        return NodeFilter.FILTER_REJECT;
      }

      const parentTag = parent.tagName.toLowerCase();

      if (parentTag === "script" || parentTag === "style" || parentTag === "noscript") {
        return NodeFilter.FILTER_REJECT;
      }

      const value = node.nodeValue ?? "";

      if (!value.trim()) {
        return NodeFilter.FILTER_REJECT;
      }

      return NodeFilter.FILTER_ACCEPT;
    },
  });

  let textNode = walker.nextNode();

  while (textNode) {
    applyTranslationToTextNode(textNode as AtlasTextNode, language);
    textNode = walker.nextNode();
  }

  const elements = root.querySelectorAll<AtlasElement>("[placeholder], [title], [aria-label]");
  elements.forEach((element) => applyTranslationToElementAttributes(element, language));
};

export const LanguageProvider = ({ children }: { children: ReactNode }) => {
  const [language, setLanguageState] = useState<AppLanguage>(() => {
    const storedLanguage = localStorage.getItem(STORAGE_KEY);
    return storedLanguage === "zh" ? "zh" : "en";
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, language);
    document.documentElement.setAttribute("lang", language === "zh" ? "zh-CN" : "en");

    applyLanguageToDocument(language);

    const observer = new MutationObserver(() => {
      applyLanguageToDocument(language);
    });

    observer.observe(document.body, {
      subtree: true,
      childList: true,
    });

    return () => observer.disconnect();
  }, [language]);

  const setLanguage = (nextLanguage: AppLanguage) => {
    setLanguageState(nextLanguage === "zh" ? "zh" : "en");
  };

  const toggleLanguage = () => {
    setLanguageState((current) => (current === "en" ? "zh" : "en"));
  };

  const value = useMemo(
    () => ({ language, setLanguage, toggleLanguage }),
    [language]
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
};

export const useLanguage = () => {
  const context = useContext(LanguageContext);

  if (!context) {
    throw new Error("useLanguage must be used within LanguageProvider");
  }

  return context;
};
