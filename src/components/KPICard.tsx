interface KPICardProps {
  title: string;
  value: string;
  badge?: string;
}

export function KPICard({ title, value, badge }: KPICardProps) {
  return (
    <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm flex flex-col justify-between h-full">
      <h3 className="text-sm font-medium text-gray-500 mb-2">{title}</h3>
      <div className="flex items-end gap-3">
        <p className="text-2xl font-bold text-gray-900">{value}</p>
        {badge && (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-900 text-white mb-1.5">
            {badge}
          </span>
        )}
      </div>
    </div>
  );
}
