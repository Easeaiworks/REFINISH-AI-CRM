import { useState, useRef } from 'react';
import { Account } from '../../types';
import { api } from '../../services/api';

interface Props {
  account: Account;
  onSave: () => void;
}

// ─── Dropdown options ───
const PAINT_LINE_OPTIONS = ['', 'PPG', 'Sherwin-Williams', 'Axalta', 'BASF', 'AkzoNobel', 'Matrix', 'Sikkens', 'Prospray', 'Other'];
const CUP_BRAND_OPTIONS = ['', '3M PPS', 'SATA RPS', 'DeVilbiss DeKups', 'Colad Snap Lid', 'Other'];
const PAPER_BRAND_OPTIONS = ['', '3M', 'Norton', 'Mirka', 'Indasa', 'Klingspor', 'Other'];
const FILLER_OPTIONS = ['', 'Bondo/3M', 'Evercoat', 'USC', 'U-POL', 'Other'];
const BANNER_OPTIONS = ['', 'CARSTAR', 'Fix Auto', 'Boyd/Gerber', 'CSN Collision', 'Assured Auto', 'None', 'Other'];
const CONTRACT_STATUS_OPTIONS = ['none', 'pending', 'active', 'expired', 'cancelled'];
const BUSINESS_TYPE_OPTIONS = [
  'Commercial Vehicles',
  'General Public',
  'Trailers',
  'Powder Coat',
  'Fireplace or Equipment',
  'Other'
];

const CONTRACT_STATUS_LABELS: Record<string, string> = {
  none: 'None',
  pending: 'Pending',
  active: 'Active',
  expired: 'Expired',
  cancelled: 'Cancelled'
};

const CONTRACT_STATUS_COLORS: Record<string, string> = {
  none: 'text-navy-400',
  pending: 'text-amber-600',
  active: 'text-green-600',
  expired: 'text-red-600',
  cancelled: 'text-navy-400'
};

function parseBusinessTypes(val: string[] | string | null): string[] {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  try { return JSON.parse(val); } catch { return []; }
}

export default function ShopDetails({ account, onSave }: Props) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Edit state
  const [form, setForm] = useState({
    sq_footage: account.sq_footage || '',
    annual_revenue: account.annual_revenue?.toString() || '',
    paint_line: account.paint_line || '',
    contract_status: account.contract_status || 'none',
    num_painters: account.num_painters?.toString() || '',
    num_body_men: account.num_body_men?.toString() || '',
    num_paint_booths: account.num_paint_booths?.toString() || '',
    cup_brand: account.cup_brand || '',
    paper_brand: account.paper_brand || '',
    filler_brand: account.filler_brand || '',
    suppliers: account.suppliers || '',
    deal_details: account.deal_details || '',
    banner: account.banner || '',
    business_types: parseBusinessTypes(account.business_types),
    business_type_notes: account.business_type_notes || '',
  });

  const startEditing = () => {
    setForm({
      sq_footage: account.sq_footage || '',
      annual_revenue: account.annual_revenue?.toString() || '',
      paint_line: account.paint_line || '',
      contract_status: account.contract_status || 'none',
      num_painters: account.num_painters?.toString() || '',
      num_body_men: account.num_body_men?.toString() || '',
      num_paint_booths: account.num_paint_booths?.toString() || '',
      cup_brand: account.cup_brand || '',
      paper_brand: account.paper_brand || '',
      filler_brand: account.filler_brand || '',
      suppliers: account.suppliers || '',
      deal_details: account.deal_details || '',
      banner: account.banner || '',
      business_types: parseBusinessTypes(account.business_types),
      business_type_notes: account.business_type_notes || '',
    });
    setEditing(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.put(`/accounts/${account.id}`, {
        sq_footage: form.sq_footage || null,
        annual_revenue: form.annual_revenue ? parseFloat(form.annual_revenue) : null,
        paint_line: form.paint_line || null,
        contract_status: form.contract_status,
        num_painters: form.num_painters ? parseInt(form.num_painters) : null,
        num_body_men: form.num_body_men ? parseInt(form.num_body_men) : null,
        num_paint_booths: form.num_paint_booths ? parseInt(form.num_paint_booths) : null,
        cup_brand: form.cup_brand || null,
        paper_brand: form.paper_brand || null,
        filler_brand: form.filler_brand || null,
        suppliers: form.suppliers || null,
        deal_details: form.deal_details || null,
        banner: form.banner || null,
        business_types: form.business_types,
        business_type_notes: form.business_type_notes || null,
      });
      setEditing(false);
      onSave();
    } catch (err) {
      console.error('Save shop details failed:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('contract', file);
      const resp = await fetch(`/api/accounts/${account.id}/upload-contract`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` },
        body: formData
      });
      if (!resp.ok) throw new Error('Upload failed');
      onSave();
    } catch (err) {
      console.error('Contract upload failed:', err);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const toggleBusinessType = (type: string) => {
    setForm(f => ({
      ...f,
      business_types: f.business_types.includes(type)
        ? f.business_types.filter(t => t !== type)
        : [...f.business_types, type]
    }));
  };

  const businessTypes = parseBusinessTypes(account.business_types);
  const contractStatus = account.contract_status || 'none';

  // ─── READ-ONLY VIEW ───
  if (!editing) {
    return (
      <div className="card">
        <div className="flex justify-between items-center mb-4">
          <h3 className="font-bold text-navy-900">Shop Details</h3>
          <button onClick={startEditing} className="btn-ghost text-sm">Edit</button>
        </div>

        <div className="space-y-3 text-sm">
          {/* Numbers row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatBox label="Sq Ft" value={account.sq_footage} />
            <StatBox label="Revenue" value={account.annual_revenue ? `$${Number(account.annual_revenue).toLocaleString()}` : null} />
            <StatBox label="Painters" value={account.num_painters?.toString()} />
            <StatBox label="Body Men" value={account.num_body_men?.toString()} />
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatBox label="Paint Booths" value={account.num_paint_booths?.toString()} />
            <StatBox label="Paint Line" value={account.paint_line} />
            <StatBox label="Cup Brand" value={account.cup_brand} />
            <StatBox label="Paper Brand" value={account.paper_brand} />
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatBox label="Filler" value={account.filler_brand} />
            <StatBox label="Banner" value={account.banner} />
            <StatBox label="Buy From" value={account.suppliers} />
            <div className="bg-navy-50 rounded-lg p-2.5">
              <div className="text-[10px] uppercase tracking-wide text-navy-400 mb-0.5">Contract</div>
              <div className={`font-semibold text-sm ${CONTRACT_STATUS_COLORS[contractStatus]}`}>
                {CONTRACT_STATUS_LABELS[contractStatus] || 'None'}
              </div>
            </div>
          </div>

          {/* Business Types */}
          {businessTypes.length > 0 && (
            <div className="pt-2 border-t border-navy-50">
              <div className="text-xs text-navy-400 mb-2">Business Type</div>
              <div className="flex flex-wrap gap-1.5">
                {businessTypes.map(t => (
                  <span key={t} className="text-xs bg-brand-50 text-brand-700 px-2.5 py-1 rounded-full font-medium">{t}</span>
                ))}
              </div>
              {account.business_type_notes && (
                <p className="text-xs text-navy-500 mt-2 italic">{account.business_type_notes}</p>
              )}
            </div>
          )}

          {/* Deal Details */}
          {account.deal_details && (
            <div className="pt-2 border-t border-navy-50">
              <div className="text-xs text-navy-400 mb-1">Deal Details</div>
              <p className="text-sm text-navy-700 whitespace-pre-wrap">{account.deal_details}</p>
            </div>
          )}

          {/* Contract File */}
          {account.contract_file_path && (
            <div className="pt-2 border-t border-navy-50">
              <div className="text-xs text-navy-400 mb-1">CHC Contract</div>
              <a
                href={account.contract_file_path}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm text-brand-600 hover:text-brand-700 font-medium"
              >
                📄 View Contract
              </a>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ─── EDIT VIEW ───
  return (
    <div className="card border-brand-200">
      <div className="flex justify-between items-center mb-4">
        <h3 className="font-bold text-navy-900">Shop Details</h3>
        <div className="flex gap-2">
          <button onClick={() => setEditing(false)} className="btn-ghost text-sm">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="btn-primary text-sm">
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>

      <div className="space-y-4">
        {/* Row 1: Numbers */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <FieldInput label="Shop Sq Ft" type="text" value={form.sq_footage} onChange={v => setForm(f => ({ ...f, sq_footage: v }))} placeholder="e.g. 5000" />
          <FieldInput label="Shop Revenue" type="text" value={form.annual_revenue} onChange={v => setForm(f => ({ ...f, annual_revenue: v }))} placeholder="e.g. 500000" />
          <FieldInput label="# Painters" type="number" value={form.num_painters} onChange={v => setForm(f => ({ ...f, num_painters: v }))} placeholder="0" />
          <FieldInput label="# Body Men" type="number" value={form.num_body_men} onChange={v => setForm(f => ({ ...f, num_body_men: v }))} placeholder="0" />
          <FieldInput label="# Paint Booths" type="number" value={form.num_paint_booths} onChange={v => setForm(f => ({ ...f, num_paint_booths: v }))} placeholder="0" />
        </div>

        {/* Row 2: Dropdowns */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <FieldSelect label="Paint Line" value={form.paint_line} onChange={v => setForm(f => ({ ...f, paint_line: v }))} options={PAINT_LINE_OPTIONS} />
          <FieldSelect label="Cup Brand" value={form.cup_brand} onChange={v => setForm(f => ({ ...f, cup_brand: v }))} options={CUP_BRAND_OPTIONS} />
          <FieldSelect label="Paper Brand" value={form.paper_brand} onChange={v => setForm(f => ({ ...f, paper_brand: v }))} options={PAPER_BRAND_OPTIONS} />
          <FieldSelect label="Filler" value={form.filler_brand} onChange={v => setForm(f => ({ ...f, filler_brand: v }))} options={FILLER_OPTIONS} />
          <FieldSelect label="Banner" value={form.banner} onChange={v => setForm(f => ({ ...f, banner: v }))} options={BANNER_OPTIONS} />
          <FieldSelect label="Contract Status" value={form.contract_status} onChange={v => setForm(f => ({ ...f, contract_status: v }))} options={CONTRACT_STATUS_OPTIONS} labels={CONTRACT_STATUS_LABELS} />
        </div>

        {/* Row 3: Text fields */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <FieldInput label="Who Do They Buy From" type="text" value={form.suppliers} onChange={v => setForm(f => ({ ...f, suppliers: v }))} placeholder="e.g. PPG, 3M, Uni-Select" />
          <div>
            <label className="block text-xs text-navy-500 mb-1">Deal Details</label>
            <textarea
              value={form.deal_details}
              onChange={e => setForm(f => ({ ...f, deal_details: e.target.value }))}
              className="input-field resize-none w-full"
              rows={2}
              placeholder="Pricing notes, special terms..."
            />
          </div>
        </div>

        {/* Business Type — Multi-select checkboxes */}
        <div>
          <label className="block text-xs text-navy-500 mb-2">Business Type (select all that apply)</label>
          <div className="flex flex-wrap gap-2">
            {BUSINESS_TYPE_OPTIONS.map(type => {
              const selected = form.business_types.includes(type);
              return (
                <button
                  key={type}
                  type="button"
                  onClick={() => toggleBusinessType(type)}
                  className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                    selected
                      ? 'bg-brand-500 text-white border-brand-500'
                      : 'bg-white text-navy-600 border-navy-200 hover:border-brand-300'
                  }`}
                >
                  {selected ? '✓ ' : ''}{type}
                </button>
              );
            })}
          </div>
          {form.business_types.includes('Other') && (
            <textarea
              value={form.business_type_notes}
              onChange={e => setForm(f => ({ ...f, business_type_notes: e.target.value }))}
              className="input-field mt-2 resize-none w-full"
              rows={2}
              placeholder="Describe other business types..."
            />
          )}
        </div>

        {/* Contract Upload */}
        <div>
          <label className="block text-xs text-navy-500 mb-1">CHC Contract File</label>
          <div className="flex items-center gap-3">
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
              onChange={handleFileUpload}
              className="text-sm text-navy-600 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-brand-50 file:text-brand-700 hover:file:bg-brand-100"
            />
            {uploading && <span className="text-xs text-navy-400">Uploading...</span>}
            {account.contract_file_path && (
              <a href={account.contract_file_path} target="_blank" rel="noopener noreferrer" className="text-xs text-brand-600 hover:underline">
                View current
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Reusable sub-components ───

function StatBox({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="bg-navy-50 rounded-lg p-2.5">
      <div className="text-[10px] uppercase tracking-wide text-navy-400 mb-0.5">{label}</div>
      <div className="font-semibold text-sm text-navy-800 truncate">{value || '—'}</div>
    </div>
  );
}

function FieldInput({ label, type, value, onChange, placeholder }: {
  label: string; type: string; value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-xs text-navy-500 mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        className="input-field w-full"
        placeholder={placeholder}
      />
    </div>
  );
}

function FieldSelect({ label, value, onChange, options, labels }: {
  label: string; value: string; onChange: (v: string) => void; options: string[]; labels?: Record<string, string>;
}) {
  return (
    <div>
      <label className="block text-xs text-navy-500 mb-1">{label}</label>
      <select value={value} onChange={e => onChange(e.target.value)} className="input-field w-full">
        {options.map(opt => (
          <option key={opt} value={opt}>{labels ? (labels[opt] || opt) : (opt || '— Select —')}</option>
        ))}
      </select>
    </div>
  );
}
