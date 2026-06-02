import { ResponsiveContainer, AreaChart, Area, XAxis, Tooltip } from "recharts";

const data = [
  { month: "Jan", market: 4000, actual: 2400 },
  { month: "Feb", market: 3000, actual: 1398 },
  { month: "Mar", market: 2000, actual: 3800 },
  { month: "Apr", market: 2780, actual: 3908 },
  { month: "May", market: 1890, actual: 4800 },
  { month: "Jun", market: 2390, actual: 3800 },
];

export function MarketChart() {
  return (
    <div className="h-[160px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data}>
          <XAxis dataKey="month" hide />
          <Tooltip contentStyle={{ fontSize: "12px", borderRadius: "8px" }} />
          <Area type="monotone" dataKey="market" stroke="#93C5FD" fill="#EFF6FF" strokeWidth={2} />
          <Area type="monotone" dataKey="actual" stroke="#2563EB" fill="none" strokeWidth={2} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
