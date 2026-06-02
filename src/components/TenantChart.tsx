import { ResponsiveContainer, BarChart, Bar, XAxis, Tooltip } from "recharts";

const data = [
  { name: "Retail", value: 40 },
  { name: "Tech", value: 30 },
  { name: "Finance", value: 20 },
  { name: "Healthcare", value: 27 },
  { name: "Other", value: 18 },
];

export function TenantChart() {
  return (
    <div className="h-[160px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data}>
          <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: "#6B7280" }} />
          <Tooltip cursor={{ fill: "#F3F4F6" }} contentStyle={{ fontSize: "12px", borderRadius: "8px" }} />
          <Bar dataKey="value" fill="#2563EB" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
