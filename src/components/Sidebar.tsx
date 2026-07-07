import { useEffect, useRef, useState } from "react";
import { Briefcase, FileText, Home, DollarSign, Search, Calendar, Users, Trophy, Pencil } from "lucide-react";
import { supabase } from "../lib/supabaseClient";

interface SidebarProps {
  activeView: string;
  setActiveView: (view: string) => void;
  isSuperAdmin: boolean;
  currentUserId: string | null;
  canEditBranding: boolean;
  canManageEvents: boolean;
  canViewSalesCases: boolean;
  canViewTeam: boolean;
  canViewRanking: boolean;
  canViewRankProgress: boolean;
  canViewManageCases: boolean;
  canViewCommReview: boolean;
  canViewPayout: boolean;
  canViewPaymentVoucher: boolean;
  canViewMemberVoucher: boolean;
  canViewFinance: boolean;
  canViewUsers: boolean;
  isOpen: boolean;
  onClose: () => void;
}

type WebsiteBranding = {
  id: number;
  company_name: string | null;
  company_description: string | null;
  company_logo_url: string | null;
};

const DEFAULT_BRANDING = {
  companyName: "ATLAS Property",
  companyDescription: "Malaysia Agency",
};

const getStoragePathFromUrl = (url: string | null) => {
  if (!url) {
    return null;
  }

  const marker = "/storage/v1/object/public/avatars/";
  const markerIndex = url.indexOf(marker);

  if (markerIndex === -1) {
    return null;
  }

  return url.slice(markerIndex + marker.length).split("?")[0];
};

export function Sidebar({
  activeView,
  setActiveView,
  currentUserId,
  canEditBranding,
  canManageEvents,
  canViewSalesCases,
  canViewTeam,
  canViewRanking,
  canViewRankProgress,
  canViewManageCases,
  canViewCommReview,
  canViewPayout,
  canViewPaymentVoucher,
  canViewMemberVoucher,
  canViewFinance,
  canViewUsers,
  isOpen,
  onClose,
}: SidebarProps) {
  const [branding, setBranding] = useState<WebsiteBranding | null>(null);
  const [showBrandingEditor, setShowBrandingEditor] = useState(false);
  const [companyName, setCompanyName] = useState(DEFAULT_BRANDING.companyName);
  const [companyDescription, setCompanyDescription] = useState(DEFAULT_BRANDING.companyDescription);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [isSavingBranding, setIsSavingBranding] = useState(false);
  const [brandingError, setBrandingError] = useState<string | null>(null);
  const logoInputRef = useRef<HTMLInputElement | null>(null);

  const navItems = [
    { name: "Dashboard", icon: Home },
    { name: "Events", icon: Calendar, isVisible: canManageEvents },
    { name: "Users", icon: Users, isVisible: canViewUsers },
    { name: "Sales Cases", icon: FileText, isVisible: canViewSalesCases },
    { name: "Team", icon: Users, isVisible: canViewTeam },
    { name: "Ranking", icon: Trophy, isVisible: canViewRanking },
    { name: "Rank Progress", icon: Trophy, isVisible: canViewRankProgress },
    { name: "Manage Cases", icon: FileText, isVisible: canViewManageCases },
    { name: "Cases Approval", icon: FileText, isVisible: canViewCommReview },
    { name: "Payout", label: "Payout Approval", icon: FileText, isVisible: canViewPayout },
    { name: "Payment Voucher", icon: FileText, isVisible: canViewPaymentVoucher },
    { name: "My Payment Voucher", icon: FileText, isVisible: canViewMemberVoucher },
    { name: "Finance", icon: DollarSign, isVisible: canViewFinance },
    { name: "Projects", icon: Briefcase },
  ];

  useEffect(() => {
    const loadBranding = async () => {
      const { data, error } = await supabase
        .from("website_settings")
        .select("id, company_name, company_description, company_logo_url")
        .eq("id", 1)
        .maybeSingle();

      if (error) {
        return;
      }

      const nextBranding = (data as WebsiteBranding | null) ?? null;
      setBranding(nextBranding);
      setCompanyName(nextBranding?.company_name || DEFAULT_BRANDING.companyName);
      setCompanyDescription(nextBranding?.company_description || DEFAULT_BRANDING.companyDescription);
      setLogoUrl(nextBranding?.company_logo_url || null);
    };

    loadBranding();
  }, []);

  const openBrandingEditor = () => {
    setBrandingError(null);
    setCompanyName(branding?.company_name || DEFAULT_BRANDING.companyName);
    setCompanyDescription(branding?.company_description || DEFAULT_BRANDING.companyDescription);
    setLogoUrl(branding?.company_logo_url || null);
    setLogoFile(null);
    setShowBrandingEditor(true);
  };

  const uploadLogo = async () => {
    if (!logoFile || !currentUserId) {
      return { nextLogoUrl: logoUrl, previousLogoUrl: branding?.company_logo_url ?? null };
    }

    const filePath = `company-branding/${currentUserId}/${Date.now()}-${logoFile.name}`;
    const { error } = await supabase.storage.from("avatars").upload(filePath, logoFile, { upsert: true });

    if (error) {
      throw error;
    }

    const { data } = supabase.storage.from("avatars").getPublicUrl(filePath);

    return {
      nextLogoUrl: data.publicUrl,
      previousLogoUrl: branding?.company_logo_url ?? null,
    };
  };

  const handleSaveBranding = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!canEditBranding) {
      return;
    }

    setBrandingError(null);
    setIsSavingBranding(true);

    try {
      const { nextLogoUrl, previousLogoUrl } = await uploadLogo();
      const payload = {
        id: 1,
        company_name: companyName.trim() || DEFAULT_BRANDING.companyName,
        company_description: companyDescription.trim() || DEFAULT_BRANDING.companyDescription,
        company_logo_url: nextLogoUrl,
      };

      const { data, error } = await supabase
        .from("website_settings")
        .upsert(payload)
        .select("id, company_name, company_description, company_logo_url")
        .single();

      if (error) {
        setBrandingError(error.message);
        setIsSavingBranding(false);
        return;
      }

      if (previousLogoUrl && previousLogoUrl !== nextLogoUrl) {
        const previousPath = getStoragePathFromUrl(previousLogoUrl);

        if (previousPath) {
          await supabase.storage.from("avatars").remove([previousPath]).catch(() => undefined);
        }
      }

      const nextBranding = data as WebsiteBranding;
      setBranding(nextBranding);
      setCompanyName(nextBranding.company_name || DEFAULT_BRANDING.companyName);
      setCompanyDescription(nextBranding.company_description || DEFAULT_BRANDING.companyDescription);
      setLogoUrl(nextBranding.company_logo_url || null);
      setLogoFile(null);
      setShowBrandingEditor(false);
      setIsSavingBranding(false);
    } catch (error) {
      setBrandingError(error instanceof Error ? error.message : "Unable to save website branding.");
      setIsSavingBranding(false);
    }
  };

  const displayCompanyName = branding?.company_name || DEFAULT_BRANDING.companyName;
  const displayCompanyDescription = branding?.company_description || DEFAULT_BRANDING.companyDescription;
  const displayLogoUrl = branding?.company_logo_url || null;

  return (
    <>
      {isOpen && (
        <button
          type="button"
          aria-label="Close navigation"
          onClick={onClose}
          className="fixed inset-0 z-20 bg-black/40 md:hidden"
        />
      )}
      <aside className={`fixed left-0 top-0 z-30 flex h-screen w-[220px] flex-col border-r border-gray-100 bg-white shadow-sm transition-transform duration-200 md:z-10 ${
        isOpen
          ? "translate-x-0 pointer-events-auto"
          : "-translate-x-full pointer-events-none md:translate-x-0 md:pointer-events-auto"
      }`}>
      <div className="p-6">
        <h1 className="text-xl font-bold tracking-tight text-gray-900 cursor-pointer" onClick={() => setActiveView("Dashboard")}>
          Atlas <span className="text-primary">ERP</span>
        </h1>
      </div>
      
      <div className="px-4 pb-4">
        <div className="relative">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search..."
            className="w-full pl-9 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
          />
        </div>
      </div>

      <nav className="flex-1 px-4 space-y-1">
        {navItems
          .filter((item) => item.isVisible !== false)
          .map((item) => (
          <button
            key={item.name}
            onClick={() => setActiveView(item.name)}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
              activeView === item.name
                ? "bg-active text-primary"
                : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
            }`}
          >
            <item.icon className="h-5 w-5" />
            {item.label ?? item.name}
          </button>
        ))}
      </nav>
      
      <div className="p-4 border-t border-gray-100">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div
              className="h-10 w-10 rounded-full border border-gray-100 bg-blue-100 bg-cover bg-center text-primary flex items-center justify-center font-bold text-sm shrink-0"
              style={displayLogoUrl ? { backgroundImage: `url(${displayLogoUrl})` } : undefined}
            >
              {!displayLogoUrl ? displayCompanyName.slice(0, 2).toUpperCase() : null}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-gray-900">{displayCompanyName}</p>
              <p className="line-clamp-2 text-xs text-gray-500">{displayCompanyDescription}</p>
            </div>
          </div>
          {canEditBranding && (
            <button
              type="button"
              onClick={openBrandingEditor}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:text-gray-900"
              aria-label="Edit website branding"
            >
              <Pencil className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {showBrandingEditor && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-md rounded-xl border border-gray-100 bg-white shadow-xl">
            <form onSubmit={handleSaveBranding} className="p-5 space-y-4">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Website Branding</h3>
                <p className="mt-1 text-sm text-gray-500">Update the company name, sidebar logo, and description shown to all users.</p>
              </div>

              {brandingError && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {brandingError}
                </div>
              )}

              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700">Company Name</label>
                <input
                  type="text"
                  value={companyName}
                  onChange={(event) => setCompanyName(event.target.value)}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                />
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700">Description</label>
                <textarea
                  value={companyDescription}
                  onChange={(event) => setCompanyDescription(event.target.value)}
                  rows={3}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                />
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700">Website Profile Picture</label>
                <div className="flex items-center gap-3">
                  <div
                    className="h-12 w-12 rounded-full border border-gray-100 bg-blue-100 bg-cover bg-center text-primary flex items-center justify-center font-bold text-sm shrink-0"
                    style={logoUrl ? { backgroundImage: `url(${logoUrl})` } : undefined}
                  >
                    {!logoUrl ? companyName.slice(0, 2).toUpperCase() : null}
                  </div>
                  <div className="flex-1">
                    <button
                      type="button"
                      onClick={() => logoInputRef.current?.click()}
                      className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                    >
                      {logoFile ? "Change Image" : "Upload Image"}
                    </button>
                    <input
                      ref={logoInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(event) => {
                        const file = event.target.files?.[0] ?? null;
                        setLogoFile(file);
                        if (file) {
                          setLogoUrl(URL.createObjectURL(file));
                        }
                      }}
                    />
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowBrandingEditor(false)}
                  className="rounded-lg px-4 py-2 text-sm text-gray-600 hover:text-gray-900"
                  disabled={isSavingBranding}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
                  disabled={isSavingBranding}
                >
                  {isSavingBranding ? "Saving..." : "Save"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      </aside>
    </>
  );
}
