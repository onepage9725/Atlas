import { ResponsiveContainer, LineChart, Line, XAxis, Tooltip } from "recharts";

const data = [
  { year: "2019", val1: 40, val2: 24 },
  { year: "2020", val1: 30, val2: 13 },
  { year: "2021", val1: 20, val2: 48 },
  { year: "2022", val1: 27, val2: 39 },
  { year: "2023", val1: 18, val2: 48 },
  { year: "2024", val1: 23, val2: 38 },
];

export function PortfolioChart() {
  return (
    <div className="h-[160px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <XAxis dataKey="year" hide />
          <Tooltip contentStyle={{ fontSize: "12px", borderRadius: "8px" }} />
          <Line type="monotone" dataKey="val1" stroke="#2563EB" strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="val2" stroke="#93C5FD" strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
