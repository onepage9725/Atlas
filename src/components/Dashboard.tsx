import { useEffect, useMemo, useState } from "react";
import { KPICard } from "./KPICard";
import { PaymentBehaviorChart } from "./PaymentBehaviorChart";
import { supabase } from "../lib/supabaseClient";
import {
  getCaseCommissionStructure,
  getDirectCommissionPercentage,
  getHoldingCommissionPercentage,
} from "../lib/commissionStructures";
import { buildCommissionStructureByTotalPercentage } from "../lib/salesCasePayouts";
import {
  getCaseCommissionAmountForProfiles,
  getCasePersonalAmountForProfiles,
  getCompletedCommissionAmountForProfiles,
  getStoredInvolvedProfileId,
} from "../lib/salesCaseMetrics";
import { normalizeCaseStatus, type ProjectOption, type SalesCasePayoutRecord, type SalesCaseRecord } from "./SalesCaseModal";

type EventSummary = {
  id: string;
  event_name: string;
  start_date: string | null;
  end_date: string | null;
  description: string | null;
  image_url: string | null;
};

type ProfileOption = {
  id: string;
  role: string | null;
  rank: string | null;
  recruit_by: string | null;
};

type FinanceEntryRecord = {
  id: string;
  entry_type: "cash_in" | "cash_out";
  amount: number;
  description: string | null;
  entry_scope?: string | null;
  reference_detail: string | null;
  attachment_url: string | null;
  transacted_at: string;
};

type VoucherHistoryMeta = {
  payoutIds?: string[];
  componentKeys?: string[];
  salesCaseIds?: string[];
  grossAmount?: number;
};

type DashboardProps = {
  role?: string | null;
  rank?: string | null;
  userId?: string | null;
};

const formatAmount = (value: number | null) => {
  if (value === null || Number.isNaN(value)) return "-";
  const roundedValue = Number(value.toFixed(2));
  const hasDecimals = Math.round(roundedValue) !== roundedValue;
  return roundedValue.toLocaleString("en-MY", {
    minimumFractionDigits: hasDecimals ? 2 : 0,
    maximumFractionDigits: 2,
  });
};

const getLocalDateInputValue = (date: Date) => {
  const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return offsetDate.toISOString().slice(0, 10);
};

const getLocalDateValueFromTimestamp = (value: string | null) => {
  if (!value) {
    return "";
  }

  const parsedDate = new Date(value);

  if (Number.isNaN(parsedDate.getTime())) {
    return value.slice(0, 10);
  }

  return getLocalDateInputValue(parsedDate);
};

const isMemberProfile = (profile: Pick<ProfileOption, "role" | "rank">) =>
  profile.role === "agent" ||
  profile.role === "leader" ||
  profile.rank === "agent" ||
  profile.rank === "pre_leader" ||
  profile.rank === "leader";

const isLeaderProfile = (profile: Pick<ProfileOption, "role" | "rank"> | null | undefined) =>
  Boolean(profile && (profile.role === "leader" || profile.rank === "leader"));

const isPreLeaderProfile = (profile: Pick<ProfileOption, "rank"> | null | undefined) =>
  Boolean(profile && profile.rank === "pre_leader");

const HISTORY_META_SEPARATOR = "|||META|||";

const parseVoucherHistoryMeta = (referenceDetail: string | null | undefined) => {
  const rawDetail = (referenceDetail ?? "").trim();
  const [, metaPayload] = rawDetail.split(HISTORY_META_SEPARATOR);

  if (!metaPayload) {
    return null;
  }

  try {
    const [metaJson] = metaPayload.split(" | ");
    return JSON.parse(metaJson) as VoucherHistoryMeta;
  } catch {
    return null;
  }
};

const getPayoutIdFromComponentKey = (componentKey: string) => {
  if (/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(componentKey)) {
    return componentKey;
  }

  const uuidPrefixMatch = componentKey.match(/^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})-/);

  if (uuidPrefixMatch?.[1]) {
    return uuidPrefixMatch[1];
  }

  const suffixes = ["-pre-leader-override", "-leader-override", "-comm"];
  const matchedSuffix = suffixes.find((suffix) => componentKey.endsWith(suffix));

  if (!matchedSuffix) {
    return null;
  }

  return componentKey.slice(0, -matchedSuffix.length);
};

const isReleasedHoldingTopUp = (payout: SalesCasePayoutRecord) => {
  if (payout.payout_type !== "tier_upgrade_top_up") {
    return false;
  }

  const source = (payout.source_commission_structure_id ?? "").toLowerCase();
  const target = (payout.target_commission_structure_id ?? "").toLowerCase();
  const sourceLabel = (payout.source_commission_structure_label ?? "").toLowerCase();
  const targetLabel = (payout.target_commission_structure_label ?? "").toLowerCase();

  const sourceMatches = source === "holding_commission" || sourceLabel === "holding commission";
  const targetMatches = target === "released" || targetLabel === "released";

  return sourceMatches && targetMatches;
};

export function Dashboard({ role, rank, userId }: DashboardProps) {
  const [events, setEvents] = useState<EventSummary[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [selectedEvent, setSelectedEvent] = useState<EventSummary | null>(null);
  const [cases, setCases] = useState<SalesCaseRecord[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [profiles, setProfiles] = useState<ProfileOption[]>([]);
  const [payouts, setPayouts] = useState<SalesCasePayoutRecord[]>([]);
  const [entries, setEntries] = useState<FinanceEntryRecord[]>([]);

  const isSuperAdmin = role === "super_admin";
  const isAdmin = role === "admin";
  const isMemberAccount =
    role === "agent" ||
    role === "leader" ||
    rank === "agent" ||
    rank === "pre_leader" ||
    rank === "leader";
  const canViewSummaryMetrics = isSuperAdmin || isAdmin;
  const canViewMemberMetrics = Boolean(userId && isMemberAccount);
  const canLoadMetricData = canViewSummaryMetrics || canViewMemberMetrics;
  const today = new Date();
  const defaultFromDate = getLocalDateInputValue(new Date(today.getFullYear(), today.getMonth(), 1));
  const defaultToDate = getLocalDateInputValue(new Date(today.getFullYear(), today.getMonth() + 1, 0));

  useEffect(() => {
    const fetchEvents = async () => {
      const { data } = await supabase
        .from("events")
        .select("id, event_name, start_date, end_date, description, image_url")
        .order("created_at", { ascending: false })
        .limit(3);

      setEvents((data as EventSummary[]) ?? []);
    };

    fetchEvents();
  }, []);

  useEffect(() => {
    if (!canLoadMetricData) {
      return;
    }

    const loadSummaryData = async () => {
      const [caseResult, payoutResult, entryResult, projectResult, profileResult] = await Promise.all([
        supabase.from("sales_cases").select("*").order("created_at", { ascending: false }),
        supabase
          .from("sales_case_payouts")
          .select("*")
          .in("payout_status", ["Pending", "Approve", "Paid"])
          .order("paid_at", { ascending: false })
          .order("approved_at", { ascending: false })
          .order("created_at", { ascending: false }),
        supabase
          .from("finance_entries")
          .select("id, entry_type, amount, description, entry_scope, reference_detail, attachment_url, transacted_at")
          .order("transacted_at", { ascending: false })
          .order("created_at", { ascending: false }),
        supabase
          .from("projects")
          .select(
            "id, project_name, company_commission, agent_commission, pre_leader_override, leader_override, commission_structures, default_commission_structure_id"
          )
          .eq("is_hidden", false),
        supabase
          .from("profiles")
          .select("id, role, rank, recruit_by")
          .is("deleted_at", null),
      ]);

      setCases((caseResult.data as SalesCaseRecord[]) ?? []);
      setPayouts((payoutResult.data as SalesCasePayoutRecord[]) ?? []);
      setEntries(
        ((entryResult.data as FinanceEntryRecord[]) ?? []).filter(
          (entry) => entry.entry_scope !== "company_commission_hidden"
        )
      );
      setProjects((projectResult.data as ProjectOption[]) ?? []);
      setProfiles((profileResult.data as ProfileOption[]) ?? []);
    };

    loadSummaryData();
  }, [canLoadMetricData]);

  useEffect(() => {
    if (events.length <= 1) return;

    const interval = window.setInterval(() => {
      setActiveIndex((prev) => (prev + 1) % events.length);
    }, 6000);

    return () => window.clearInterval(interval);
  }, [events.length]);

  const activeEvent = useMemo(() => events[activeIndex] ?? null, [events, activeIndex]);

  const projectMap = useMemo(() => {
    const map = new Map<string, ProjectOption>();
    projects.forEach((project) => map.set(project.id, project));
    return map;
  }, [projects]);

  const memberProfileIds = useMemo(
    () =>
      new Set(
        profiles
          .filter((profile) => profile.role !== "admin" && profile.role !== "super_admin")
          .map((profile) => profile.id)
      ),
    [profiles]
  );

  const payoutMap = useMemo(() => {
    const map = new Map<string, SalesCasePayoutRecord[]>();

    payouts.forEach((payout) => {
      const relatedPayouts = map.get(payout.sales_case_id) ?? [];
      relatedPayouts.push(payout);
      map.set(payout.sales_case_id, relatedPayouts);
    });

    return map;
  }, [payouts]);

  const profileMap = useMemo(() => {
    const map = new Map<string, ProfileOption>();
    profiles.forEach((profile) => map.set(profile.id, profile));
    return map;
  }, [profiles]);

  const currentProfile = useMemo(() => (userId ? profileMap.get(userId) ?? null : null), [profileMap, userId]);

  const getViewerHoldingCommission = (record: SalesCaseRecord) => {
    if (!userId) {
      return 0;
    }

    const project = record.project_id ? projectMap.get(record.project_id) ?? null : null;
    const commissionStructure = getCaseCommissionStructure(record, project);
    const holdingPercentage = getHoldingCommissionPercentage(commissionStructure);
    const holdingCommissionStructure = commissionStructure
      ? buildCommissionStructureByTotalPercentage(
          commissionStructure,
          holdingPercentage,
          `${commissionStructure.id}-holding`,
          commissionStructure.label,
        )
      : null;

    if (!project || holdingPercentage <= 0 || !commissionStructure || !holdingCommissionStructure) {
      return 0;
    }

    const viewerProfile = profileMap.get(userId) ?? null;
    const creatorProfile = record.created_by
      ? record.created_by === userId
        ? viewerProfile
        : profileMap.get(record.created_by) ?? null
      : null;
    const explicitInvolvedProfileId = getStoredInvolvedProfileId(record);
    const involvedProfile = explicitInvolvedProfileId
      ? explicitInvolvedProfileId === userId
        ? viewerProfile
        : profileMap.get(explicitInvolvedProfileId) ?? null
      : null;

    if (!viewerProfile) {
      return 0;
    }

    const participantIds = Array.from(
      new Set([record.created_by, explicitInvolvedProfileId].filter(Boolean))
    ) as string[];

    const participants = [creatorProfile, involvedProfile].filter(
      (profile, index, array): profile is ProfileOption =>
        Boolean(profile) && array.findIndex((item) => item?.id === profile?.id) === index
    );

    if (participantIds.length === 0) {
      return 0;
    }

    const splitAgentPercentage = (holdingCommissionStructure.agent_commission ?? 0) / participantIds.length;
    const splitPreLeaderPercentage = (holdingCommissionStructure.pre_leader_override ?? 0) / participantIds.length;
    const splitLeaderPercentage = (holdingCommissionStructure.leader_override ?? 0) / participantIds.length;
    let totalPercentage = 0;

    const getHoldingLeaderChain = (
      profile: ProfileOption | null,
      visitedIds = new Set<string>()
    ): { preLeader: ProfileOption | null; leader: ProfileOption | null } => {
      if (!profile) {
        return { preLeader: null, leader: null };
      }

      if (visitedIds.has(profile.id)) {
        return { preLeader: null, leader: null };
      }

      const nextVisitedIds = new Set(visitedIds);
      nextVisitedIds.add(profile.id);

      if (profile.rank === "leader") {
        return { preLeader: null, leader: profile };
      }

      const recruiter = profile.recruit_by ? profileMap.get(profile.recruit_by) ?? null : null;

      if (!recruiter) {
        return { preLeader: null, leader: null };
      }

      if (recruiter.rank === "leader") {
        return { preLeader: null, leader: recruiter };
      }

      if (recruiter.rank === "pre_leader") {
        const leader = recruiter.recruit_by ? profileMap.get(recruiter.recruit_by) ?? null : null;
        return { preLeader: recruiter, leader };
      }

      if (recruiter.rank === "agent") {
        return getHoldingLeaderChain(recruiter, nextVisitedIds);
      }

      return { preLeader: null, leader: null };
    };

    participants.forEach((participant) => {
      const chain = getHoldingLeaderChain(participant);

      if (participant.id === userId) {
        totalPercentage += splitAgentPercentage;
      }

      if (participant.rank === "agent") {
        const preLeaderRecipient = chain.preLeader ?? chain.leader;

        if (preLeaderRecipient?.id === userId) {
          totalPercentage += splitPreLeaderPercentage;
        }

        if (chain.leader?.id === userId) {
          totalPercentage += splitLeaderPercentage;
        }

        return;
      }

      if (participant.rank === "pre_leader") {
        if (participant.id === userId) {
          totalPercentage += splitPreLeaderPercentage;
        }

        if (chain.leader?.id === userId) {
          totalPercentage += splitLeaderPercentage;
        }

        return;
      }

      if (participant.rank === "leader" && participant.id === userId) {
        totalPercentage += splitPreLeaderPercentage + splitLeaderPercentage;
      }
    });

    return (record.nett_price ?? 0) * (totalPercentage / 100);
  };

  const getViewerCommission = (record: SalesCaseRecord) => {
    if (!userId) {
      return null;
    }

    const project = record.project_id ? projectMap.get(record.project_id) ?? null : null;
    const commissionStructure = getCaseCommissionStructure(record, project);
    const directPercentage = getDirectCommissionPercentage(commissionStructure);
    const directCommissionStructure = commissionStructure
      ? buildCommissionStructureByTotalPercentage(
          commissionStructure,
          directPercentage,
          `${commissionStructure.id}-direct`,
          commissionStructure.label,
        )
      : null;
    const viewerProfile = profileMap.get(userId) ?? null;
    const creatorProfile = record.created_by
      ? record.created_by === userId
        ? viewerProfile
        : profileMap.get(record.created_by) ?? null
      : null;
    const involvedUserId = getStoredInvolvedProfileId(record);
    const involvedProfile = involvedUserId
      ? involvedUserId === userId
        ? viewerProfile
        : profileMap.get(involvedUserId) ?? null
      : null;

    if (!project || !viewerProfile || !commissionStructure || !directCommissionStructure) {
      return null;
    }

    const participantIds = Array.from(
      new Set([record.created_by, involvedUserId].filter(Boolean))
    ) as string[];

    const participants = [creatorProfile, involvedProfile].filter(
      (profile, index, array): profile is ProfileOption =>
        Boolean(profile) && array.findIndex((item) => item?.id === profile?.id) === index
    );

    if (participantIds.length === 0) {
      return null;
    }

    const splitAgentPercentage = (directCommissionStructure.agent_commission ?? 0) / participantIds.length;
    const splitPreLeaderPercentage = (directCommissionStructure.pre_leader_override ?? 0) / participantIds.length;
    const splitLeaderPercentage = (directCommissionStructure.leader_override ?? 0) / participantIds.length;
    let totalPercentage = 0;

    const getLeaderChain = (
      profile: ProfileOption | null,
      visitedIds = new Set<string>()
    ): { preLeader: ProfileOption | null; leader: ProfileOption | null } => {
      if (!profile) {
        return { preLeader: null, leader: null };
      }

      if (visitedIds.has(profile.id)) {
        return { preLeader: null, leader: null };
      }

      const nextVisitedIds = new Set(visitedIds);
      nextVisitedIds.add(profile.id);

      if (profile.rank === "leader") {
        return { preLeader: null, leader: profile };
      }

      const recruiter = profile.recruit_by ? profileMap.get(profile.recruit_by) ?? null : null;

      if (!recruiter) {
        return { preLeader: null, leader: null };
      }

      if (recruiter.rank === "leader") {
        return { preLeader: null, leader: recruiter };
      }

      if (recruiter.rank === "pre_leader") {
        const leader = recruiter.recruit_by ? profileMap.get(recruiter.recruit_by) ?? null : null;
        return { preLeader: recruiter, leader };
      }

      if (recruiter.rank === "agent") {
        return getLeaderChain(recruiter, nextVisitedIds);
      }

      return { preLeader: null, leader: null };
    };

    participants.forEach((participant) => {
      const chain = getLeaderChain(participant);

      if (participant.id === userId) {
        totalPercentage += splitAgentPercentage;
      }

      if (participant.rank === "agent") {
        const preLeaderRecipient = chain.preLeader ?? chain.leader;
        if (preLeaderRecipient?.id === userId) {
          totalPercentage += splitPreLeaderPercentage;
        }
        if (chain.leader?.id === userId) {
          totalPercentage += splitLeaderPercentage;
        }
        return;
      }

      if (participant.rank === "pre_leader") {
        if (participant.id === userId) {
          totalPercentage += splitPreLeaderPercentage;
        }
        if (chain.leader?.id === userId) {
          totalPercentage += splitLeaderPercentage;
        }
        return;
      }

      if (participant.rank === "leader" && participant.id === userId) {
        totalPercentage += splitPreLeaderPercentage + splitLeaderPercentage;
      }
    });

    return (record.nett_price ?? 0) * (totalPercentage / 100);
  };

  const downlineIds = useMemo(() => {
    if (!currentProfile || !canViewMemberMetrics) {
      return [] as string[];
    }

    const isCurrentLeader = isLeaderProfile(currentProfile);
    const isCurrentPreLeader = isPreLeaderProfile(currentProfile);

    const byRecruiter = new Map<string, ProfileOption[]>();

    profiles.filter(isMemberProfile).forEach((profile) => {
      if (!profile.recruit_by) {
        return;
      }

      const recruiterProfiles = byRecruiter.get(profile.recruit_by) ?? [];
      recruiterProfiles.push(profile);
      byRecruiter.set(profile.recruit_by, recruiterProfiles);
    });

    const collectedIds = new Set<string>();

    const collectDescendants = (profileId: string, depth: number) => {
      const directReports = byRecruiter.get(profileId) ?? [];

      directReports.forEach((profile) => {
        if (collectedIds.has(profile.id)) {
          return;
        }

        collectedIds.add(profile.id);

        if (isCurrentLeader || (isCurrentPreLeader && depth === 0)) {
          collectDescendants(profile.id, depth + 1);
        }
      });
    };

    collectDescendants(currentProfile.id, 0);

    return Array.from(collectedIds);
  }, [canViewMemberMetrics, currentProfile, profiles]);

  const filteredCaseRows = useMemo(() => {
    return cases.filter((record) => {
      const createdAt = getLocalDateValueFromTimestamp(record.created_at);

      if (defaultFromDate && createdAt < defaultFromDate) {
        return false;
      }

      if (defaultToDate && createdAt > defaultToDate) {
        return false;
      }

      return true;
    });
  }, [cases, defaultFromDate, defaultToDate]);

  const memberCaseRows = useMemo(() => {
    if (!userId) {
      return [] as SalesCaseRecord[];
    }

    return cases.filter((record) => {
      const createdAt = getLocalDateValueFromTimestamp(record.created_at);

      if (defaultFromDate && createdAt < defaultFromDate) {
        return false;
      }

      if (defaultToDate && createdAt > defaultToDate) {
        return false;
      }

      const relatedIds = [record.created_by, ...(record.involved_user_ids ?? [])].filter(Boolean) as string[];
      return relatedIds.includes(userId);
    });
  }, [cases, defaultFromDate, defaultToDate, userId]);

  const memberTeamCaseRows = useMemo(() => {
    if (!userId) {
      return [] as SalesCaseRecord[];
    }

    const teamIdSet = new Set([userId, ...downlineIds]);

    return cases.filter((record) => {
      const createdAt = getLocalDateValueFromTimestamp(record.created_at);

      if (defaultFromDate && createdAt < defaultFromDate) {
        return false;
      }

      if (defaultToDate && createdAt > defaultToDate) {
        return false;
      }

      const relatedIds = [record.created_by, ...(record.involved_user_ids ?? [])].filter(Boolean) as string[];
      return relatedIds.some((profileId) => teamIdSet.has(profileId));
    });
  }, [cases, defaultFromDate, defaultToDate, downlineIds, userId]);

  const totalMonthlyGdv = useMemo(
    () => filteredCaseRows.reduce((sum, record) => sum + (record.spa_price ?? 0), 0),
    [filteredCaseRows]
  );

  const totalMonthlySalesNett = useMemo(
    () => filteredCaseRows.reduce((sum, record) => sum + (record.nett_price ?? 0), 0),
    [filteredCaseRows]
  );

  const totalMonthlySalesCommission = useMemo(
    () => {
      const filteredCaseIds = new Set(filteredCaseRows.map((record) => record.id));

      const salesDirect = filteredCaseRows.reduce((sum, record) => {
        const project = record.project_id ? projectMap.get(record.project_id) ?? null : null;

        return sum + getCaseCommissionAmountForProfiles(record, project, profiles, memberProfileIds);
      }, 0);

      const salesTopUp = payouts
        .filter(
          (payout) =>
            payout.payout_type === "tier_upgrade_top_up" &&
            filteredCaseIds.has(payout.sales_case_id) &&
            memberProfileIds.has(payout.profile_id)
        )
        .reduce((sum, payout) => sum + Number(payout.total_amount ?? 0), 0);

      return salesDirect + salesTopUp;
    },
    [filteredCaseRows, memberProfileIds, payouts, profiles, projectMap]
  );

  const totalMonthlyConvertedCommission = useMemo(
    () => {
      const filteredCaseIds = new Set(filteredCaseRows.map((record) => record.id));
      const payoutById = new Map(payouts.map((payout) => [payout.id, payout]));

      const convertedDirect = filteredCaseRows.reduce(
        (sum, record) => sum + getCompletedCommissionAmountForProfiles(payoutMap.get(record.id) ?? [], memberProfileIds),
        0
      );

      const convertedTopUp = payouts
        .filter(
          (payout) =>
            payout.payout_type === "tier_upgrade_top_up" &&
            payout.payout_status === "Paid" &&
            filteredCaseIds.has(payout.sales_case_id) &&
            memberProfileIds.has(payout.profile_id)
        )
        .reduce((sum, payout) => sum + Number(payout.total_amount ?? 0), 0);

      const convertedVoucher = entries.reduce((sum, entry) => {
        if (entry.description !== "Payment voucher generated") {
          return sum;
        }

        const meta = parseVoucherHistoryMeta(entry.reference_detail);

        if (!meta) {
          return sum;
        }

        const relatedCaseIds = new Set<string>((meta.salesCaseIds ?? []).filter(Boolean));
        const linkedPayoutIds = new Set<string>((meta.payoutIds ?? []).filter(Boolean));

        (meta.componentKeys ?? []).forEach((componentKey) => {
          const payoutId = getPayoutIdFromComponentKey(componentKey);

          if (!payoutId) {
            return;
          }

          linkedPayoutIds.add(payoutId);
          const payout = payoutById.get(payoutId);

          if (payout?.sales_case_id) {
            relatedCaseIds.add(payout.sales_case_id);
          }
        });

        linkedPayoutIds.forEach((payoutId) => {
          const payout = payoutById.get(payoutId);

          if (payout?.sales_case_id) {
            relatedCaseIds.add(payout.sales_case_id);
          }
        });

        const hasScopedCase = Array.from(relatedCaseIds).some((caseId) => filteredCaseIds.has(caseId));

        if (!hasScopedCase) {
          return sum;
        }

        const hasUnpaidLinkedPayout =
          linkedPayoutIds.size === 0 ||
          Array.from(linkedPayoutIds).some((payoutId) => payoutById.get(payoutId)?.payout_status !== "Paid");

        if (!hasUnpaidLinkedPayout) {
          return sum;
        }

        const grossAmount = Number(meta.grossAmount ?? entry.amount ?? 0);

        if (!Number.isFinite(grossAmount)) {
          return sum;
        }

        return sum + grossAmount;
      }, 0);

      return convertedDirect + convertedTopUp + convertedVoucher;
    },
    [entries, filteredCaseRows, memberProfileIds, payoutMap, payouts]
  );

  const totalMonthlyCaseCount = useMemo(() => filteredCaseRows.length, [filteredCaseRows]);

  const totalPersonalMonthlyGdv = useMemo(() => {
    if (!userId) {
      return 0;
    }

    return memberCaseRows.reduce(
      (sum, record) => sum + getCasePersonalAmountForProfiles(record, record.spa_price ?? 0, [userId]),
      0
    );
  }, [memberCaseRows, userId]);

  const totalPersonalMonthlyConverted = useMemo(() => {
    if (!userId) {
      return 0;
    }

    type PersonalRow = {
      createdAt: string | null;
      displayStatus: string;
      displayCommission: number | null;
    };

    const directAndHoldingRows: PersonalRow[] = memberCaseRows.flatMap((record) => {
      const relatedPayouts = (payoutMap.get(record.id) ?? []).filter(
        (payout) => payout.payout_type !== "tier_upgrade_top_up"
      );
      const viewerPayout = relatedPayouts.find((payout) => payout.profile_id === userId) ?? null;
      const baseStatus = normalizeCaseStatus(record.status);
      const directStatus = viewerPayout?.payout_status === "Paid" ? "Completed" : baseStatus;
      const directRow: PersonalRow = {
        createdAt: record.created_at,
        displayStatus: directStatus,
        displayCommission: getViewerCommission(record),
      };

      const hasReleasedHolding = payouts.some(
        (payout) =>
          payout.sales_case_id === record.id &&
          payout.profile_id === userId &&
          isReleasedHoldingTopUp(payout)
      );
      const holdingAmount = getViewerHoldingCommission(record);

      if (hasReleasedHolding || holdingAmount <= 0) {
        return [directRow];
      }

      return [
        directRow,
        {
          createdAt: record.created_at,
          displayStatus: directStatus,
          displayCommission: holdingAmount,
        },
      ];
    });

    const topUpRows: PersonalRow[] = payouts
      .filter((payout) => payout.payout_type === "tier_upgrade_top_up" && payout.profile_id === userId)
      .flatMap((payout) => {
        const relatedCase = cases.find((record) => record.id === payout.sales_case_id) ?? null;

        if (!relatedCase) {
          return [];
        }

        return [{
          createdAt: payout.created_at,
          displayStatus: payout.payout_status === "Paid" ? "Completed" : payout.payout_status,
          displayCommission: payout.total_amount,
        }];
      });

    const allRows = [...directAndHoldingRows, ...topUpRows].filter((row) => {
      const rowDate = getLocalDateValueFromTimestamp(row.createdAt);
      return Boolean(rowDate && rowDate >= defaultFromDate && rowDate <= defaultToDate);
    });

    return allRows.reduce(
      (sum, row) => sum + (row.displayStatus === "Completed" ? row.displayCommission ?? 0 : 0),
      0
    );
  }, [cases, defaultFromDate, defaultToDate, memberCaseRows, payoutMap, payouts, userId]);

  const totalPersonalMonthlySales = useMemo(() => {
    if (!userId) {
      return 0;
    }

    type PersonalRow = {
      createdAt: string | null;
      displayCommission: number | null;
    };

    const directAndHoldingRows: PersonalRow[] = memberCaseRows.flatMap((record) => {
      const directRow: PersonalRow = {
        createdAt: record.created_at,
        displayCommission: getViewerCommission(record),
      };

      const hasReleasedHolding = payouts.some(
        (payout) =>
          payout.sales_case_id === record.id &&
          payout.profile_id === userId &&
          isReleasedHoldingTopUp(payout)
      );
      const holdingAmount = getViewerHoldingCommission(record);

      if (hasReleasedHolding || holdingAmount <= 0) {
        return [directRow];
      }

      return [
        directRow,
        {
          createdAt: record.created_at,
          displayCommission: holdingAmount,
        },
      ];
    });

    const topUpRows: PersonalRow[] = payouts
      .filter((payout) => payout.payout_type === "tier_upgrade_top_up" && payout.profile_id === userId)
      .flatMap((payout) => {
        const relatedCase = cases.find((record) => record.id === payout.sales_case_id) ?? null;

        if (!relatedCase) {
          return [];
        }

        return [{
          createdAt: payout.created_at,
          displayCommission: payout.total_amount,
        }];
      });

    const allRows = [...directAndHoldingRows, ...topUpRows].filter((row) => {
      const rowDate = getLocalDateValueFromTimestamp(row.createdAt);
      return Boolean(rowDate && rowDate >= defaultFromDate && rowDate <= defaultToDate);
    });

    return allRows.reduce((sum, row) => sum + (row.displayCommission ?? 0), 0);
  }, [cases, defaultFromDate, defaultToDate, memberCaseRows, payoutMap, payouts, userId]);

  const totalPersonalMonthlyCaseCount = useMemo(() => memberCaseRows.length, [memberCaseRows]);

  const totalPersonalMonthlyPendingCases = useMemo(
    () =>
      memberCaseRows.filter((record) => {
        const relatedPayouts = (payoutMap.get(record.id) ?? []).filter((payout) => payout.payout_type !== "tier_upgrade_top_up");
        const displayStatus =
          relatedPayouts.length > 0 && relatedPayouts.every((payout) => payout.payout_status === "Paid")
            ? "Completed"
            : normalizeCaseStatus(record.status);

        return !["Approve", "Paid", "Completed", "Reject", "Cancel"].includes(displayStatus);
      }).length,
    [memberCaseRows, payoutMap]
  );

  const teamMemberIds = useMemo(() => (userId ? new Set([userId, ...downlineIds]) : new Set<string>()), [downlineIds, userId]);

  const totalTeamMonthlyGdvForMembers = useMemo(
    () => memberTeamCaseRows.reduce((sum, record) => sum + getCasePersonalAmountForProfiles(record, record.spa_price ?? 0, teamMemberIds), 0),
    [memberTeamCaseRows, teamMemberIds]
  );

  const totalTeamMonthlyConvertedSales = useMemo(
    () =>
      memberTeamCaseRows.reduce((sum, record) => {
        const relatedPayouts = (payoutMap.get(record.id) ?? []).filter((payout) => payout.payout_type !== "tier_upgrade_top_up");
        const displayStatus =
          relatedPayouts.length > 0 && relatedPayouts.every((payout) => payout.payout_status === "Paid")
            ? "Completed"
            : normalizeCaseStatus(record.status);

        return displayStatus === "Completed"
          ? sum + getCasePersonalAmountForProfiles(record, record.nett_price ?? 0, teamMemberIds)
          : sum;
      }, 0),
    [memberTeamCaseRows, payoutMap, teamMemberIds]
  );

  const totalTeamMonthlySalesForMembers = useMemo(
    () =>
      memberTeamCaseRows.reduce((sum, record) => {
        const project = record.project_id ? projectMap.get(record.project_id) ?? null : null;
        const commissionStructure = getCaseCommissionStructure(record, project);
        const totalCommissionPercentage =
          (commissionStructure?.agent_commission ?? 0) +
          (commissionStructure?.pre_leader_override ?? 0) +
          (commissionStructure?.leader_override ?? 0);

        return sum + (record.nett_price ?? 0) * (totalCommissionPercentage / 100);
      }, 0),
    [memberTeamCaseRows, projectMap]
  );

  const totalTeamMonthlyConvertedCommission = useMemo(
    () =>
      memberTeamCaseRows.reduce((sum, record) => {
        const allRelatedPayouts = payoutMap.get(record.id) ?? [];
        const relatedPayouts = allRelatedPayouts.filter(
          (payout) => payout.payout_type !== "tier_upgrade_top_up" || isReleasedHoldingTopUp(payout)
        );

        const completedDirectAndReleased = getCompletedCommissionAmountForProfiles(relatedPayouts, teamMemberIds);
        const completedTopUp = allRelatedPayouts
          .filter(
            (payout) =>
              payout.payout_type === "tier_upgrade_top_up" &&
              payout.payout_status === "Paid" &&
              teamMemberIds.has(payout.profile_id)
          )
          .reduce((topUpSum, payout) => topUpSum + Number(payout.total_amount ?? 0), 0);

        return sum + completedDirectAndReleased + completedTopUp;
      }, 0),
    [memberTeamCaseRows, payoutMap, teamMemberIds]
  );

  const totalPaidOutToAgent = useMemo(
    () => {
      const voucherPayoutIds = new Set<string>();
      const voucherAttachmentUrls = new Set<string>();

      entries.forEach((entry) => {
        if (entry.description !== "Payment voucher generated") {
          return;
        }

        if (entry.attachment_url) {
          voucherAttachmentUrls.add(entry.attachment_url);
        }

        const meta = parseVoucherHistoryMeta(entry.reference_detail);
        (meta?.payoutIds ?? []).forEach((payoutId) => {
          if (payoutId) {
            voucherPayoutIds.add(payoutId);
          }
        });
      });

      const payoutCashOut = payouts.reduce((sum, payout) => {
        const paidAt = getLocalDateValueFromTimestamp(payout.paid_at);

        if (
          payout.payout_status !== "Paid" ||
          !paidAt ||
          paidAt < defaultFromDate ||
          paidAt > defaultToDate ||
          voucherPayoutIds.has(payout.id) ||
          (payout.payment_receipt_url && voucherAttachmentUrls.has(payout.payment_receipt_url))
        ) {
          return sum;
        }

        return sum + Number(payout.total_amount ?? 0);
      }, 0);

      const voucherCashOut = entries.reduce((sum, entry) => {
        const transactedAt = getLocalDateValueFromTimestamp(entry.transacted_at);

        if (
          entry.entry_type !== "cash_out" ||
          entry.description !== "Payment voucher generated" ||
          !transactedAt ||
          transactedAt < defaultFromDate ||
          transactedAt > defaultToDate
        ) {
          return sum;
        }

        const historyMeta = parseVoucherHistoryMeta(entry.reference_detail);
        const displayAmount = Number((historyMeta?.grossAmount ?? entry.amount).toFixed(2));
        return sum + displayAmount;
      }, 0);

      return payoutCashOut + voucherCashOut;
    },
    [defaultFromDate, defaultToDate, entries, payouts]
  );

  const totalPaidOutNonAgent = useMemo(
    () =>
      entries.reduce((sum, entry) => {
        const transactedAt = getLocalDateValueFromTimestamp(entry.transacted_at);

        if (
          entry.entry_type !== "cash_out" ||
          entry.description === "Payment voucher generated" ||
          !transactedAt ||
          transactedAt < defaultFromDate ||
          transactedAt > defaultToDate
        ) {
          return sum;
        }

        return sum + Number(entry.amount ?? 0);
      }, 0),
    [defaultFromDate, defaultToDate, entries]
  );

  const totalCashIn = useMemo(
    () =>
      entries.reduce((sum, entry) => {
        const transactedAt = getLocalDateValueFromTimestamp(entry.transacted_at);

        if (
          entry.entry_type !== "cash_in" ||
          !transactedAt ||
          transactedAt < defaultFromDate ||
          transactedAt > defaultToDate
        ) {
          return sum;
        }

        return sum + Number(entry.amount ?? 0);
      }, 0),
    [defaultFromDate, defaultToDate, entries]
  );

  const totalCashOut = totalPaidOutToAgent + totalPaidOutNonAgent;

  const monthlyChartData = useMemo(() => {
    const months = Array.from({ length: 12 }, (_, index) => {
      const date = new Date(today.getFullYear(), index, 1);
      return {
        month: date.toLocaleString("en-MY", { month: "short" }),
        monthValue: `${date.getFullYear()}-${`${index + 1}`.padStart(2, "0")}`,
        totalGdv: 0,
        totalNettSales: 0,
        totalSales: 0,
        totalConverted: 0,
        totalCases: 0,
      };
    });

    const rowsByMonth = new Map(months.map((row) => [row.monthValue, row]));

    cases.forEach((record) => {
      const createdAt = record.created_at ? new Date(record.created_at) : null;

      if (!createdAt || Number.isNaN(createdAt.getTime()) || createdAt.getFullYear() !== today.getFullYear()) {
        return;
      }

      const monthValue = `${createdAt.getFullYear()}-${`${createdAt.getMonth() + 1}`.padStart(2, "0")}`;
      const chartRow = rowsByMonth.get(monthValue);

      if (!chartRow) {
        return;
      }

      const project = record.project_id ? projectMap.get(record.project_id) ?? null : null;
      chartRow.totalGdv += record.spa_price ?? 0;
      chartRow.totalNettSales += record.nett_price ?? 0;
      chartRow.totalSales += getCaseCommissionAmountForProfiles(record, project, profiles, memberProfileIds);
      chartRow.totalConverted += getCompletedCommissionAmountForProfiles(payoutMap.get(record.id) ?? [], memberProfileIds);
      chartRow.totalCases += 1;
    });

    return months;
  }, [cases, memberProfileIds, payoutMap, profiles, projectMap, today]);

  return (
    <div className="space-y-6 px-4 pb-8 pt-20 md:ml-[220px] md:w-[calc(100%-220px)] md:px-8 md:pb-12 md:pt-24">
      <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-gray-900">Event Banner</h3>
          <span className="text-xs text-gray-400">Visible to all users</span>
        </div>
        <div className="relative w-full overflow-hidden rounded-lg border border-gray-100">
          {activeEvent ? (
            <button
              type="button"
              onClick={() => setSelectedEvent(activeEvent)}
              className="w-full h-[220px] md:h-[280px] bg-gray-50 text-left"
            >
              {activeEvent.image_url ? (
                <img
                  src={activeEvent.image_url}
                  alt={activeEvent.event_name}
                  className="h-full w-full object-contain bg-white"
                />
              ) : (
                <div className="h-full w-full flex items-center justify-center text-sm text-gray-400">
                  No image available
                </div>
              )}
            </button>
          ) : (
            <div className="h-[220px] md:h-[280px] flex items-center justify-center text-sm text-gray-500">
              No events have been added yet.
            </div>
          )}

          {events.length > 1 && (
            <div className="absolute bottom-3 right-3 flex gap-1">
              {events.map((event, index) => (
                <button
                  key={event.id}
                  type="button"
                  onClick={() => setActiveIndex(index)}
                  className={`h-2.5 w-2.5 rounded-full border ${
                    index === activeIndex
                      ? "bg-white border-white"
                      : "bg-white/50 border-white/70"
                  }`}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {isSuperAdmin ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
          <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm">
            <p className="text-sm font-medium text-gray-500 mb-2">Total GDV</p>
            <p className="text-2xl font-bold text-gray-900">RM {formatAmount(totalMonthlyGdv)}</p>
            <p className="text-xs text-gray-500 mt-2">Total SPA price from all cases within the current month.</p>
          </div>
          <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm">
            <p className="text-sm font-medium text-gray-500 mb-2">Total Nett Sales</p>
            <p className="text-2xl font-bold text-gray-900">RM {formatAmount(totalMonthlySalesNett)}</p>
            <p className="text-xs text-gray-500 mt-2">Total nett price from all cases within the current month.</p>
          </div>
          <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm">
            <p className="text-sm font-medium text-gray-500 mb-2">Total Sales</p>
            <p className="text-2xl font-bold text-gray-900">RM {formatAmount(totalMonthlySalesCommission)}</p>
            <p className="text-xs text-gray-500 mt-2">Total commission from sales cases within the current month, whether completed or not.</p>
          </div>
          <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm">
            <p className="text-sm font-medium text-gray-500 mb-2">Total Converted</p>
            <p className="text-2xl font-bold text-gray-900">RM {formatAmount(totalMonthlyConvertedCommission)}</p>
            <p className="text-xs text-gray-500 mt-2">Total completed commission from sales cases within the current month.</p>
          </div>
          <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm">
            <p className="text-sm font-medium text-gray-500 mb-2">Total Number of Cases</p>
            <p className="text-2xl font-bold text-gray-900">{totalMonthlyCaseCount}</p>
            <p className="text-xs text-gray-500 mt-2">Total cases within the current month.</p>
          </div>
          <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm">
            <p className="text-sm font-medium text-gray-500 mb-2">Total Paid Out To Agent</p>
            <p className="text-2xl font-bold text-gray-900">RM {formatAmount(totalPaidOutToAgent)}</p>
            <p className="text-xs text-gray-500 mt-2">Paid commission to agents within the current month.</p>
          </div>
          <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm">
            <p className="text-sm font-medium text-gray-500 mb-2">Total Paid Out Non-Agent</p>
            <p className="text-2xl font-bold text-gray-900">RM {formatAmount(totalPaidOutNonAgent)}</p>
            <p className="text-xs text-gray-500 mt-2">Outgoing non-agent finance entries within the current month.</p>
          </div>
          <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm">
            <p className="text-sm font-medium text-gray-500 mb-2">Total Cash In</p>
            <p className="text-2xl font-bold text-gray-900">RM {formatAmount(totalCashIn)}</p>
            <p className="text-xs text-gray-500 mt-2">All incoming finance entries within the current month.</p>
          </div>
          <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm">
            <p className="text-sm font-medium text-gray-500 mb-2">Total Cash Out</p>
            <p className="text-2xl font-bold text-gray-900">RM {formatAmount(totalCashOut)}</p>
            <p className="text-xs text-gray-500 mt-2">All outgoing payments within the current month.</p>
          </div>
        </div>
      ) : isAdmin ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-6">
          <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm">
            <p className="text-sm font-medium text-gray-500 mb-2">Total GDV</p>
            <p className="text-2xl font-bold text-gray-900">RM {formatAmount(totalMonthlyGdv)}</p>
          </div>
          <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm">
            <p className="text-sm font-medium text-gray-500 mb-2">Total Nett Sales</p>
            <p className="text-2xl font-bold text-gray-900">RM {formatAmount(totalMonthlySalesNett)}</p>
          </div>
          <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm">
            <p className="text-sm font-medium text-gray-500 mb-2">Total Sales</p>
            <p className="text-2xl font-bold text-gray-900">RM {formatAmount(totalMonthlySalesCommission)}</p>
          </div>
          <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm">
            <p className="text-sm font-medium text-gray-500 mb-2">Total Converted</p>
            <p className="text-2xl font-bold text-gray-900">RM {formatAmount(totalMonthlyConvertedCommission)}</p>
          </div>
          <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm">
            <p className="text-sm font-medium text-gray-500 mb-2">Total Number of Cases</p>
            <p className="text-2xl font-bold text-gray-900">{totalMonthlyCaseCount}</p>
          </div>
          <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm">
            <p className="text-sm font-medium text-gray-500 mb-2">Total Paid Out To Agent</p>
            <p className="text-2xl font-bold text-gray-900">RM {formatAmount(totalPaidOutToAgent)}</p>
          </div>
        </div>
      ) : canViewMemberMetrics ? (
        <div className="space-y-6">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Personal This Month</h3>
            <p className="mt-1 text-sm text-gray-500">Monthly personal performance using the same calculation as the Sales Cases page.</p>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
            <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm">
              <p className="text-sm font-medium text-gray-500 mb-2">Total GDV</p>
              <p className="text-2xl font-bold text-gray-900">RM {formatAmount(totalPersonalMonthlyGdv)}</p>
            </div>
            <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm">
              <p className="text-sm font-medium text-gray-500 mb-2">Total Converted</p>
              <p className="text-2xl font-bold text-gray-900">RM {formatAmount(totalPersonalMonthlyConverted)}</p>
            </div>
            <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm">
              <p className="text-sm font-medium text-gray-500 mb-2">Total Sales</p>
              <p className="text-2xl font-bold text-gray-900">RM {formatAmount(totalPersonalMonthlySales)}</p>
            </div>
            <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm">
              <p className="text-sm font-medium text-gray-500 mb-2">Total Cases of the Month</p>
              <p className="text-2xl font-bold text-gray-900">{totalPersonalMonthlyCaseCount}</p>
            </div>
            <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm">
              <p className="text-sm font-medium text-gray-500 mb-2">Pending Cases of the Month</p>
              <p className="text-2xl font-bold text-gray-900">{totalPersonalMonthlyPendingCases}</p>
            </div>
          </div>

          <div>
            <h3 className="text-lg font-semibold text-gray-900">Team This Month</h3>
            <p className="mt-1 text-sm text-gray-500">Monthly team performance using the same calculation as the Team page.</p>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
            <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm">
              <p className="text-sm font-medium text-gray-500 mb-2">Team GDV of the Month</p>
              <p className="text-2xl font-bold text-gray-900">RM {formatAmount(totalTeamMonthlyGdvForMembers)}</p>
            </div>
            <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm">
              <p className="text-sm font-medium text-gray-500 mb-2">Team Converted of the Month</p>
              <p className="text-2xl font-bold text-gray-900">RM {formatAmount(totalTeamMonthlyConvertedSales)}</p>
            </div>
            <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm">
              <p className="text-sm font-medium text-gray-500 mb-2">Team Total Sales of the Month</p>
              <p className="text-2xl font-bold text-gray-900">RM {formatAmount(totalTeamMonthlySalesForMembers)}</p>
            </div>
            <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm">
              <p className="text-sm font-medium text-gray-500 mb-2">Team Total Converted of the Month</p>
              <p className="text-2xl font-bold text-gray-900">RM {formatAmount(totalTeamMonthlyConvertedCommission)}</p>
            </div>
            <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm">
              <p className="text-sm font-medium text-gray-500 mb-2">Number of Downline</p>
              <p className="text-2xl font-bold text-gray-900">{downlineIds.length}</p>
            </div>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          <KPICard title="Vacant" value="20,000 ft²" badge="+8%" />
          <KPICard title="Vacancy Loss" value="RM15,800/mo" />
          <KPICard title="Leases due in 6 mo" value="6 leases" badge="+12%" />
          <KPICard title="Avg. lease term remaining" value="3.4 years" />
          <KPICard title="Tenant stability" value="84%" />
        </div>
      )}

      {canViewSummaryMetrics && (
        <div className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="font-semibold text-gray-900">Summary Trend</h3>
          </div>
          <PaymentBehaviorChart data={monthlyChartData} />
        </div>
      )}
      {selectedEvent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="bg-white w-full max-w-5xl rounded-xl shadow-lg border border-gray-100 overflow-hidden">
            <div className="w-full aspect-[1600/380] bg-gray-50">
              {selectedEvent.image_url ? (
                <img
                  src={selectedEvent.image_url}
                  alt={selectedEvent.event_name}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="h-full w-full flex items-center justify-center text-sm text-gray-400">
                  No image available
                </div>
              )}
            </div>
            <div className="p-5 space-y-2">
              <h4 className="text-lg font-semibold text-gray-900">
                {selectedEvent.event_name}
              </h4>
              <p className="text-sm text-gray-500">
                Event Date: {(selectedEvent.start_date || "-") + " - " + (selectedEvent.end_date || "-")}
              </p>
              {selectedEvent.description && (
                <p className="text-sm text-gray-600 whitespace-pre-wrap">{selectedEvent.description}</p>
              )}
              <div className="flex justify-end pt-2">
                <button
                  type="button"
                  onClick={() => setSelectedEvent(null)}
                  className="text-sm text-gray-600 hover:text-gray-900"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
