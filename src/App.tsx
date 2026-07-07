import { useEffect, useState } from "react";
import { Sidebar } from "./components/Sidebar";
import { Header } from "./components/Header";
import { Dashboard } from "./components/Dashboard";
import { ProjectsForm } from "./components/ProjectsForm";
import { EventsForm } from "./components/EventsForm";
import { UsersForm } from "./components/UsersForm";
import { SalesCasesForm } from "./components/SalesCasesForm";
import { ManageCases } from "./components/ManageCases";
import { CommReviewPage } from "./components/CommReviewPage";
import { FinancePage } from "./components/FinancePage";
import { PayoutPage } from "./components/PayoutPage";
import { PaymentVoucherPage } from "./components/PaymentVoucherPage";
import { MyPaymentVoucherPage } from "./components/MyPaymentVoucherPage";
import { ProfilePage } from "./components/ProfilePage";
import { RankingPage } from "./components/RankingPage";
import { RankProgressPage } from "./components/RankProgressPage";
import { TeamPage } from "./components/TeamPage";
import { AuthPage } from "./components/AuthPage";
import { supabase } from "./lib/supabaseClient";

const normalizeAccessValue = (value: string | null) =>
  value?.trim().toLowerCase().replace(/\s+/g, "_") ?? null;

function App() {
  const [activeView, setActiveView] = useState("Dashboard");
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);
  const [sessionUserId, setSessionUserId] = useState<string | null>(null);
  const [profileRole, setProfileRole] = useState<string | null>(null);
  const [profileRank, setProfileRank] = useState<string | null>(null);
  const [profileName, setProfileName] = useState<string | null>(null);
  const [profileAvatarUrl, setProfileAvatarUrl] = useState<string | null>(null);
  const [profileAvatarX, setProfileAvatarX] = useState<number | null>(null);
  const [profileAvatarY, setProfileAvatarY] = useState<number | null>(null);
  const [profileAvatarZoom, setProfileAvatarZoom] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isProfileLoading, setIsProfileLoading] = useState(false);

  useEffect(() => {
    const loadSession = async () => {
      const { data } = await supabase.auth.getSession();
      setSessionEmail(data.session?.user.email ?? null);
      setSessionUserId(data.session?.user.id ?? null);
      setIsLoading(false);
    };

    loadSession();

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      setSessionEmail(session?.user.email ?? null);
      setSessionUserId(session?.user.id ?? null);
    });

    return () => {
      authListener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    const loadProfile = async () => {
      if (!sessionUserId) {
        setIsProfileLoading(false);
        setProfileRole(null);
        setProfileRank(null);
        setProfileName(null);
        setProfileAvatarUrl(null);
        setProfileAvatarX(null);
        setProfileAvatarY(null);
        setProfileAvatarZoom(null);
        return;
      }

      setIsProfileLoading(true);

      const { data, error } = await supabase
        .from("profiles")
        .select("role, rank, name, is_active, avatar_url, avatar_position_x, avatar_position_y, avatar_zoom")
        .eq("id", sessionUserId)
        .single();

      if (error) {
        setProfileRole(null);
        setProfileRank(null);
        setProfileName(null);
        setProfileAvatarUrl(null);
        setProfileAvatarX(null);
        setProfileAvatarY(null);
        setProfileAvatarZoom(null);
        setIsProfileLoading(false);
        return;
      }

      if (data?.is_active === false) {
        setSessionEmail(null);
        setSessionUserId(null);
        setProfileRole(null);
        setProfileRank(null);
        setProfileName(null);
        setProfileAvatarUrl(null);
        setProfileAvatarX(null);
        setProfileAvatarY(null);
        setProfileAvatarZoom(null);
        setActiveView("Dashboard");
        setIsProfileLoading(false);
        await supabase.auth.signOut();
        return;
      }

      setProfileRole(data?.role ?? null);
      setProfileRank(data?.rank ?? null);
      setProfileName(data?.name ?? null);
      setProfileAvatarUrl(data?.avatar_url ?? null);
      setProfileAvatarX(data?.avatar_position_x ?? null);
      setProfileAvatarY(data?.avatar_position_y ?? null);
      setProfileAvatarZoom(data?.avatar_zoom ?? null);
      setIsProfileLoading(false);
    };

    loadProfile();
  }, [sessionUserId]);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    setActiveView("Dashboard");
    setIsSidebarOpen(false);
  };

  const handleSetActiveView = (view: string) => {
    setActiveView(view);
    setIsSidebarOpen(false);
  };

  const handleProfileUpdated = (
    name: string | null,
    avatarUrl: string | null,
    avatarX: number | null,
    avatarY: number | null,
    avatarZoom: number | null
  ) => {
    setProfileName(name);
    setProfileAvatarUrl(avatarUrl);
    setProfileAvatarX(avatarX);
    setProfileAvatarY(avatarY);
    setProfileAvatarZoom(avatarZoom);
  };

  const normalizedProfileRole = normalizeAccessValue(profileRole);
  const normalizedProfileRank = normalizeAccessValue(profileRank);
  const isSuperAdmin = normalizedProfileRole === "super_admin";
  const isAdmin = normalizedProfileRole === "admin";
  const canViewUsers = isSuperAdmin || isAdmin;
  const isMemberAccount =
    normalizedProfileRole === "agent" ||
    normalizedProfileRole === "leader" ||
    normalizedProfileRank === "agent" ||
    normalizedProfileRank === "pre_leader" ||
    normalizedProfileRank === "leader";
  const canManageEvents = normalizedProfileRole === "super_admin" || normalizedProfileRole === "admin";
  const canViewManageCases = isSuperAdmin || isAdmin;
  const canViewCommReview = isSuperAdmin;
  const canViewPayout = isSuperAdmin;
  const canViewPaymentVoucher = isSuperAdmin || isAdmin;
  const canViewFinance = isSuperAdmin;
  const canViewSalesCases = !isSuperAdmin && !isAdmin && isMemberAccount;
  const canViewTeam = isMemberAccount;
  const canViewRanking = isMemberAccount || isAdmin || isSuperAdmin;
  const canViewRankProgress = isSuperAdmin || isAdmin;
  const hasMemberVoucherAccessByRoleOrRank =
    normalizedProfileRank === "agent" ||
    normalizedProfileRank === "pre_leader" ||
    normalizedProfileRank === "leader" ||
    normalizedProfileRole === "agent" ||
    normalizedProfileRole === "pre_leader" ||
    normalizedProfileRole === "leader";
  const canViewMemberVoucher = !isSuperAdmin && !isAdmin && hasMemberVoucherAccessByRoleOrRank;

  if (isLoading || (sessionUserId !== null && isProfileLoading)) {
    return (
      <div className="min-h-screen bg-[var(--color-body)] flex items-center justify-center text-sm text-gray-500">
        Loading...
      </div>
    );
  }

  if (!sessionEmail) {
    return <AuthPage />;
  }

  return (
    <div className="min-h-screen bg-[var(--color-body)]">
      <Sidebar
        activeView={activeView}
        setActiveView={handleSetActiveView}
        isSuperAdmin={isSuperAdmin}
        currentUserId={sessionUserId}
        canViewUsers={canViewUsers}
        canEditBranding={isSuperAdmin || isAdmin}
        canManageEvents={canManageEvents}
        canViewSalesCases={canViewSalesCases}
        canViewTeam={canViewTeam}
        canViewRanking={canViewRanking}
        canViewRankProgress={canViewRankProgress}
        canViewManageCases={canViewManageCases}
        canViewCommReview={canViewCommReview}
        canViewPayout={canViewPayout}
        canViewPaymentVoucher={canViewPaymentVoucher}
        canViewMemberVoucher={canViewMemberVoucher}
        canViewFinance={canViewFinance}
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
      />
      <Header
        pageTitle={activeView}
        userId={sessionUserId}
        userEmail={sessionEmail}
        userName={profileName}
        avatarUrl={profileAvatarUrl}
        avatarPositionX={profileAvatarX}
        avatarPositionY={profileAvatarY}
        avatarZoom={profileAvatarZoom}
        onNotificationClick={handleSetActiveView}
        onProfileClick={() => setActiveView("Profile")}
        onSignOut={handleSignOut}
        onMenuClick={() => setIsSidebarOpen((current) => !current)}
      />
      <main>
        {activeView === "Dashboard" && (
          <Dashboard role={normalizedProfileRole} rank={normalizedProfileRank} userId={sessionUserId} />
        )}
        {activeView === "Events" &&
          (canManageEvents ? (
            sessionUserId ? (
              <EventsForm userId={sessionUserId} />
            ) : (
              <div className="px-4 pb-8 pt-20 md:ml-[220px] md:w-[calc(100%-220px)] md:px-8 md:pb-12 md:pt-24">
                <div className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm text-sm text-gray-600">
                  Missing user session.
                </div>
              </div>
            )
          ) : (
            <div className="px-4 pb-8 pt-20 md:ml-[220px] md:w-[calc(100%-220px)] md:px-8 md:pb-12 md:pt-24">
              <div className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm text-sm text-gray-600">
                You do not have permission to access this section.
              </div>
            </div>
          ))}
        {canViewUsers && activeView === "Users" && <UsersForm />}
        {activeView === "Projects" && <ProjectsForm role={normalizedProfileRole} userId={sessionUserId} />}
        {activeView === "Sales Cases" &&
          (canViewSalesCases && sessionUserId ? (
            <SalesCasesForm userId={sessionUserId} />
          ) : (
            <div className="px-4 pb-8 pt-20 md:ml-[220px] md:w-[calc(100%-220px)] md:px-8 md:pb-12 md:pt-24">
              <div className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm text-sm text-gray-600">
                You do not have permission to access this section.
              </div>
            </div>
          ))}
        {activeView === "Team" &&
          (canViewTeam && sessionUserId ? (
            <TeamPage userId={sessionUserId} role={profileRole} rank={profileRank} />
          ) : (
            <div className="px-4 pb-8 pt-20 md:ml-[220px] md:w-[calc(100%-220px)] md:px-8 md:pb-12 md:pt-24">
              <div className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm text-sm text-gray-600">
                You do not have permission to access this section.
              </div>
            </div>
          ))}
        {activeView === "Ranking" &&
          (canViewRanking && sessionUserId ? (
            <RankingPage userId={sessionUserId} />
          ) : (
            <div className="px-4 pb-8 pt-20 md:ml-[220px] md:w-[calc(100%-220px)] md:px-8 md:pb-12 md:pt-24">
              <div className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm text-sm text-gray-600">
                You do not have permission to access this section.
              </div>
            </div>
          ))}
        {activeView === "Rank Progress" &&
          (canViewRankProgress ? (
            <RankProgressPage role={profileRole} userId={sessionUserId} />
          ) : (
            <div className="px-4 pb-8 pt-20 md:ml-[220px] md:w-[calc(100%-220px)] md:px-8 md:pb-12 md:pt-24">
              <div className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm text-sm text-gray-600">
                You do not have permission to access this section.
              </div>
            </div>
          ))}
        {activeView === "Manage Cases" &&
          (canViewManageCases ? (
            sessionUserId ? (
              <ManageCases userId={sessionUserId} />
            ) : (
              <div className="px-4 pb-8 pt-20 md:ml-[220px] md:w-[calc(100%-220px)] md:px-8 md:pb-12 md:pt-24">
                <div className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm text-sm text-gray-600">
                  Missing user session.
                </div>
              </div>
            )
          ) : (
            <div className="px-4 pb-8 pt-20 md:ml-[220px] md:w-[calc(100%-220px)] md:px-8 md:pb-12 md:pt-24">
              <div className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm text-sm text-gray-600">
                You do not have permission to access this section.
              </div>
            </div>
          ))}
        {activeView === "Cases Approval" &&
          (canViewCommReview ? (
            sessionUserId ? (
              <CommReviewPage userId={sessionUserId} />
            ) : (
              <div className="px-4 pb-8 pt-20 md:ml-[220px] md:w-[calc(100%-220px)] md:px-8 md:pb-12 md:pt-24">
                <div className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm text-sm text-gray-600">
                  Missing user session.
                </div>
              </div>
            )
          ) : (
            <div className="px-4 pb-8 pt-20 md:ml-[220px] md:w-[calc(100%-220px)] md:px-8 md:pb-12 md:pt-24">
              <div className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm text-sm text-gray-600">
                You do not have permission to access this section.
              </div>
            </div>
          ))}
        {activeView === "Payout" &&
          (canViewPayout ? (
            sessionUserId ? (
              <PayoutPage userId={sessionUserId} onNavigateToPaymentVoucher={() => handleSetActiveView("Payment Voucher")} />
            ) : (
              <div className="px-4 pb-8 pt-20 md:ml-[220px] md:w-[calc(100%-220px)] md:px-8 md:pb-12 md:pt-24">
                <div className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm text-sm text-gray-600">
                  Missing user session.
                </div>
              </div>
            )
          ) : (
            <div className="px-4 pb-8 pt-20 md:ml-[220px] md:w-[calc(100%-220px)] md:px-8 md:pb-12 md:pt-24">
              <div className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm text-sm text-gray-600">
                You do not have permission to access this section.
              </div>
            </div>
          ))}
        {activeView === "Payment Voucher" &&
          (canViewPaymentVoucher ? (
            sessionUserId ? (
              <PaymentVoucherPage userId={sessionUserId} canGenerateVoucher={isSuperAdmin} />
            ) : (
              <div className="px-4 pb-8 pt-20 md:ml-[220px] md:w-[calc(100%-220px)] md:px-8 md:pb-12 md:pt-24">
                <div className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm text-sm text-gray-600">
                  Missing user session.
                </div>
              </div>
            )
          ) : (
            <div className="px-4 pb-8 pt-20 md:ml-[220px] md:w-[calc(100%-220px)] md:px-8 md:pb-12 md:pt-24">
              <div className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm text-sm text-gray-600">
                You do not have permission to access this section.
              </div>
            </div>
          ))}
        {activeView === "My Payment Voucher" &&
          (canViewMemberVoucher ? (
            sessionUserId ? (
              <MyPaymentVoucherPage
                userId={sessionUserId}
                userName={profileName}
                userEmail={sessionEmail}
              />
            ) : (
              <div className="px-4 pb-8 pt-20 md:ml-[220px] md:w-[calc(100%-220px)] md:px-8 md:pb-12 md:pt-24">
                <div className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm text-sm text-gray-600">
                  Missing user session.
                </div>
              </div>
            )
          ) : (
            <div className="px-4 pb-8 pt-20 md:ml-[220px] md:w-[calc(100%-220px)] md:px-8 md:pb-12 md:pt-24">
              <div className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm text-sm text-gray-600">
                You do not have permission to access this section.
              </div>
            </div>
          ))}
        {activeView === "Finance" &&
          (canViewFinance ? (
            sessionUserId ? (
              <FinancePage userId={sessionUserId} role={profileRole} />
            ) : (
              <div className="px-4 pb-8 pt-20 md:ml-[220px] md:w-[calc(100%-220px)] md:px-8 md:pb-12 md:pt-24">
                <div className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm text-sm text-gray-600">
                  Missing user session.
                </div>
              </div>
            )
          ) : (
            <div className="px-4 pb-8 pt-20 md:ml-[220px] md:w-[calc(100%-220px)] md:px-8 md:pb-12 md:pt-24">
              <div className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm text-sm text-gray-600">
                You do not have permission to access this section.
              </div>
            </div>
          ))}
        {activeView === "Profile" && sessionUserId && (
          <ProfilePage
            userId={sessionUserId}
            role={profileRole}
            onProfileUpdated={handleProfileUpdated}
          />
        )}
      </main>
    </div>
  );
}

export default App;
