import { useEffect, useMemo, useState } from "react";
import { Award, Medal, Trophy } from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import {
  getCaseCommissionAmountForProfile,
  getCaseCommissionAmountForProfiles,
  getCasePersonalAmountForProfile,
  getCasePersonalAmountForProfiles,
} from "../lib/salesCaseMetrics";
import type { ProjectOption, SalesCaseRecord } from "./SalesCaseModal";

type RankingProfile = {
  id: string;
  name: string | null;
  email: string | null;
  role: string | null;
  rank: string | null;
  recruit_by: string | null;
  is_active: boolean | null;
  avatar_url: string | null;
  avatar_position_x: number | null;
  avatar_position_y: number | null;
  avatar_zoom: number | null;
};

type RankCategory = "agent" | "pre_leader" | "leader";

type RankingMetric = "personal_gdv" | "personal_sales" | "team_gdv" | "team_sales";

type RankingRow = {
  profile: RankingProfile;
  rankCategory: RankCategory;
  personalGdv: number;
  personalSales: number;
  teamGdv: number;
  teamSales: number;
};

type RankingPageProps = {
  userId: string;
};

const MONTH_OPTIONS = [
  { value: "all", label: "All Time" },
  { value: "01", label: "Jan" },
  { value: "02", label: "Feb" },
  { value: "03", label: "Mar" },
  { value: "04", label: "Apr" },
  { value: "05", label: "May" },
  { value: "06", label: "Jun" },
  { value: "07", label: "Jul" },
  { value: "08", label: "Aug" },
  { value: "09", label: "Sep" },
  { value: "10", label: "Oct" },
  { value: "11", label: "Nov" },
  { value: "12", label: "Dec" },
];

const RANK_OPTIONS: Array<{ value: RankCategory; label: string }> = [
  { value: "agent", label: "Agent" },
  { value: "pre_leader", label: "Pre Leader" },
  { value: "leader", label: "Leader" },
];

const METRIC_OPTIONS: Array<{ value: RankingMetric; label: string }> = [
  { value: "personal_gdv", label: "Personal GDV" },
  { value: "personal_sales", label: "Personal Sales" },
  { value: "team_gdv", label: "Team GDV" },
  { value: "team_sales", label: "Team Sales" },
];

const PODIUM_LABELS = [
  {
    title: "Champion",
    accent: "border-amber-200 bg-amber-50",
    icon: Trophy,
    iconClassName: "text-amber-500",
  },
  {
    title: "1st Runner Up",
    accent: "border-slate-200 bg-slate-50",
    icon: Medal,
    iconClassName: "text-slate-500",
  },
  {
    title: "2nd Runner Up",
    accent: "border-orange-200 bg-orange-50",
    icon: Award,
    iconClassName: "text-orange-500",
  },
];

const formatAmount = (value: number | null) => {
  if (value === null || Number.isNaN(value)) return "-";
  const roundedValue = Math.round(value * 100) / 100;
  return roundedValue.toLocaleString("en-MY", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
};

const getMonthInputValue = (date: Date) => {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  return `${year}-${month}`;
};

const getDateMonthValue = (date: Date | null) => {
  if (!date || Number.isNaN(date.getTime())) {
    return null;
  }

  return getMonthInputValue(date);
};

const normalizeRankCategory = (
  profile: Pick<RankingProfile, "role" | "rank"> | null | undefined
): RankCategory => {
  if (!profile) {
    return "agent";
  }

  if (profile.role === "leader" || profile.rank === "leader") {
    return "leader";
  }

  if (profile.rank === "pre_leader") {
    return "pre_leader";
  }

  return "agent";
};

const formatRankLabel = (value: RankCategory) => value.replace("_", " ");

const DEFAULT_AVATAR_URL = "https://api.dicebear.com/7.x/avataaars/svg?seed=Atlas";

const isMemberProfile = (profile: RankingProfile) =>
  profile.role !== "admin" &&
  profile.role !== "super_admin" &&
  (profile.role === "agent" ||
    profile.role === "leader" ||
    ["agent", "pre_leader", "leader"].includes(profile.rank ?? ""));

const isLeaderProfile = (profile: Pick<RankingProfile, "role" | "rank"> | null | undefined) =>
  Boolean(profile && (profile.role === "leader" || profile.rank === "leader"));

const isPreLeaderProfile = (profile: Pick<RankingProfile, "rank"> | null | undefined) =>
  Boolean(profile && profile.rank === "pre_leader");

const getAvatarStyle = (profile: Pick<RankingProfile, "avatar_url" | "avatar_position_x" | "avatar_position_y" | "avatar_zoom">) => ({
  backgroundImage: `url(${profile.avatar_url || DEFAULT_AVATAR_URL})`,
  backgroundPosition: `${profile.avatar_position_x ?? 50}% ${profile.avatar_position_y ?? 50}%`,
  backgroundSize: `${(profile.avatar_zoom ?? 1) * 100}% ${(profile.avatar_zoom ?? 1) * 100}%`,
  backgroundRepeat: "no-repeat",
});

export function RankingPage({ userId }: RankingPageProps) {
  const today = new Date();
  const [profiles, setProfiles] = useState<RankingProfile[]>([]);
  const [cases, setCases] = useState<SalesCaseRecord[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selectedMonthValue, setSelectedMonthValue] = useState(() => `${today.getMonth() + 1}`.padStart(2, "0"));
  const [selectedYearValue, setSelectedYearValue] = useState(() => `${today.getFullYear()}`);
  const [selectedRank, setSelectedRank] = useState<RankCategory>("agent");
  const [selectedMetric, setSelectedMetric] = useState<RankingMetric>("personal_sales");

  useEffect(() => {
    const loadData = async () => {
      setError(null);

      const [profileRpcResult, caseRpcResult, projectResult] = await Promise.all([
        supabase.rpc("get_ranking_profiles"),
        supabase.rpc("get_ranking_sales_cases"),
        supabase
          .from("projects")
          .select(
            "id, project_name, company_commission, agent_commission, pre_leader_override, leader_override, commission_structures, default_commission_structure_id"
          )
          .eq("is_hidden", false),
      ]);

      const shouldFallbackToDirectQueries =
        profileRpcResult.error?.code === "PGRST202" || caseRpcResult.error?.code === "PGRST202";

      const [profileResult, caseResult] = shouldFallbackToDirectQueries
        ? await Promise.all([
            supabase
              .from("profiles")
              .select("id, name, email, role, rank, recruit_by, is_active, avatar_url, avatar_position_x, avatar_position_y, avatar_zoom")
              .is("deleted_at", null),
            supabase.from("sales_cases").select("*").order("created_at", { ascending: false }),
          ])
        : [profileRpcResult, caseRpcResult];

      if (profileResult.error) {
        setError(profileResult.error.message);
        return;
      }

      if (caseResult.error) {
        setError(caseResult.error.message);
        return;
      }

      if (projectResult.error) {
        setError(projectResult.error.message);
        return;
      }

      setProfiles((profileResult.data as RankingProfile[]) ?? []);
      setCases((caseResult.data as SalesCaseRecord[]) ?? []);
      setProjects((projectResult.data as ProjectOption[]) ?? []);
    };

    loadData();
  }, []);

  const projectMap = useMemo(() => {
    const map = new Map<string, ProjectOption>();
    projects.forEach((project) => map.set(project.id, project));
    return map;
  }, [projects]);

  const memberProfiles = useMemo(
    () => profiles.filter((profile) => profile.is_active !== false && isMemberProfile(profile)),
    [profiles]
  );

  const availableMetricOptions = useMemo(
    () =>
      METRIC_OPTIONS.filter((option) => {
        if (selectedRank === "agent") {
          return option.value === "personal_gdv" || option.value === "personal_sales";
        }

        return true;
      }),
    [selectedRank]
  );

  useEffect(() => {
    if (!availableMetricOptions.some((option) => option.value === selectedMetric)) {
      setSelectedMetric(availableMetricOptions[0]?.value ?? "personal_sales");
    }
  }, [availableMetricOptions, selectedMetric]);

  const availableYearOptions = useMemo(() => {
    const yearValues = new Set<string>([selectedYearValue, `${today.getFullYear()}`]);

    cases.forEach((record) => {
      const createdAt = record.created_at ? new Date(record.created_at) : null;

      if (createdAt) {
        yearValues.add(`${createdAt.getFullYear()}`);
      }
    });

    return Array.from(yearValues).sort((left, right) => Number(right) - Number(left));
  }, [cases, selectedYearValue, today]);

  const selectedMonth = selectedMonthValue === "all" ? null : `${selectedYearValue}-${selectedMonthValue}`;

  const monthlyCases = useMemo(
    () =>
      cases.filter((record) => {
        const createdAt = record.created_at ? new Date(record.created_at) : null;
        if (!selectedMonth) {
          return true;
        }

        return getDateMonthValue(createdAt) === selectedMonth;
      }),
    [cases, selectedMonth]
  );

  const descendantIdsByProfile = useMemo(() => {
    const byRecruiter = new Map<string, RankingProfile[]>();

    memberProfiles.forEach((profile) => {
      if (!profile.recruit_by) {
        return;
      }

      const recruiterProfiles = byRecruiter.get(profile.recruit_by) ?? [];
      recruiterProfiles.push(profile);
      byRecruiter.set(profile.recruit_by, recruiterProfiles);
    });

    const result = new Map<string, string[]>();

    memberProfiles.forEach((profile) => {
      const isCurrentLeader = isLeaderProfile(profile);
      const isCurrentPreLeader = isPreLeaderProfile(profile);
      const collectedIds = new Set<string>();

      const collectDescendants = (profileId: string, depth: number) => {
        const directReports = byRecruiter.get(profileId) ?? [];

        directReports.forEach((childProfile) => {
          if (collectedIds.has(childProfile.id)) {
            return;
          }

          collectedIds.add(childProfile.id);

          if (isCurrentLeader || (isCurrentPreLeader && depth === 0)) {
            collectDescendants(childProfile.id, depth + 1);
          }
        });
      };

      collectDescendants(profile.id, 0);
      result.set(profile.id, Array.from(collectedIds));
    });

    return result;
  }, [memberProfiles]);

  const rankingRows = useMemo<RankingRow[]>(() => {
    return memberProfiles.map((profile) => {
      const rankCategory = normalizeRankCategory(profile);
      const personalGdv = monthlyCases.reduce(
        (sum, record) => sum + getCasePersonalAmountForProfile(record, record.spa_price, profile.id),
        0
      );
      const personalSales = monthlyCases.reduce((sum, record) => {
        const project = record.project_id ? projectMap.get(record.project_id) ?? null : null;
        return sum + getCaseCommissionAmountForProfile(record, project, memberProfiles, profile.id);
      }, 0);
      const teamIds = new Set([profile.id, ...(descendantIdsByProfile.get(profile.id) ?? [])]);
      const teamGdv =
        rankCategory === "agent"
          ? personalGdv
          : monthlyCases.reduce(
              (sum, record) => sum + getCasePersonalAmountForProfiles(record, record.spa_price, teamIds),
              0
            );
      const teamSales =
        rankCategory === "agent"
          ? personalSales
          : monthlyCases.reduce((sum, record) => {
              const project = record.project_id ? projectMap.get(record.project_id) ?? null : null;
              return sum + getCaseCommissionAmountForProfiles(record, project, memberProfiles, teamIds);
            }, 0);

      return {
        profile,
        rankCategory,
        personalGdv,
        personalSales,
        teamGdv,
        teamSales,
      };
    });
  }, [descendantIdsByProfile, memberProfiles, monthlyCases, projectMap]);

  const sortedRankingRows = useMemo(() => {
    return rankingRows
      .filter((row) => row.rankCategory === selectedRank)
      .sort((left, right) => {
        const getMetricValue = (row: RankingRow) => {
          switch (selectedMetric) {
            case "personal_gdv":
              return row.personalGdv;
            case "team_gdv":
              return row.teamGdv;
            case "team_sales":
              return row.teamSales;
            default:
              return row.personalSales;
          }
        };

        const rightMetric = getMetricValue(right);
        const leftMetric = getMetricValue(left);

        if (rightMetric !== leftMetric) {
          return rightMetric - leftMetric;
        }

        if (right.personalGdv !== left.personalGdv) {
          return right.personalGdv - left.personalGdv;
        }

        const rightLabel = right.profile.name || right.profile.email || "";
        const leftLabel = left.profile.name || left.profile.email || "";
        return rightLabel.localeCompare(leftLabel);
      });
  }, [rankingRows, selectedMetric, selectedRank]);

  const podiumRows = sortedRankingRows.slice(0, 3);
  const currentViewer = profiles.find((profile) => profile.id === userId) ?? null;
  const selectedMetricLabel = availableMetricOptions.find((option) => option.value === selectedMetric)?.label ?? "Personal Sales";

  const getMetricValue = (row: RankingRow) => {
    switch (selectedMetric) {
      case "personal_gdv":
        return row.personalGdv;
      case "team_gdv":
        return row.teamGdv;
      case "team_sales":
        return row.teamSales;
      default:
        return row.personalSales;
    }
  };

  return (
    <div className="px-4 pb-8 pt-20 md:ml-[220px] md:w-[calc(100%-220px)] md:px-8 md:pb-12 md:pt-24">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900">Ranking</h2>
        <p className="mt-1 text-sm text-gray-500">
          Track the monthly leaderboard for agents, pre leaders, and leaders.
        </p>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="mb-6 rounded-xl border border-gray-100 bg-white p-6 shadow-sm">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">Track by Month</label>
            <select
              value={selectedMonthValue}
              onChange={(event) => setSelectedMonthValue(event.target.value)}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary bg-white"
            >
              {MONTH_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">Track by Year</label>
            <select
              value={selectedYearValue}
              onChange={(event) => setSelectedYearValue(event.target.value)}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary bg-white"
            >
              {availableYearOptions.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">Rank Category</label>
            <select
              value={selectedRank}
              onChange={(event) => setSelectedRank(event.target.value as RankCategory)}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary bg-white"
            >
              {RANK_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">Ranking Metric</label>
            <select
              value={selectedMetric}
              onChange={(event) => setSelectedMetric(event.target.value as RankingMetric)}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary bg-white"
            >
              {availableMetricOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 xl:grid-cols-3">
        {PODIUM_LABELS.map((podium, index) => {
          const row = podiumRows[index];
          const Icon = podium.icon;

          return (
            <div key={podium.title} className={`rounded-xl border p-5 shadow-sm ${podium.accent}`}>
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-gray-700">{podium.title}</p>
                  <p className="mt-1 text-xs uppercase tracking-wide text-gray-500">{formatRankLabel(selectedRank)} · {selectedMetricLabel}</p>
                </div>
                <Icon className={`h-6 w-6 ${podium.iconClassName}`} />
              </div>

              {row ? (
                <>
                  <div className="flex items-center gap-3">
                    <div className="h-14 w-14 rounded-full border border-white/80 bg-gray-50 shadow-sm" style={getAvatarStyle(row.profile)} />
                    <div>
                      <p className="text-lg font-bold text-gray-900">{row.profile.name || row.profile.email || "Unnamed member"}</p>
                      <p className="mt-1 text-sm text-gray-500">{row.profile.email || "-"}</p>
                    </div>
                  </div>
                  <div className="mt-4 rounded-lg bg-white/70 px-4 py-4 text-sm">
                    <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{selectedMetricLabel}</p>
                    <p className="mt-2 text-2xl font-semibold text-gray-900">RM {formatAmount(getMetricValue(row))}</p>
                  </div>
                </>
              ) : (
                <div className="rounded-lg border border-dashed border-gray-200 bg-white/70 px-4 py-6 text-sm text-gray-500">
                  No ranking data for this slot yet.
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="rounded-xl border border-gray-100 bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-center justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold text-gray-800">Monthly Ranking</h3>
            <p className="mt-1 text-sm text-gray-500">
              Showing all {formatRankLabel(selectedRank)} members ranked by {selectedMetricLabel.toLowerCase()} for the selected month.
            </p>
          </div>
          <div className="rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs font-medium uppercase tracking-wide text-gray-600">
            Viewer: {currentViewer?.name || currentViewer?.email || "Member"}
          </div>
        </div>

        {sortedRankingRows.length === 0 ? (
          <p className="text-sm text-gray-500">No members found for this rank in the selected month.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-gray-500">
                  <th className="py-2">Rank</th>
                  <th className="py-2">Member</th>
                  <th className="py-2">Current Rank</th>
                  <th className="py-2">{selectedMetricLabel} (RM)</th>
                </tr>
              </thead>
              <tbody>
                {sortedRankingRows.map((row, index) => (
                  <tr key={row.profile.id} className="border-b border-gray-50">
                    <td className="py-3 font-semibold text-gray-700">#{index + 1}</td>
                    <td className="py-3 text-gray-600">
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-full border border-gray-100 bg-gray-50" style={getAvatarStyle(row.profile)} />
                        <div>
                          <div className="font-medium text-gray-900">{row.profile.name || row.profile.email || "Unnamed member"}</div>
                          <div className="text-xs text-gray-500">{row.profile.email || "-"}</div>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 text-gray-600">{formatRankLabel(row.rankCategory)}</td>
                    <td className="py-3 text-gray-600">{formatAmount(getMetricValue(row))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}