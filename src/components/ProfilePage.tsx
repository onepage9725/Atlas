import { useEffect, useState } from "react";
import { Save, Upload, KeyRound } from "lucide-react";
import { supabase } from "../lib/supabaseClient";

interface ProfilePageProps {
  userId: string;
  role: string | null;
  onProfileUpdated: (
    name: string | null,
    avatarUrl: string | null,
    avatarX: number | null,
    avatarY: number | null,
    avatarZoom: number | null
  ) => void;
}

export function ProfilePage({ userId, role, onProfileUpdated }: ProfilePageProps) {
  const [name, setName] = useState("");
  const [bankName, setBankName] = useState("");
  const [bankAccountNumber, setBankAccountNumber] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [avatarName, setAvatarName] = useState("");
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarX, setAvatarX] = useState(50);
  const [avatarY, setAvatarY] = useState(50);
  const [avatarZoom, setAvatarZoom] = useState(1);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [recruitByLabel, setRecruitByLabel] = useState("None");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const canEditName = role === "admin" || role === "super_admin";

  useEffect(() => {
    const loadProfile = async () => {
      const { data, error: loadError } = await supabase
        .from("profiles")
        .select(
          "name, bank_name, bank_account_number, avatar_url, avatar_position_x, avatar_position_y, avatar_zoom, recruit_by"
        )
        .eq("id", userId)
        .single();

      if (loadError) {
        setError(loadError.message);
        return;
      }

      setName(data?.name ?? "");
      setBankName(data?.bank_name ?? "");
      setBankAccountNumber(data?.bank_account_number ?? "");
      setAvatarUrl(data?.avatar_url ?? null);
      setAvatarName(data?.avatar_url ? data.avatar_url.split("/").pop() ?? "" : "");
      setAvatarX(data?.avatar_position_x ?? 50);
      setAvatarY(data?.avatar_position_y ?? 50);
      setAvatarZoom(data?.avatar_zoom ?? 1);

      if (data?.recruit_by) {
        const { data: recruiterData } = await supabase
          .from("profiles")
          .select("name, email")
          .eq("id", data.recruit_by)
          .single();
        const label = recruiterData?.name || recruiterData?.email || "None";
        setRecruitByLabel(label);
      } else {
        setRecruitByLabel("None");
      }
    };

    loadProfile();
  }, [userId]);

  const handleAvatarChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    setAvatarFile(file);
    setAvatarName(file ? file.name : "");
  };

  const getStoragePathFromUrl = (url: string, bucket: string) => {
    const marker = `/storage/v1/object/public/${bucket}/`;
    const index = url.indexOf(marker);
    if (index === -1) return null;
    return url.slice(index + marker.length);
  };

  const deleteAvatarFromStorage = async (url: string | null) => {
    if (!url) return;
    const path = getStoragePathFromUrl(url, "avatars");
    if (!path) return;
    await supabase.storage.from("avatars").remove([path]);
  };

  const uploadAvatar = async () => {
    if (!avatarFile) return { newUrl: avatarUrl, oldUrl: null };

    const filePath = `${userId}/${Date.now()}-${avatarFile.name}`;
    const { error: uploadError } = await supabase.storage
      .from("avatars")
      .upload(filePath, avatarFile, { upsert: true });

    if (uploadError) {
      throw uploadError;
    }

    const { data } = supabase.storage.from("avatars").getPublicUrl(filePath);
    return { newUrl: data.publicUrl, oldUrl: avatarUrl };
  };

  const handleSaveProfile = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const { newUrl, oldUrl } = await uploadAvatar();

      const { error: updateError } = await supabase
        .from("profiles")
        .update({
          name,
          bank_name: bankName || null,
          bank_account_number: bankAccountNumber || null,
          avatar_url: newUrl,
          avatar_position_x: avatarX,
          avatar_position_y: avatarY,
          avatar_zoom: avatarZoom,
        })
        .eq("id", userId);

      if (updateError) {
        setError(updateError.message);
        setIsSaving(false);
        return;
      }

      setAvatarUrl(newUrl ?? null);
      setAvatarFile(null);
      onProfileUpdated(name || null, newUrl ?? null, avatarX, avatarY, avatarZoom);
      if (newUrl && oldUrl && newUrl !== oldUrl) {
        await deleteAvatarFromStorage(oldUrl);
      }
      setSuccess("Profile updated.");
      setIsSaving(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Upload failed.";
      setError(message);
      setIsSaving(false);
    }
  };

  const handlePasswordChange = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    if (!newPassword || newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setIsSaving(true);
    const { error: passwordError } = await supabase.auth.updateUser({ password: newPassword });
    if (passwordError) {
      setError(passwordError.message);
      setIsSaving(false);
      return;
    }

    setNewPassword("");
    setConfirmPassword("");
    setSuccess("Password updated.");
    setIsSaving(false);
  };

  return (
    <div className="space-y-6 px-4 pb-8 pt-20 md:ml-[220px] md:w-[calc(100%-220px)] md:px-8 md:pb-12 md:pt-24">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Profile</h2>
          <p className="text-gray-500 text-sm mt-1">Manage your profile and security settings.</p>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded-lg text-sm">
          {error}
        </div>
      )}
      {success && (
        <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-2 rounded-lg text-sm">
          {success}
        </div>
      )}

      <form onSubmit={handleSaveProfile} className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm space-y-4">
        <h3 className="text-lg font-semibold text-gray-800">Profile Details</h3>
        <div className="text-sm text-gray-600">
          You are recruit by: <span className="font-medium text-gray-900">{recruitByLabel}</span>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Display Name</label>
          <input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Your name"
            className="w-full border border-gray-200 rounded-lg p-2.5 text-sm focus:ring-1 focus:ring-primary focus:border-primary outline-none"
            disabled={!canEditName}
          />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Bank Name</label>
            <input
              type="text"
              value={bankName}
              onChange={(event) => setBankName(event.target.value)}
              placeholder="Bank name"
              className="w-full border border-gray-200 rounded-lg p-2.5 text-sm focus:ring-1 focus:ring-primary focus:border-primary outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Bank Account Number
            </label>
            <input
              type="text"
              value={bankAccountNumber}
              onChange={(event) => setBankAccountNumber(event.target.value)}
              placeholder="Account number"
              className="w-full border border-gray-200 rounded-lg p-2.5 text-sm focus:ring-1 focus:ring-primary focus:border-primary outline-none"
            />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Profile Picture</label>
          <div className="flex items-center gap-4">
            <div
              className="w-16 h-16 rounded-full overflow-hidden border border-gray-200 bg-gray-50"
              style={{
                backgroundImage: `url(${avatarUrl || "https://api.dicebear.com/7.x/avataaars/svg?seed=Atlas"})`,
                backgroundPosition: `${avatarX}% ${avatarY}%`,
                backgroundSize: `${avatarZoom * 100}% ${avatarZoom * 100}%`,
                backgroundRepeat: "no-repeat",
              }}
            />
            <label className="flex items-center gap-2 px-4 py-2 border border-gray-200 rounded-lg text-sm cursor-pointer hover:bg-gray-50">
              <Upload className="w-4 h-4 text-gray-500" />
              Upload Photo
              <input type="file" accept="image/*" onChange={handleAvatarChange} className="hidden" />
            </label>
            <span className="text-xs text-gray-500">{avatarName || "No file selected"}</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Zoom</label>
              <input
                type="range"
                min="1"
                max="2"
                step="0.01"
                value={avatarZoom}
                onChange={(event) => setAvatarZoom(Number(event.target.value))}
                className="w-full"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Horizontal</label>
              <input
                type="range"
                min="0"
                max="100"
                step="1"
                value={avatarX}
                onChange={(event) => setAvatarX(Number(event.target.value))}
                className="w-full"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Vertical</label>
              <input
                type="range"
                min="0"
                max="100"
                step="1"
                value={avatarY}
                onChange={(event) => setAvatarY(Number(event.target.value))}
                className="w-full"
              />
            </div>
          </div>
        </div>
        <button
          type="submit"
          disabled={isSaving}
          className="inline-flex items-center gap-2 bg-primary text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition"
        >
          <Save className="w-4 h-4" />
          {isSaving ? "Saving..." : "Save Profile"}
        </button>
      </form>

      <form onSubmit={handlePasswordChange} className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm space-y-4">
        <h3 className="text-lg font-semibold text-gray-800">Change Password</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">New Password</label>
            <input
              type="password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              placeholder="New password"
              className="w-full border border-gray-200 rounded-lg p-2.5 text-sm focus:ring-1 focus:ring-primary focus:border-primary outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Confirm Password</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              placeholder="Confirm password"
              className="w-full border border-gray-200 rounded-lg p-2.5 text-sm focus:ring-1 focus:ring-primary focus:border-primary outline-none"
            />
          </div>
        </div>
        <button
          type="submit"
          disabled={isSaving}
          className="inline-flex items-center gap-2 border border-gray-200 px-4 py-2 rounded-lg text-sm font-medium text-gray-700 hover:text-gray-900 hover:bg-gray-50"
        >
          <KeyRound className="w-4 h-4" />
          {isSaving ? "Updating..." : "Update Password"}
        </button>
      </form>
    </div>
  );
}
