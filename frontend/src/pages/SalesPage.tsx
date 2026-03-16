import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../services/api';
import { User, SalesData } from '../types';

interface Props { user: User }

interface ParsedSale {
  customer_name: string;
  date: string;
  amount: number;
  item: string;
  quantity: number;
  cogs: number;
  profit: number;
  profit_pct: string;
  category: string;
  product_line: string;
  salesperson: string;
}

interface CustomerSummary {
  customer_name: string;
  total_amount: number;
  total_profit: number;
  line_count: number;
  date_range: string;
  salesperson: string;
  lineItems: ParsedSale[];
}

function parseAccountEdgeCSV(text: string): { records: ParsedSale[]; summaries: CustomerSummary[]; reportPeriod: string } {
  const lines = text.split('\n');
  const records: ParsedSale[] = [];
  const summaries: CustomerSummary[] = [];
  let currentCustomer = '';
  let customerLines: ParsedSale[] = [];
  let headerPassed = false;
  let reportPeriod = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Detect report period from header (e.g. "January 2026-March 2026")
    if (!headerPassed && line.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}/i)) {
      reportPeriod = line.trim();
    }

    // Skip header section - detect by column header row
    if (line.includes(',ID#,Date,Quantity,Item/Activity,Amount,')) {
      headerPassed = true;
      continue;
    }
    if (!headerPassed) continue;

    // Skip grand total
    if (line.includes('Grand Total:')) continue;

    // Check for customer total row
    if (line.includes(' Total:,')) {
      if (currentCustomer && customerLines.length > 0) {
        const totalAmount = customerLines.reduce((s, r) => s + r.amount, 0);
        const totalProfit = customerLines.reduce((s, r) => s + r.profit, 0);
        const dates = customerLines.map(r => r.date).filter(Boolean).sort();
        const salesperson = customerLines.find(r => r.salesperson)?.salesperson || '';
        summaries.push({
          customer_name: currentCustomer,
          total_amount: totalAmount,
          total_profit: totalProfit,
          line_count: customerLines.length,
          date_range: dates.length > 0 ? `${dates[0]} - ${dates[dates.length - 1]}` : '',
          salesperson,
          lineItems: [...customerLines],
        });
        customerLines = [];
      }
      continue;
    }

    // Check if this is a customer name row
    if (!line.startsWith(',') && !line.startsWith('"') && !line.match(/^\d/)) {
      const parts = line.split(',');
      if (parts.length <= 3 && !line.includes('$')) {
        currentCustomer = line.trim();
        customerLines = [];
        continue;
      }
    }

    // Parse line item rows (start with comma = indented under customer)
    if (line.startsWith(',') && currentCustomer) {
      const rawLine = line.substring(1);
      const parts = parseCSVLine(rawLine);

      if (parts.length >= 6) {
        const date = parts[1]?.trim() || '';
        const quantity = parseInt(parts[2]?.trim() || '0');
        const item = parts[3]?.trim() || '';
        const amountStr = (parts[4] || '').replace(/[\$",()]/g, '').trim();
        const amount = parseFloat(amountStr) || 0;
        const cogsStr = (parts[5] || '').replace(/[\$",()]/g, '').trim();
        const cogs = parseFloat(cogsStr) || 0;
        const profitStr = (parts[6] || '').replace(/[\$",()]/g, '').trim();
        const profit = parseFloat(profitStr) || 0;
        const profitPct = parts[7]?.trim() || '';
        const category = parts[8]?.trim() || '';
        const productLine = parts[9]?.trim() || '';
        const salesperson = parts[10]?.trim() || '';

        if (date && date.match(/\d+\/\d+\/\d+/) && amount !== 0) {
          const record: ParsedSale = {
            customer_name: currentCustomer,
            date: formatDate(date),
            amount,
            item,
            quantity,
            cogs,
            profit,
            profit_pct: profitPct,
            category,
            product_line: productLine,
            salesperson,
          };
          records.push(record);
          customerLines.push(record);
        }
      }
    }
  }

  // Catch last customer
  if (currentCustomer && customerLines.length > 0) {
    const totalAmount = customerLines.reduce((s, r) => s + r.amount, 0);
    const totalProfit = customerLines.reduce((s, r) => s + r.profit, 0);
    const dates = customerLines.map(r => r.date).filter(Boolean).sort();
    const salesperson = customerLines.find(r => r.salesperson)?.salesperson || '';
    summaries.push({
      customer_name: currentCustomer,
      total_amount: totalAmount,
      total_profit: totalProfit,
      line_count: customerLines.length,
      date_range: dates.length > 0 ? `${dates[0]} - ${dates[dates.length - 1]}` : '',
      salesperson,
      lineItems: [...customerLines],
    });
  }

  if (!reportPeriod && records.length > 0) {
    const allDates = records.map(r => r.date).filter(Boolean).sort();
    if (allDates.length > 0) {
      const first = new Date(allDates[0]);
      const last = new Date(allDates[allDates.length - 1]);
      reportPeriod = `${first.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })} - ${last.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`;
    }
  }

  return { records, summaries, reportPeriod };
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

function formatDate(dateStr: string): string {
  const parts = dateStr.split('/');
  if (parts.length === 3) {
    const month = parts[0].padStart(2, '0');
    const day = parts[1].padStart(2, '0');
    const year = parts[2];
    return `${year}-${month}-${day}`;
  }
  return dateStr;
}

export default function SalesPage({ user }: Props) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [sales, setSales] = useState<SalesData[]>([]);
  const [loading, setLoading] = useState(true);
  const [showImport, setShowImport] = useState(false);
  const [importResult, setImportResult] = useState<any>(null);
  const [importing, setImporting] = useState(false);
  const [parsePreview, setParsePreview] = useState<{ records: ParsedSale[]; summaries: CustomerSummary[]; reportPeriod: string } | null>(null);
  const [expandedPreview, setExpandedPreview] = useState<Set<number>>(new Set());
  const [expandedSale, setExpandedSale] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Filters
  const [filterCustomer, setFilterCustomer] = useState<string>('');
  const [filterSalesperson, setFilterSalesperson] = useState<string>('');
  const [voiceMatchFeedback, setVoiceMatchFeedback] = useState<string>('');

  useEffect(() => { loadSales(); }, []);

  // Handle ?customer= URL param (from voice navigation) — fuzzy match to actual customer names
  useEffect(() => {
    const customerParam = searchParams.get('customer');
    if (customerParam && sales.length > 0) {
      const query = customerParam.toLowerCase();
      const customers = [...new Set(sales.map(s => s.customer_name || s.shop_name || '').filter(Boolean))];

      // Try exact match first
      const exact = customers.find(c => c.toLowerCase() === query);
      if (exact) {
        setFilterCustomer(exact);
        setExpandedSale(exact);
        setVoiceMatchFeedback('');
      } else {
        // Fuzzy match — find best substring/contains match
        const contains = customers.filter(c => c.toLowerCase().includes(query) || query.includes(c.toLowerCase()));
        if (contains.length === 1) {
          setFilterCustomer(contains[0]);
          setExpandedSale(contains[0]);
          setVoiceMatchFeedback('');
        } else if (contains.length > 1) {
          // Multiple matches — pick the closest one by length similarity
          const best = contains.sort((a, b) =>
            Math.abs(a.length - customerParam.length) - Math.abs(b.length - customerParam.length)
          )[0];
          setFilterCustomer(best);
          setExpandedSale(best);
          setVoiceMatchFeedback(`Matched "${customerParam}" to "${best}"`);
        } else {
          // No substring match — try word overlap
          const queryWords = query.split(/\s+/);
          const scored = customers.map(c => {
            const cWords = c.toLowerCase().split(/\s+/);
            const overlap = queryWords.filter(w => cWords.some(cw => cw.includes(w) || w.includes(cw))).length;
            return { name: c, score: overlap };
          }).filter(s => s.score > 0).sort((a, b) => b.score - a.score);

          if (scored.length > 0) {
            setFilterCustomer(scored[0].name);
            setExpandedSale(scored[0].name);
            setVoiceMatchFeedback(`Matched "${customerParam}" to "${scored[0].name}"`);
          } else {
            setVoiceMatchFeedback(`No customer found matching "${customerParam}"`);
          }
        }
      }
      // Clear the URL param so it doesn't re-trigger
      setSearchParams({}, { replace: true });
    }

    // Handle ?rep= URL param (from voice navigation) — fuzzy match to salesperson names
    const repParam = searchParams.get('rep');
    if (repParam && sales.length > 0) {
      const query = repParam.toLowerCase();
      const reps = [...new Set(sales.map(s => s.salesperson || '').filter(Boolean))];
      const match = reps.find(r => r.toLowerCase().includes(query) || query.includes(r.toLowerCase()));
      if (match) {
        setFilterSalesperson(match);
        setVoiceMatchFeedback(`Showing sales for rep: ${match}`);
      } else {
        // Try word overlap
        const queryWords = query.split(/\s+/);
        const scored = reps.map(r => {
          const rWords = r.toLowerCase().split(/\s+/);
          const overlap = queryWords.filter(w => rWords.some(rw => rw.includes(w) || w.includes(rw))).length;
          return { name: r, score: overlap };
        }).filter(s => s.score > 0).sort((a, b) => b.score - a.score);
        if (scored.length > 0) {
          setFilterSalesperson(scored[0].name);
          setVoiceMatchFeedback(`Matched "${repParam}" to rep: ${scored[0].name}`);
        } else {
          setVoiceMatchFeedback(`No salesperson found matching "${repParam}"`);
        }
      }
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, sales, setSearchParams]);

  const loadSales = async () => {
    try {
      const data = await api.get('/sales', { limit: '2000' });
      setSales(data.sales);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      if (!text) return;

      const parsed = parseAccountEdgeCSV(text);
      setParsePreview(parsed);
      setImportResult(null);
      setExpandedPreview(new Set());
    };
    reader.readAsText(file);
  };

  const togglePreviewRow = (index: number) => {
    setExpandedPreview(prev => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const confirmImport = async (mode: 'summary' | 'detailed') => {
    if (!parsePreview) return;
    setImporting(true);

    try {
      let records;
      if (mode === 'summary') {
        records = parsePreview.summaries.map(s => ({
          customer_name: s.customer_name,
          amount: s.total_amount,
          date: s.date_range.split(' - ')[1] || s.date_range.split(' - ')[0] || new Date().toISOString().split('T')[0],
          memo: `${s.line_count} line items, Profit: $${s.total_profit.toFixed(2)}${s.salesperson ? ', Rep: ' + s.salesperson : ''}`,
          salesperson: s.salesperson,
        }));
      } else {
        records = parsePreview.records.map(r => ({
          customer_name: r.customer_name,
          amount: r.amount,
          date: r.date,
          memo: `${r.item} (Qty: ${r.quantity})${r.category ? ' [' + r.category + ']' : ''}${r.salesperson ? ' - ' + r.salesperson : ''}`,
          item_name: r.item,
          quantity: r.quantity,
          cogs: r.cogs,
          profit: r.profit,
          category: r.category,
          product_line: r.product_line,
          salesperson: r.salesperson,
        }));
      }

      const data = await api.post('/sales/import', { records });
      setImportResult(data);
      setParsePreview(null);
      loadSales();
    } catch (err) {
      console.error(err);
    } finally {
      setImporting(false);
    }
  };

  // Build unique filter options from all sales data
  const allCustomers = [...new Set(sales.map(s => s.customer_name || s.shop_name || '').filter(Boolean))].sort();
  const allSalespersons = [...new Set(sales.map(s => s.salesperson || '').filter(Boolean))].sort();

  // Apply filters
  const filteredSales = sales.filter(s => {
    if (filterCustomer && (s.customer_name || s.shop_name || '') !== filterCustomer) return false;
    if (filterSalesperson && (s.salesperson || '') !== filterSalesperson) return false;
    return true;
  });

  // Group filtered sales by customer
  const groupedSales = filteredSales.reduce<Record<string, SalesData[]>>((acc, sale) => {
    const key = sale.customer_name || sale.shop_name || 'Unmatched';
    if (!acc[key]) acc[key] = [];
    acc[key].push(sale);
    return acc;
  }, {});

  const customerTotals = Object.entries(groupedSales).map(([name, items]) => ({
    name,
    total: items.reduce((s, i) => s + (i.sale_amount || 0), 0),
    totalProfit: items.reduce((s, i) => s + (i.profit || 0), 0),
    count: items.length,
    shop_name: items[0]?.shop_name || null,
    salesperson: items.find(i => i.salesperson)?.salesperson || '',
    dates: items.map(i => i.sale_date).filter(Boolean).sort(),
    items,
  })).sort((a, b) => b.total - a.total);

  // Group a customer's items by invoice date
  const groupByInvoice = (items: SalesData[]) => {
    const byDate: Record<string, SalesData[]> = {};
    items.forEach(item => {
      const key = item.sale_date || 'unknown';
      if (!byDate[key]) byDate[key] = [];
      byDate[key].push(item);
    });
    return Object.entries(byDate).sort(([a], [b]) => a.localeCompare(b));
  };

  const fmtDate = (d: string) => {
    try {
      return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
    } catch { return d; }
  };

  const activeFilters = (filterCustomer ? 1 : 0) + (filterSalesperson ? 1 : 0);

  return (
    <div>
      {/* Date range banner */}
      {sales.length > 0 && (() => {
        const dates = sales.map(s => s.sale_date).filter(Boolean).sort();
        if (dates.length === 0) return null;
        const first = new Date(dates[0] + 'T00:00:00');
        const last = new Date(dates[dates.length - 1] + 'T00:00:00');
        return (
          <div className="bg-brand-50 border border-brand-200 rounded-xl px-5 py-3 mb-6 flex items-center justify-between">
            <div>
              <span className="text-sm text-brand-700 font-medium">Sales data for: </span>
              <span className="text-sm text-brand-900 font-bold">
                {first.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })} &ndash; {last.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
              </span>
            </div>
            <span className="text-xs text-brand-600">{sales.length} records &middot; {allCustomers.length} customers</span>
          </div>
        );
      })()}

      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-navy-900">Sales Tracking</h1>
          <p className="text-navy-500 text-sm mt-1">Import from AccountEdge or log sales manually. Click any customer to see invoices.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => { setShowImport(!showImport); setParsePreview(null); setImportResult(null); }} className="btn-primary">
            Import from AccountEdge
          </button>
        </div>
      </div>

      {/* Filter Bar */}
      {sales.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 mb-5">
          <span className="text-xs font-medium text-navy-500 uppercase tracking-wide">Filter by:</span>
          <select
            value={filterCustomer}
            onChange={e => { setFilterCustomer(e.target.value); setExpandedSale(null); }}
            className="input-field w-auto min-w-[180px] text-sm py-2"
          >
            <option value="">All Customers</option>
            {allCustomers.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          {allSalespersons.length > 0 && (
            <select
              value={filterSalesperson}
              onChange={e => { setFilterSalesperson(e.target.value); setExpandedSale(null); }}
              className="input-field w-auto min-w-[160px] text-sm py-2"
            >
              <option value="">All Salespersons</option>
              {allSalespersons.map(sp => <option key={sp} value={sp}>{sp}</option>)}
            </select>
          )}
          {activeFilters > 0 && (
            <button
              onClick={() => { setFilterCustomer(''); setFilterSalesperson(''); setExpandedSale(null); }}
              className="text-xs text-brand-600 hover:text-brand-800 underline"
            >
              Clear filters ({activeFilters})
            </button>
          )}
          {activeFilters > 0 && (
            <span className="text-xs text-navy-400 ml-auto">
              Showing {filteredSales.length} of {sales.length} records &middot; {customerTotals.length} customer{customerTotals.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
      )}

      {/* Voice match feedback */}
      {voiceMatchFeedback && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-2 mb-4 flex items-center justify-between">
          <span className="text-sm text-blue-700">{voiceMatchFeedback}</span>
          <button onClick={() => setVoiceMatchFeedback('')} className="text-blue-400 hover:text-blue-600 text-xs ml-3">dismiss</button>
        </div>
      )}

      {/* Import section */}
      {showImport && (
        <div className="card mb-6">
          <h3 className="font-bold text-navy-900 mb-3">Import AccountEdge Sales Report</h3>
          <p className="text-sm text-navy-500 mb-4">
            Upload your AccountEdge "Customer Sales Detail" or "Profit Analysis" CSV export.
            The system will parse the report, match customers to your accounts, and import the sales data.
          </p>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.txt"
            onChange={handleFileUpload}
            className="input-field"
          />

          {/* Parse Preview with expandable rows */}
          {parsePreview && (
            <div className="mt-4 space-y-4">
              <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                {parsePreview.reportPeriod && (
                  <p className="text-blue-900 font-bold mb-1">
                    Report Period: {parsePreview.reportPeriod}
                  </p>
                )}
                <p className="text-blue-800 font-medium">
                  Parsed {parsePreview.summaries.length} customers with {parsePreview.records.length} line items
                </p>
                <p className="text-sm text-blue-600 mt-1">
                  Total revenue: ${parsePreview.summaries.reduce((s, c) => s + c.total_amount, 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </p>
                <p className="text-xs text-blue-500 mt-1">Click any customer row to see their line-item transactions</p>
              </div>

              {/* Customer summary table with expandable rows */}
              <div className="max-h-96 overflow-y-auto border border-navy-100 rounded-lg">
                <table className="w-full text-sm">
                  <thead className="bg-navy-50 sticky top-0 z-10">
                    <tr>
                      <th className="text-left py-2 px-3 text-xs font-medium text-navy-500 w-6"></th>
                      <th className="text-left py-2 px-3 text-xs font-medium text-navy-500">Customer</th>
                      <th className="text-right py-2 px-3 text-xs font-medium text-navy-500">Revenue</th>
                      <th className="text-right py-2 px-3 text-xs font-medium text-navy-500">Profit</th>
                      <th className="text-right py-2 px-3 text-xs font-medium text-navy-500">Items</th>
                      <th className="text-left py-2 px-3 text-xs font-medium text-navy-500">Rep</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsePreview.summaries.map((s, i) => (
                      <>
                        <tr
                          key={`summary-${i}`}
                          onClick={() => togglePreviewRow(i)}
                          className="border-t border-navy-50 cursor-pointer hover:bg-brand-50 transition-colors"
                        >
                          <td className="py-2 px-3 text-navy-400">
                            <span className={`inline-block transition-transform ${expandedPreview.has(i) ? 'rotate-90' : ''}`}>&#9654;</span>
                          </td>
                          <td className="py-2 px-3 font-medium text-brand-700">{s.customer_name}</td>
                          <td className="py-2 px-3 text-right text-green-600 font-medium">${s.total_amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                          <td className="py-2 px-3 text-right text-navy-600">${s.total_profit.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                          <td className="py-2 px-3 text-right text-navy-500">{s.line_count}</td>
                          <td className="py-2 px-3 text-navy-500">{s.salesperson || '-'}</td>
                        </tr>
                        {expandedPreview.has(i) && (
                          <tr key={`detail-${i}`}>
                            <td colSpan={6} className="p-0">
                              <div className="bg-navy-50 border-y border-navy-100">
                                <table className="w-full text-xs">
                                  <thead>
                                    <tr className="text-navy-400">
                                      <th className="text-left py-1.5 px-3 pl-10">Date</th>
                                      <th className="text-left py-1.5 px-3">Item</th>
                                      <th className="text-right py-1.5 px-3">Qty</th>
                                      <th className="text-right py-1.5 px-3">Amount</th>
                                      <th className="text-right py-1.5 px-3">COGS</th>
                                      <th className="text-right py-1.5 px-3">Profit</th>
                                      <th className="text-left py-1.5 px-3">Category</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {s.lineItems.map((item, j) => (
                                      <tr key={j} className="border-t border-navy-100/50 hover:bg-white/50">
                                        <td className="py-1.5 px-3 pl-10 text-navy-600">{item.date}</td>
                                        <td className="py-1.5 px-3 font-medium text-navy-800">{item.item}</td>
                                        <td className="py-1.5 px-3 text-right text-navy-600">{item.quantity}</td>
                                        <td className="py-1.5 px-3 text-right text-green-600">${item.amount.toFixed(2)}</td>
                                        <td className="py-1.5 px-3 text-right text-navy-500">${item.cogs.toFixed(2)}</td>
                                        <td className={`py-1.5 px-3 text-right ${item.profit >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                                          ${item.profit.toFixed(2)}
                                        </td>
                                        <td className="py-1.5 px-3 text-navy-500">{item.category || '-'}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Import buttons */}
              <div className="flex gap-3">
                <button
                  onClick={() => confirmImport('detailed')}
                  disabled={importing}
                  className="btn-primary flex-1"
                >
                  {importing ? 'Importing...' : `Import Detailed (${parsePreview.records.length} line items)`}
                </button>
                <button
                  onClick={() => confirmImport('summary')}
                  disabled={importing}
                  className="btn-secondary flex-1"
                >
                  {importing ? 'Importing...' : `Import Summary (${parsePreview.summaries.length} customer totals)`}
                </button>
              </div>
              <p className="text-xs text-navy-400">
                <strong>Detailed</strong> (recommended) imports every line item for full drill-down. Summary imports one total per customer.
              </p>
            </div>
          )}

          {importResult && (
            <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded-lg">
              <p className="text-green-800 font-medium">
                Import complete: {importResult.imported} records imported
              </p>
              {importResult.unmatched?.length > 0 && (
                <div className="mt-2">
                  <p className="text-sm text-yellow-700 font-medium">
                    {importResult.unmatched.length} records could not be matched to existing accounts:
                  </p>
                  <div className="max-h-40 overflow-y-auto mt-1">
                    {importResult.unmatched.map((u: any, i: number) => (
                      <div key={i} className="text-sm text-yellow-600 mt-1">
                        {u.customer_name} — ${u.amount?.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Main Sales Table - grouped by customer with invoice drill-down */}
      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-4 border-brand-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : filteredSales.length === 0 ? (
        <div className="card text-center py-12">
          <p className="text-navy-500">{activeFilters > 0 ? 'No sales match the selected filters.' : 'No sales data yet.'}</p>
          <p className="text-sm text-navy-400 mt-2">
            {activeFilters > 0 ? 'Try adjusting or clearing your filters.' : 'Import a CSV from AccountEdge to get started.'}
          </p>
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-navy-100">
                <th className="text-left py-3 px-4 text-xs font-medium text-navy-500 uppercase w-6"></th>
                <th className="text-left py-3 px-4 text-xs font-medium text-navy-500 uppercase">Customer</th>
                <th className="text-right py-3 px-4 text-xs font-medium text-navy-500 uppercase">Total Revenue</th>
                <th className="text-right py-3 px-4 text-xs font-medium text-navy-500 uppercase">Total Profit</th>
                <th className="text-right py-3 px-4 text-xs font-medium text-navy-500 uppercase">Invoices</th>
                <th className="text-left py-3 px-4 text-xs font-medium text-navy-500 uppercase">Rep</th>
              </tr>
            </thead>
            <tbody>
              {customerTotals.map((ct) => {
                const isExpanded = expandedSale === ct.name;
                const hasDetailedItems = ct.items.some(s => s.item_name);
                const invoiceGroups = groupByInvoice(ct.items);
                const invoiceCount = invoiceGroups.length;
                return (
                  <>
                    <tr
                      key={ct.name}
                      onClick={() => setExpandedSale(isExpanded ? null : ct.name)}
                      className="border-b border-navy-50 cursor-pointer hover:bg-brand-50 transition-colors"
                    >
                      <td className="py-3 px-4 text-navy-400">
                        <span className={`inline-block transition-transform text-xs ${isExpanded ? 'rotate-90' : ''}`}>&#9654;</span>
                      </td>
                      <td className="py-3 px-4 text-sm font-medium text-brand-700">
                        {ct.shop_name || ct.name}
                      </td>
                      <td className="py-3 px-4 text-sm text-right font-bold text-green-600">
                        ${ct.total.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                      </td>
                      <td className={`py-3 px-4 text-sm text-right font-medium ${ct.totalProfit >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                        ${ct.totalProfit.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                      </td>
                      <td className="py-3 px-4 text-sm text-right text-navy-500">
                        {invoiceCount} invoice{invoiceCount !== 1 ? 's' : ''} ({ct.count} items)
                      </td>
                      <td className="py-3 px-4 text-sm text-navy-500">
                        {ct.salesperson || '-'}
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr key={`${ct.name}-detail`}>
                        <td colSpan={6} className="p-0">
                          <div className="bg-navy-50 border-y border-navy-100">
                            {hasDetailedItems ? (
                              <div className="divide-y divide-navy-200">
                                {invoiceGroups.map(([date, items], gi) => {
                                  const invTotal = items.reduce((s, i) => s + (i.sale_amount || 0), 0);
                                  const invProfit = items.reduce((s, i) => s + (i.profit || 0), 0);
                                  const invCogs = items.reduce((s, i) => s + (i.cogs || 0), 0);
                                  return (
                                    <div key={gi} className="py-2">
                                      {/* Invoice header */}
                                      <div className="flex items-center justify-between px-4 pl-10 py-1.5">
                                        <span className="text-xs font-bold text-navy-800">
                                          Invoice: {fmtDate(date)}
                                        </span>
                                        <span className="text-xs text-navy-500">
                                          {items.length} item{items.length !== 1 ? 's' : ''}
                                        </span>
                                      </div>
                                      {/* Line items */}
                                      <table className="w-full text-xs">
                                        <thead>
                                          <tr className="text-navy-400">
                                            <th className="text-left py-1 px-4 pl-14">Item</th>
                                            <th className="text-right py-1 px-3">Qty</th>
                                            <th className="text-right py-1 px-3">Amount</th>
                                            <th className="text-right py-1 px-3">COGS</th>
                                            <th className="text-right py-1 px-3">Profit</th>
                                            <th className="text-left py-1 px-3">Category</th>
                                            <th className="text-left py-1 px-3">Product Line</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {items.map((sale, j) => (
                                            <tr key={j} className="border-t border-navy-100/30 hover:bg-white/50">
                                              <td className="py-1.5 px-4 pl-14 font-medium text-navy-800">{sale.item_name || '-'}</td>
                                              <td className="py-1.5 px-3 text-right text-navy-600">{sale.quantity || '-'}</td>
                                              <td className="py-1.5 px-3 text-right text-green-600">${sale.sale_amount?.toFixed(2)}</td>
                                              <td className="py-1.5 px-3 text-right text-navy-500">${(sale.cogs || 0).toFixed(2)}</td>
                                              <td className={`py-1.5 px-3 text-right ${(sale.profit || 0) >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                                                ${(sale.profit || 0).toFixed(2)}
                                              </td>
                                              <td className="py-1.5 px-3 text-navy-500">{sale.category || '-'}</td>
                                              <td className="py-1.5 px-3 text-navy-500">{sale.product_line || '-'}</td>
                                            </tr>
                                          ))}
                                          {/* Invoice total row */}
                                          <tr className="bg-navy-100/50 font-semibold">
                                            <td className="py-1.5 px-4 pl-14 text-navy-700">Invoice Total</td>
                                            <td className="py-1.5 px-3"></td>
                                            <td className="py-1.5 px-3 text-right text-green-700">${invTotal.toFixed(2)}</td>
                                            <td className="py-1.5 px-3 text-right text-navy-600">${invCogs.toFixed(2)}</td>
                                            <td className={`py-1.5 px-3 text-right ${invProfit >= 0 ? 'text-green-700' : 'text-red-600'}`}>${invProfit.toFixed(2)}</td>
                                            <td className="py-1.5 px-3" colSpan={2}></td>
                                          </tr>
                                        </tbody>
                                      </table>
                                    </div>
                                  );
                                })}
                                {/* Customer grand total */}
                                <div className="bg-navy-200/40 px-4 pl-10 py-3 flex items-center justify-between">
                                  <span className="text-sm font-bold text-navy-900">
                                    Total Sales &mdash; {ct.shop_name || ct.name}
                                  </span>
                                  <div className="flex gap-6 text-sm">
                                    <span className="font-bold text-green-700">Revenue: ${ct.total.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                                    <span className={`font-bold ${ct.totalProfit >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                                      Profit: ${ct.totalProfit.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                                    </span>
                                    <span className="text-navy-600">{invoiceCount} invoice{invoiceCount !== 1 ? 's' : ''} &middot; {ct.count} items</span>
                                  </div>
                                </div>
                              </div>
                            ) : (
                              /* Fallback for summary-only data */
                              <div>
                                <table className="w-full text-xs">
                                  <thead>
                                    <tr className="text-navy-400">
                                      <th className="text-left py-1.5 px-4 pl-10">Date</th>
                                      <th className="text-right py-1.5 px-3">Amount</th>
                                      <th className="text-left py-1.5 px-3">Details</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {ct.items.map((sale, j) => (
                                      <tr key={j} className="border-t border-navy-100/50 hover:bg-white/50">
                                        <td className="py-1.5 px-4 pl-10 text-navy-600">{sale.sale_date}</td>
                                        <td className="py-1.5 px-3 text-right text-green-600">${sale.sale_amount?.toFixed(2)}</td>
                                        <td className="py-1.5 px-3 text-navy-600">{sale.memo || '-'}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                                <div className="bg-navy-200/40 px-4 pl-10 py-3 flex items-center justify-between">
                                  <span className="text-sm font-bold text-navy-900">Total Sales</span>
                                  <span className="text-sm font-bold text-green-700">${ct.total.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                                </div>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
