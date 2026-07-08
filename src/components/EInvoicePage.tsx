import { useEffect, useMemo, useState } from "react";
import { FilePlus2, Pencil, Trash2, Sparkles, X } from "lucide-react";
import { supabase } from "../lib/supabaseClient";

type EInvoiceLineItem = {
  item_description: string;
  qty: number;
  nett_price: number;
  commission_rate: number;
};

type EInvoiceRecord = {
  id: string;
  invoice_number: string;
  invoice_date: string;
  bill_to: string;
  tax_rate: number;
  line_items: EInvoiceLineItem[] | null;
  created_at: string;
  updated_at: string;
};

type EInvoicePageProps = {
  userId: string;
};

type InvoiceLineDraft = {
  itemDescription: string;
  qty: string;
  nettPrice: string;
  commissionRate: string;
};

const DEFAULT_TAX_RATE = 8;

const emptyLine = (): InvoiceLineDraft => ({
  itemDescription: "",
  qty: "1",
  nettPrice: "",
  commissionRate: "",
});

const formatAmount = (value: number) => {
  const rounded = Number(value.toFixed(2));
  const hasDecimals = Math.round(rounded) !== rounded;
  return rounded.toLocaleString("en-MY", {
    minimumFractionDigits: hasDecimals ? 2 : 0,
    maximumFractionDigits: 2,
  });
};

const toNumber = (value: string) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const calculateLine = (line: InvoiceLineDraft, taxRate: number) => {
  const qty = toNumber(line.qty);
  const nettPrice = toNumber(line.nettPrice);
  const commissionRate = toNumber(line.commissionRate);
  const totalIncludeSst = Number((qty * nettPrice * (commissionRate / 100)).toFixed(2));
  const totalExcludeSst = Number((totalIncludeSst / (1 + taxRate / 100)).toFixed(2));
  const sst = Number((totalIncludeSst - totalExcludeSst).toFixed(2));

  return {
    qty,
    nettPrice,
    commissionRate,
    totalExcludeSst,
    sst,
    totalIncludeSst,
  };
};

export function EInvoicePage({ userId }: EInvoicePageProps) {
  const [records, setRecords] = useState<EInvoiceRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState<string | null>(null);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingRecordId, setEditingRecordId] = useState<string | null>(null);
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceDate, setInvoiceDate] = useState("");
  const [billTo, setBillTo] = useState("");
  const [lineDrafts, setLineDrafts] = useState<InvoiceLineDraft[]>([emptyLine()]);

  const resetForm = () => {
    setEditingRecordId(null);
    setInvoiceNumber("");
    setInvoiceDate("");
    setBillTo("");
    setLineDrafts([emptyLine()]);
  };

  const openCreateModal = () => {
    resetForm();
    setError(null);
    setSuccess(null);
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    resetForm();
  };

  const loadRecords = async () => {
    setError(null);

    const { data, error: fetchError } = await supabase
      .from("e_invoices")
      .select("id, invoice_number, invoice_date, bill_to, tax_rate, line_items, created_at, updated_at")
      .order("invoice_date", { ascending: false })
      .order("created_at", { ascending: false });

    if (fetchError) {
      setError(fetchError.message);
      return;
    }

    setRecords((data as EInvoiceRecord[]) ?? []);
  };

  useEffect(() => {
    loadRecords();
  }, []);

  const lineCalculations = useMemo(
    () => lineDrafts.map((line) => calculateLine(line, DEFAULT_TAX_RATE)),
    [lineDrafts]
  );

  const invoiceTotal = useMemo(
    () => lineCalculations.reduce((sum, line) => sum + line.totalIncludeSst, 0),
    [lineCalculations]
  );

  const addLine = () => {
    setLineDrafts((prev) => [...prev, emptyLine()]);
  };

  const removeLine = (index: number) => {
    setLineDrafts((prev) => {
      if (prev.length === 1) {
        return prev;
      }

      return prev.filter((_, idx) => idx !== index);
    });
  };

  const updateLine = (index: number, key: keyof InvoiceLineDraft, value: string) => {
    setLineDrafts((prev) =>
      prev.map((line, idx) =>
        idx === index
          ? {
              ...line,
              [key]: value,
            }
          : line
      )
    );
  };

  const handleEdit = (record: EInvoiceRecord) => {
    setEditingRecordId(record.id);
    setInvoiceNumber(record.invoice_number);
    setInvoiceDate(record.invoice_date);
    setBillTo(record.bill_to);

    const parsedLines = (record.line_items ?? []).map((line) => ({
      itemDescription: line.item_description ?? "",
      qty: String(line.qty ?? 0),
      nettPrice: String(line.nett_price ?? 0),
      commissionRate: String(line.commission_rate ?? 0),
    }));

    setLineDrafts(parsedLines.length > 0 ? parsedLines : [emptyLine()]);
    setError(null);
    setSuccess(null);
    setIsModalOpen(true);
  };

  const handleDelete = async (recordId: string) => {
    setError(null);
    setSuccess(null);
    setIsDeleting(recordId);

    const { error: deleteError } = await supabase.from("e_invoices").delete().eq("id", recordId);

    if (deleteError) {
      setError(deleteError.message);
      setIsDeleting(null);
      return;
    }

    setSuccess("E-Invoice row deleted.");
    setIsDeleting(null);
    await loadRecords();
  };

  const handleGenerate = () => {
    setSuccess("Generate action is ready. You can provide the generation rules next.");
    setError(null);
  };

  const handleSave = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    if (!invoiceNumber.trim()) {
      setError("Please enter invoice number.");
      return;
    }

    if (!invoiceDate) {
      setError("Please enter invoice date.");
      return;
    }

    if (!billTo.trim()) {
      setError("Please enter bill to (client name).");
      return;
    }

    const hasInvalidLine = lineDrafts.some((line) => {
      const qty = toNumber(line.qty);
      const nettPrice = toNumber(line.nettPrice);
      const commissionRate = toNumber(line.commissionRate);
      return !line.itemDescription.trim() || qty <= 0 || nettPrice <= 0 || commissionRate < 0;
    });

    if (hasInvalidLine) {
      setError("Please complete all line details with valid values.");
      return;
    }

    const lineItems: EInvoiceLineItem[] = lineDrafts.map((line) => ({
      item_description: line.itemDescription.trim(),
      qty: Number(toNumber(line.qty).toFixed(2)),
      nett_price: Number(toNumber(line.nettPrice).toFixed(2)),
      commission_rate: Number(toNumber(line.commissionRate).toFixed(3)),
    }));

    setIsSaving(true);

    const payload = {
      invoice_number: invoiceNumber.trim(),
      invoice_date: invoiceDate,
      bill_to: billTo.trim(),
      tax_rate: DEFAULT_TAX_RATE,
      line_items: lineItems,
      created_by: userId,
    };

    if (editingRecordId) {
      const { error: updateError } = await supabase
        .from("e_invoices")
        .update({ ...payload, updated_at: new Date().toISOString() })
        .eq("id", editingRecordId);

      if (updateError) {
        setError(updateError.message);
        setIsSaving(false);
        return;
      }

      setSuccess("E-Invoice updated.");
    } else {
      const { error: insertError } = await supabase.from("e_invoices").insert(payload);

      if (insertError) {
        setError(insertError.message);
        setIsSaving(false);
        return;
      }

      setSuccess("E-Invoice saved.");
    }

    setIsSaving(false);
    closeModal();
    await loadRecords();
  };

  return (
    <div className="px-4 pb-8 pt-20 md:ml-[220px] md:w-[calc(100%-220px)] md:px-8 md:pb-12 md:pt-24">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">E-Invoice</h2>
          <p className="mt-1 text-sm text-gray-500">Manage e-invoice headers and line details for commission billing.</p>
        </div>
        <button
          type="button"
          onClick={openCreateModal}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          <FilePlus2 className="h-4 w-4" />
          Add E-Invoice
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {success && (
        <div className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-700">
          {success}
        </div>
      )}

      <div className="rounded-xl border border-gray-100 bg-white p-6 shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm whitespace-nowrap">
            <thead>
              <tr className="border-b border-gray-100 text-left text-gray-500">
                <th className="px-4 py-2">Invoice Number</th>
                <th className="px-4 py-2">Invoice Date</th>
                <th className="px-4 py-2">Bill To</th>
                <th className="px-4 py-2">Items</th>
                <th className="px-4 py-2">Total Include SST (RM)</th>
                <th className="px-4 py-2 text-center">Download</th>
                <th className="px-4 py-2 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {records.map((record) => {
                const lineItems = record.line_items ?? [];
                const totalInclude = lineItems.reduce((sum, line) => {
                  const include = Number((line.qty * line.nett_price * (line.commission_rate / 100)).toFixed(2));
                  return sum + include;
                }, 0);

                return (
                  <tr key={record.id} className="border-b border-gray-50">
                    <td className="px-4 py-3 text-gray-700">{record.invoice_number}</td>
                    <td className="px-4 py-3 text-gray-700">{record.invoice_date}</td>
                    <td className="px-4 py-3 text-gray-700">{record.bill_to}</td>
                    <td className="px-4 py-3 text-gray-700">{lineItems.length}</td>
                    <td className="px-4 py-3 text-gray-700">RM {formatAmount(totalInclude)}</td>
                    <td className="px-4 py-3 text-center">
                      <button
                        type="button"
                        className="inline-flex items-center rounded-md border border-gray-200 px-2 py-1 text-xs text-gray-700 hover:text-gray-900"
                      >
                        Download
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => handleEdit(record)}
                          className="inline-flex items-center gap-1 rounded-md border border-blue-200 px-2 py-1 text-xs text-blue-700 hover:text-blue-800"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(record.id)}
                          disabled={isDeleting === record.id}
                          className="inline-flex items-center gap-1 rounded-md border border-red-200 px-2 py-1 text-xs text-red-600 hover:text-red-700 disabled:opacity-60"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          {isDeleting === record.id ? "Deleting..." : "Delete"}
                        </button>
                        <button
                          type="button"
                          onClick={handleGenerate}
                          className="inline-flex items-center gap-1 rounded-md border border-emerald-200 px-2 py-1 text-xs text-emerald-700 hover:text-emerald-800"
                        >
                          <Sparkles className="h-3.5 w-3.5" />
                          Generate
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}

              {records.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-6 text-center text-gray-500">
                    No e-invoice rows found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="max-h-[90vh] w-full max-w-6xl overflow-y-auto rounded-2xl border border-gray-100 bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">
                  {editingRecordId ? "Edit E-Invoice" : "Add E-Invoice"}
                </h3>
                <p className="mt-1 text-sm text-gray-500">
                  Enter invoice header details and one or more line items.
                </p>
              </div>
              <button
                type="button"
                onClick={closeModal}
                className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-900"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSave} className="space-y-4">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-700">INVOICE NUMBER</label>
                  <input
                    type="text"
                    value={invoiceNumber}
                    onChange={(event) => setInvoiceNumber(event.target.value)}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                    placeholder="e.g. INV-2026-001"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-700">INVOICE DATE</label>
                  <input
                    type="date"
                    value={invoiceDate}
                    onChange={(event) => setInvoiceDate(event.target.value)}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-700">BILL TO (CLIENT NAME)</label>
                  <input
                    type="text"
                    value={billTo}
                    onChange={(event) => setBillTo(event.target.value)}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                    placeholder="Client name"
                  />
                </div>
              </div>

              <div className="overflow-x-auto rounded-lg border border-gray-200">
                <table className="w-full text-sm whitespace-nowrap">
                  <thead>
                    <tr className="bg-slate-900 text-left text-white">
                      <th className="px-3 py-2">#</th>
                      <th className="px-3 py-2">Item &amp; Description</th>
                      <th className="px-3 py-2">Qty</th>
                      <th className="px-3 py-2">Nett Price</th>
                      <th className="px-3 py-2">Commission Rate</th>
                      <th className="px-3 py-2">Total Exclude SST</th>
                      <th className="px-3 py-2">Tax Rate</th>
                      <th className="px-3 py-2">SST</th>
                      <th className="px-3 py-2">Total Include SST</th>
                      <th className="px-3 py-2 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lineDrafts.map((line, index) => {
                      const calc = lineCalculations[index];

                      return (
                        <tr key={`line-${index}`} className="border-t border-gray-100">
                          <td className="px-3 py-2 text-gray-700">{index + 1}</td>
                          <td className="px-3 py-2">
                            <input
                              type="text"
                              value={line.itemDescription}
                              onChange={(event) => updateLine(index, "itemDescription", event.target.value)}
                              className="w-full min-w-[220px] rounded-lg border border-gray-200 px-2 py-1.5 text-sm"
                              placeholder="Claim for complete SPA signing"
                            />
                          </td>
                          <td className="px-3 py-2">
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={line.qty}
                              onChange={(event) => updateLine(index, "qty", event.target.value)}
                              className="w-24 rounded-lg border border-gray-200 px-2 py-1.5 text-sm"
                            />
                          </td>
                          <td className="px-3 py-2">
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={line.nettPrice}
                              onChange={(event) => updateLine(index, "nettPrice", event.target.value)}
                              className="w-36 rounded-lg border border-gray-200 px-2 py-1.5 text-sm"
                            />
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-1">
                              <input
                                type="number"
                                min="0"
                                step="0.001"
                                value={line.commissionRate}
                                onChange={(event) => updateLine(index, "commissionRate", event.target.value)}
                                className="w-24 rounded-lg border border-gray-200 px-2 py-1.5 text-sm"
                              />
                              <span className="text-gray-500">%</span>
                            </div>
                          </td>
                          <td className="px-3 py-2 text-gray-700">RM {formatAmount(calc.totalExcludeSst)}</td>
                          <td className="px-3 py-2 text-gray-700">{DEFAULT_TAX_RATE}%</td>
                          <td className="px-3 py-2 text-gray-700">RM {formatAmount(calc.sst)}</td>
                          <td className="px-3 py-2 text-gray-700">RM {formatAmount(calc.totalIncludeSst)}</td>
                          <td className="px-3 py-2 text-right">
                            <button
                              type="button"
                              onClick={() => removeLine(index)}
                              className="rounded-md border border-red-200 px-2 py-1 text-xs text-red-600 hover:text-red-700"
                            >
                              Remove
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={addLine}
                  className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  Add Line Item
                </button>
                <p className="text-sm font-semibold text-gray-900">Total Include SST: RM {formatAmount(invoiceTotal)}</p>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={closeModal}
                  className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
                >
                  {isSaving ? "Saving..." : editingRecordId ? "Save Changes" : "Save"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
