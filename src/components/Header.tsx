import { useEffect, useMemo, useRef, useState } from "react";
import { Bell, LogOut, Menu } from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import type { AppNotification, NotificationTargetView } from "../lib/notifications";

interface HeaderProps {
  pageTitle: string;
  userId: string | null;
  userEmail: string;
  userName?: string | null;
  avatarUrl?: string | null;
  avatarPositionX?: number | null;
  avatarPositionY?: number | null;
  avatarZoom?: number | null;
  onProfileClick: () => void;
  onNotificationClick: (view: NotificationTargetView) => void;
  onSignOut: () => void;
  onMenuClick: () => void;
}

export function Header({
  pageTitle,
  userId,
  userEmail,
  userName,
  avatarUrl,
  avatarPositionX,
  avatarPositionY,
  avatarZoom,
  onProfileClick,
  onNotificationClick,
  onSignOut,
  onMenuClick,
}: HeaderProps) {
  const displayName = userName || userEmail;
  const posX = avatarPositionX ?? 50;
  const posY = avatarPositionY ?? 50;
  const zoom = avatarZoom ?? 1;
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [isNotificationOpen, setIsNotificationOpen] = useState(false);
  const notificationRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!userId) {
      setNotifications([]);
      return;
    }

    let isMounted = true;

    const loadNotifications = async () => {
      const { data, error } = await supabase
        .from("notifications")
        .select("id, sales_case_id, title, message, target_view, is_read, created_at")
        .eq("recipient_id", userId)
        .order("created_at", { ascending: false })
        .limit(20);

      if (error || !isMounted) {
        return;
      }

      setNotifications((data as AppNotification[]) ?? []);
    };

    void loadNotifications();
    const interval = window.setInterval(() => {
      void loadNotifications();
    }, 30000);

    return () => {
      isMounted = false;
      window.clearInterval(interval);
    };
  }, [userId]);

  useEffect(() => {
    if (!isNotificationOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (notificationRef.current?.contains(event.target as Node)) {
        return;
      }

      setIsNotificationOpen(false);
    };

    document.addEventListener("mousedown", handlePointerDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [isNotificationOpen]);

  const unreadCount = useMemo(() => notifications.filter((notification) => !notification.is_read).length, [notifications]);

  const formatNotificationDate = (value: string) => {
    const parsedDate = new Date(value);

    if (Number.isNaN(parsedDate.getTime())) {
      return value;
    }

    return parsedDate.toLocaleString("en-MY", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const handleNotificationSelect = async (notification: AppNotification) => {
    if (!notification.is_read) {
      await supabase
        .from("notifications")
        .update({ is_read: true, read_at: new Date().toISOString() })
        .eq("id", notification.id);

      setNotifications((current) =>
        current.map((item) => (item.id === notification.id ? { ...item, is_read: true } : item))
      );
    }

    setIsNotificationOpen(false);
    onNotificationClick(notification.target_view);
  };

  return (
    <header className="fixed left-0 right-0 top-0 z-20 flex h-16 items-center justify-between border-b border-gray-100 bg-white px-4 md:left-[220px] md:px-8">
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={onMenuClick}
          className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-gray-200 text-gray-600 md:hidden"
          aria-label="Open navigation menu"
        >
          <Menu className="h-5 w-5" />
        </button>
        <h2 className="text-lg font-semibold text-gray-800 md:text-xl">{pageTitle}</h2>
      </div>
      
      <div className="flex items-center gap-3 md:gap-6">
        <div className="text-xs text-gray-500 hidden md:block">{displayName}</div>
        <button
          type="button"
          onClick={onSignOut}
          className="flex items-center gap-2 text-sm font-medium text-gray-500 hover:text-gray-900"
        >
          <LogOut className="h-4 w-4" />
          <span className="hidden md:inline">Sign out</span>
        </button>
        <div ref={notificationRef} className="relative">
          <button
            type="button"
            onClick={() => setIsNotificationOpen((current) => !current)}
            className="relative text-gray-400 hover:text-gray-600"
            aria-label="Open notifications"
          >
            <Bell className="h-5 w-5" />
            {unreadCount > 0 && (
              <span className="absolute -right-2 -top-2 inline-flex min-h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white">
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            )}
          </button>

          {isNotificationOpen && (
            <div className="absolute -right-2 top-10 z-30 w-[calc(100vw-2rem)] max-w-[360px] sm:right-0 sm:w-[360px] overflow-hidden rounded-xl border border-gray-100 bg-white shadow-xl">
              <div className="border-b border-gray-100 px-4 py-3">
                <p className="text-sm font-semibold text-gray-900">Notifications</p>
              </div>
              <div className="max-h-[420px] overflow-y-auto">
                {notifications.length === 0 ? (
                  <div className="px-4 py-6 text-sm text-gray-500">No notifications yet.</div>
                ) : (
                  notifications.map((notification) => (
                    <button
                      key={notification.id}
                      type="button"
                      onClick={() => void handleNotificationSelect(notification)}
                      className={`w-full border-b border-gray-100 px-4 py-3 text-left transition hover:bg-gray-50 ${
                        notification.is_read ? "bg-white" : "bg-blue-50/40"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-sm font-medium text-gray-900">{notification.title}</p>
                        <span className="shrink-0 text-[11px] text-gray-400">{formatNotificationDate(notification.created_at)}</span>
                      </div>
                      <p className="mt-1 text-xs leading-5 text-gray-500">{notification.message}</p>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onProfileClick}
          className="w-8 h-8 rounded-full bg-gray-200 overflow-hidden border border-gray-200 cursor-pointer"
          style={{
            backgroundImage: `url(${avatarUrl || "https://api.dicebear.com/7.x/avataaars/svg?seed=Atlas"})`,
            backgroundPosition: `${posX}% ${posY}%`,
            backgroundSize: `${zoom * 100}% ${zoom * 100}%`,
            backgroundRepeat: "no-repeat",
          }}
          aria-label="Open profile"
        />
      </div>
    </header>
  );
}
