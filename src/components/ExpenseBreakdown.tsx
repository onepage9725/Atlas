export function ExpenseBreakdown() {
  const expenses = [
    { name: "Property Taxes", value: "31%", amount: 31, color: "bg-blue-600" },
    { name: "Insurance", value: "20%", amount: 20, color: "bg-blue-400" },
    { name: "Utilities", value: "18%", amount: 18, color: "bg-blue-300" },
    { name: "Maintenance", value: "15%", amount: 15, color: "bg-gray-300" },
  ];

  return (
    <div className="flex flex-col justify-center h-[160px] space-y-3">
      {expenses.map((expense) => (
        <div key={expense.name}>
          <div className="flex justify-between text-xs mb-1">
            <span className="text-gray-600 font-medium">{expense.name}</span>
            <span className="text-gray-900 font-semibold">{expense.value}</span>
          </div>
          <div className="w-full bg-gray-100 rounded-full h-1.5">
            <div
              className={`h-1.5 rounded-full ${expense.color}`}
              style={{ width: expense.value }}
            ></div>
          </div>
        </div>
      ))}
    </div>
  );
}
