import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";

const fallbackData = [
  { month: "Jan", revenue: 0.5, occupancy: 80, vacancy: 20, effectiveRent: 0.6 },
  { month: "Feb", revenue: 0.7, occupancy: 82, vacancy: 18, effectiveRent: 0.8 },
  { month: "Mar", revenue: 0.9, occupancy: 85, vacancy: 15, effectiveRent: 1.0 },
  { month: "Apr", revenue: 1.2, occupancy: 88, vacancy: 12, effectiveRent: 1.1 },
  { month: "May", revenue: 1.4, occupancy: 90, vacancy: 10, effectiveRent: 1.3 },
  { month: "Jun", revenue: 1.5, occupancy: 92, vacancy: 8, effectiveRent: 1.4 },
  { month: "Jul", revenue: 1.55, occupancy: 93, vacancy: 7, effectiveRent: 1.45 },
  { month: "Aug", revenue: 1.6, occupancy: 94, vacancy: 6, effectiveRent: 1.5 },
  { month: "Sep", revenue: 1.65, occupancy: 95, vacancy: 5, effectiveRent: 1.6 },
  { month: "Oct", revenue: 1.7, occupancy: 94, vacancy: 6, effectiveRent: 1.65 },
  { month: "Nov", revenue: 1.75, occupancy: 96, vacancy: 4, effectiveRent: 1.7 },
  { month: "Dec", revenue: 1.8, occupancy: 97, vacancy: 3, effectiveRent: 1.75 },
];

type PaymentBehaviorChartRow = {
  month: string;
  totalGdv: number;
  totalNettSales: number;
  totalSales: number;
  totalConverted: number;
  totalCases: number;
};

type PaymentBehaviorChartProps = {
  data?: PaymentBehaviorChartRow[];
};

const formatCompactCurrency = (value: number) => {
  if (!Number.isFinite(value)) {
    return "RM 0";
  }

  if (Math.abs(value) >= 1_000_000) {
    return `RM ${(value / 1_000_000).toFixed(value % 1_000_000 === 0 ? 0 : 2)}M`;
  }

  if (Math.abs(value) >= 1_000) {
    return `RM ${(value / 1_000).toFixed(value % 1_000 === 0 ? 0 : 1)}K`;
  }

  return `RM ${Math.round(value).toLocaleString("en-MY")}`;
};

export function PaymentBehaviorChart({ data }: PaymentBehaviorChartProps) {
  const chartData = data && data.length > 0
    ? data
    : fallbackData.map((item) => ({
        month: item.month,
        totalGdv: item.revenue * 1_000_000,
        totalNettSales: item.effectiveRent * 1_000_000,
        totalSales: item.revenue * 100_000,
        totalConverted: item.effectiveRent * 100_000,
        totalCases: Math.round(item.occupancy / 10),
      }));

  return (
    <div className="h-[300px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: 10, bottom: 10 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
          <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: "#6B7280" }} dy={10} />
          
          <YAxis 
            yAxisId="left" 
            axisLine={false} 
            tickLine={false} 
            tick={{ fontSize: 12, fill: "#6B7280" }}
            tickFormatter={(val) => formatCompactCurrency(Number(val))}
          />
          
          <YAxis 
            yAxisId="right" 
            orientation="right" 
            axisLine={false} 
            tickLine={false} 
            tick={{ fontSize: 12, fill: "#6B7280" }}
            tickFormatter={(val) => `${val}`}
            allowDecimals={false}
          />
          
          <Tooltip 
            formatter={(value, name) => {
              const numericValue = Number(value ?? 0);

              if (name === "Total Cases") {
                return [numericValue.toLocaleString("en-MY"), name];
              }

              return [formatCompactCurrency(numericValue), name];
            }}
            contentStyle={{ borderRadius: "8px", border: "1px solid #E5E7EB", boxShadow: "0 2px 4px rgba(0,0,0,0.05)" }}
          />
          <Legend iconType="circle" wrapperStyle={{ fontSize: "12px", paddingTop: "10px" }} />
          
          <Line yAxisId="left" type="monotone" dataKey="totalGdv" name="Total GDV" stroke="#2563EB" strokeWidth={2} dot={false} />
          <Line yAxisId="left" type="monotone" dataKey="totalNettSales" name="Total Nett Sales" stroke="#10B981" strokeWidth={2} dot={false} />
          <Line yAxisId="left" type="monotone" dataKey="totalSales" name="Total Sales" stroke="#F97316" strokeWidth={2} dot={false} />
          <Line yAxisId="left" type="monotone" dataKey="totalConverted" name="Total Converted" stroke="#EC4899" strokeWidth={2} dot={false} />
          <Line yAxisId="right" type="monotone" dataKey="totalCases" name="Total Cases" stroke="#9CA3AF" strokeWidth={2} dot={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
