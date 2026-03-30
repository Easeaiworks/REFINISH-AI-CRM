import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../services/api';
import { User, Account, Note, Activity, STATUS_LABELS, STATUS_COLORS, StatusType } from '../types';
import { useVoiceInput } from '../hooks/useVoiceInput';
import ShopDetails from '../components/accounts/ShopDetails';

interface Props { user: User }

export default function AccountDetailPage({ user }: Props) {
  const { id } = useParams();
  const navigate = useNavigate();
  const [account, setAccount] = useState<Account | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<Partial<Account>>({});

  // Note input
  const [newNote, setNewNote] = useState('');
  const [savingNote, setSavingNote] = useState(false);

  // Note activity type (optional dropdown beside note)
  const [noteActivityType, setNoteActivityType] = useState('none');

  // Auto-log toast
  const [autoLogToast, setAutoLogToast] = useState('');

  // Edit note
  const [editingNoteId, setEditingNoteId] = useState<number | null>(null);
  const [editNoteContent, setEditNoteContent] = useState('');
  const [savingEditNote, setSavingEditNote] = useState(false);

  // Follow-up scheduling
  const [showFollowUp, setShowFollowUp] = useState(false);
  const [followUpDate, setFollowUpDate] = useState('');
  const [followUpNotes, setFollowUpNotes] = useState('');
  const [savingFollowUp, setSavingFollowUp] = useState(false);

  const { isListening, startListening, stopListening, isSupported } = useVoiceInput(
    (text) => setNewNote(prev => prev + (prev ? ' ' : '') + text)
  );

  useEffect(() => { loadAccount(); }, [id]);

  const loadAccount = async () => {
    try {
      const data = await api.get(`/accounts/${id}`);
      setAccount(data.account);
      setNotes(data.notes);
      setActivities(data.activities);
      setEditForm(data.account);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const saveNote = async () => {
    if (!newNote.trim()) return;
    setSavingNote(true);
    try {
      await api.post(`/accounts/${id}/notes`, {
        content: newNote.trim(),
        is_voice_transcribed: isListening
      });
      // If an activity type was selected, also log the activity
      if (noteActivityType !== 'none') {
        await api.post(`/accounts/${id}/activities`, {
          activity_type: noteActivityType,
          description: newNote.trim()
        });
      }
      setNewNote('');
      setNoteActivityType('none');
      loadAccount();
    } catch (err) {
      console.error(err);
    } finally {
      setSavingNote(false);
    }
  };

  const updateNote = async () => {
    if (!editNoteContent.trim() || !editingNoteId) return;
    setSavingEditNote(true);
    try {
      await api.put(`/notes/${editingNoteId}`, { content: editNoteContent.trim() });
      setEditingNoteId(null);
      setEditNoteContent('');
      loadAccount();
    } catch (err) {
      console.error(err);
    } finally {
      setSavingEditNote(false);
    }
  };

  // Activity type config: label + icon + color
  const ACTIVITY_TAGS: Record<string, { label: string; icon: string; bg: string }> = {
    call:                     { label: 'Call',                    icon: '📞', bg: 'bg-green-100' },
    email:                    { label: 'Email',                   icon: '📧', bg: 'bg-purple-100' },
    text:                     { label: 'Text',                    icon: '💬', bg: 'bg-blue-100' },
    meeting:                  { label: 'Meeting',                 icon: '🤝', bg: 'bg-amber-100' },
    visit:                    { label: 'Visit',                   icon: '🚗', bg: 'bg-teal-100' },
    sales_call:               { label: 'Sales Call',              icon: '💼', bg: 'bg-indigo-100' },
    drop_in:                  { label: 'Drop In',                 icon: '🚪', bg: 'bg-orange-100' },
    contract_presentation:    { label: 'Contract Presentation',   icon: '📑', bg: 'bg-red-100' },
    proposal:                 { label: 'Proposal',                icon: '📄', bg: 'bg-cyan-100' },
    product_demo:             { label: 'Product Demo',            icon: '🎯', bg: 'bg-pink-100' },
    vendor_partner_visit:     { label: 'Vendor/Partner Visit',    icon: '🏢', bg: 'bg-lime-100' },
    other:                    { label: 'Other',                   icon: '📋', bg: 'bg-navy-100' },
  };

  // Auto-log: fires native action AND logs the activity automatically
  const handleContactAction = async (type: 'call' | 'sms' | 'email', href: string) => {
    // Fire the native action
    window.location.href = href;
    // Auto-log the activity
    try {
      const actType = type === 'sms' ? 'text' : type;
      await api.post(`/accounts/${id}/activities`, {
        activity_type: actType,
        description: `${actType.charAt(0).toUpperCase() + actType.slice(1)} initiated from app`
      });
      setAutoLogToast(`${actType.charAt(0).toUpperCase() + actType.slice(1)} logged`);
      setTimeout(() => setAutoLogToast(''), 3000);
      // Refresh to show in timeline
      setTimeout(() => loadAccount(), 1000);
    } catch (err) {
      console.error('Auto-log failed:', err);
    }
  };

  const scheduleFollowUp = async () => {
    if (!followUpDate) return;
    setSavingFollowUp(true);
    try {
      await api.post(`/accounts/${id}/follow-up`, {
        follow_up_date: followUpDate,
        follow_up_notes: followUpNotes || null
      });
      setShowFollowUp(false);
      setFollowUpDate('');
      setFollowUpNotes('');
      loadAccount();
    } catch (err) {
      console.error(err);
    } finally {
      setSavingFollowUp(false);
    }
  };

  const saveEdit = async () => {
    try {
      await api.put(`/accounts/${id}`, editForm);
      setEditing(false);
      loadAccount();
    } catch (err) {
      console.error(err);
    }
  };

  if (loading) return (
    <div className="flex justify-center py-12">
      <div className="w-8 h-8 border-4 border-brand-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  if (!account) return (
    <div className="card text-center py-12">
      <p className="text-navy-500">Account not found</p>
      <button onClick={() => navigate('/accounts')} className="btn-primary mt-4">Back to Accounts</button>
    </div>
  );

  // Clean phone for tel:/sms: links
  const cleanPhone = (phone: string) => phone.replace(/[^\d+]/g, '');
  const hasPhone = !!account.phone?.trim();
  const hasEmail = !!account.email?.trim();
  const phoneHref = hasPhone ? cleanPhone(account.phone!) : '';

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between mb-4 sm:mb-6 gap-3">
        <div>
          <button onClick={() => navigate(`/accounts?category=${account.account_category || 'lead'}`)} className="text-sm text-navy-400 hover:text-navy-600 mb-2 flex items-center gap-1">
            &larr; Back to {account.account_category === 'customer' ? 'Customers' : 'Leads'}
          </button>
          <h1 className="text-xl sm:text-2xl font-bold text-navy-900">{account.shop_name}</h1>
          <div className="flex items-center gap-3 mt-2 flex-wrap">
            {account.account_category === 'customer' ? (
              <span className="badge badge-active">Active Customer</span>
            ) : (
              <span className={`badge ${STATUS_COLORS[account.status]}`}>{STATUS_LABELS[account.status]}</span>
            )}
            {account.branch && (
              <span className="inline-flex items-center gap-1 text-sm text-brand-600 font-medium bg-brand-50 px-2 py-0.5 rounded">
                📍 {account.branch}
              </span>
            )}
            {account.city && (!account.branch || !account.city.toLowerCase().includes(account.branch.toLowerCase())) && (
              <span className="text-sm text-navy-500">{account.city}{account.province ? `, ${account.province}` : ''}</span>
            )}
            {account.contact_names && <span className="text-sm text-navy-400">{account.contact_names}</span>}
          </div>
        </div>
        <button onClick={() => setEditing(!editing)} className="btn-ghost text-sm self-start">
          {editing ? 'Cancel' : 'Edit'}
        </button>
      </div>

      {/* ═══ CONTACT ACTION BAR ═══ */}
      {/* Tap to call/text/email — auto-logs the activity */}
      {(hasPhone || hasEmail) && !editing && (
        <div className="grid grid-cols-3 gap-2 sm:gap-3 mb-4 sm:mb-6">
          {hasPhone ? (
            <button
              onClick={() => handleContactAction('call', `tel:${phoneHref}`)}
              className="flex flex-col items-center gap-1.5 py-3 sm:py-4 rounded-xl bg-green-50 border border-green-200 text-green-700 hover:bg-green-100 transition-colors active:scale-95"
            >
              <span className="text-2xl">📞</span>
              <span className="text-xs sm:text-sm font-medium">Call</span>
              <span className="text-[10px] text-green-500 hidden sm:block truncate max-w-full px-2">{account.phone}</span>
            </button>
          ) : (
            <div className="flex flex-col items-center gap-1.5 py-3 sm:py-4 rounded-xl bg-navy-50 border border-navy-100 text-navy-300">
              <span className="text-2xl opacity-40">📞</span>
              <span className="text-xs sm:text-sm font-medium">No phone</span>
            </div>
          )}

          {hasPhone ? (
            <button
              onClick={() => handleContactAction('sms', `sms:${phoneHref}`)}
              className="flex flex-col items-center gap-1.5 py-3 sm:py-4 rounded-xl bg-blue-50 border border-blue-200 text-blue-700 hover:bg-blue-100 transition-colors active:scale-95"
            >
              <span className="text-2xl">💬</span>
              <span className="text-xs sm:text-sm font-medium">Text</span>
              <span className="text-[10px] text-blue-500 hidden sm:block truncate max-w-full px-2">{account.phone}</span>
            </button>
          ) : (
            <div className="flex flex-col items-center gap-1.5 py-3 sm:py-4 rounded-xl bg-navy-50 border border-navy-100 text-navy-300">
              <span className="text-2xl opacity-40">💬</span>
              <span className="text-xs sm:text-sm font-medium">No phone</span>
            </div>
          )}

          {hasEmail ? (
            <button
              onClick={() => handleContactAction('email', `mailto:${account.email}`)}
              className="flex flex-col items-center gap-1.5 py-3 sm:py-4 rounded-xl bg-purple-50 border border-purple-200 text-purple-700 hover:bg-purple-100 transition-colors active:scale-95"
            >
              <span className="text-2xl">📧</span>
              <span className="text-xs sm:text-sm font-medium">Email</span>
              <span className="text-[10px] text-purple-500 hidden sm:block truncate max-w-full px-2">{account.email}</span>
            </button>
          ) : (
            <div className="flex flex-col items-center gap-1.5 py-3 sm:py-4 rounded-xl bg-navy-50 border border-navy-100 text-navy-300">
              <span className="text-2xl opacity-40">📧</span>
              <span className="text-xs sm:text-sm font-medium">No email</span>
            </div>
          )}
        </div>
      )}

      {/* Auto-log toast */}
      {autoLogToast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-green-600 text-white text-sm font-medium px-4 py-2 rounded-lg shadow-lg animate-slide-down">
          ✓ {autoLogToast}
        </div>
      )}

      {/* Contact Info — compact row */}
      <div className="card mb-4 sm:mb-6">
        <h3 className="font-bold text-navy-900 mb-4">Contact Information</h3>
        {editing ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-navy-500 mb-1">Shop Name</label>
              <input className="input-field" value={editForm.shop_name || ''} onChange={e => setEditForm(f => ({...f, shop_name: e.target.value}))} />
            </div>
            <div>
              <label className="block text-xs text-navy-500 mb-1">Contact Names</label>
              <input className="input-field" value={editForm.contact_names || ''} onChange={e => setEditForm(f => ({...f, contact_names: e.target.value}))} />
            </div>
            <div>
              <label className="block text-xs text-navy-500 mb-1">Phone</label>
              <input className="input-field" type="tel" value={editForm.phone || ''} onChange={e => setEditForm(f => ({...f, phone: e.target.value}))} placeholder="e.g. 613-555-1234" />
            </div>
            <div>
              <label className="block text-xs text-navy-500 mb-1">Email</label>
              <input className="input-field" type="email" value={editForm.email || ''} onChange={e => setEditForm(f => ({...f, email: e.target.value}))} placeholder="e.g. joe@acmecollision.com" />
            </div>
            <div>
              <label className="block text-xs text-navy-500 mb-1">Address</label>
              <input className="input-field" value={editForm.address || ''} onChange={e => setEditForm(f => ({...f, address: e.target.value}))} />
            </div>
            <div>
              <label className="block text-xs text-navy-500 mb-1">City</label>
              <input className="input-field" value={editForm.city || ''} onChange={e => setEditForm(f => ({...f, city: e.target.value}))} />
            </div>
            <div>
              <label className="block text-xs text-navy-500 mb-1">Status</label>
              <select className="input-field" value={editForm.status || 'prospect'} onChange={e => setEditForm(f => ({...f, status: e.target.value as StatusType}))}>
                {Object.entries(STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-navy-500 mb-1">Branch</label>
              <select className="input-field" value={editForm.branch || ''} onChange={e => setEditForm(f => ({...f, branch: e.target.value}))}>
                <option value="">— Unassigned —</option>
                {['Hamilton', 'Markham', 'Oakville', 'Ottawa', 'St. Catharines', 'Woodbridge'].map(b => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-2 lg:col-span-3">
              <button onClick={saveEdit} className="btn-primary w-full sm:w-auto">Save Changes</button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-x-6 gap-y-2 text-sm">
            <InfoRow label="Contact(s)" value={account.contact_names} />
            <InfoRow label="Phone" value={account.phone} href={hasPhone ? `tel:${phoneHref}` : undefined} />
            <InfoRow label="Email" value={account.email} href={hasEmail ? `mailto:${account.email}` : undefined} />
            <InfoRow label="Address" value={account.address} />
            <InfoRow label="City" value={account.city} />
          </div>
        )}
      </div>

      {/* Shop Details — full width */}
      <div className="mb-4 sm:mb-6">
        <ShopDetails account={account} user={user} onSave={loadAccount} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-1 gap-4 sm:gap-6">
        {/* Notes & Activities — full width */}
        <div className="space-y-4 sm:space-y-6">
          {/* Add Note — with optional activity type dropdown */}
          <div className="card">
            <h3 className="font-bold text-navy-900 mb-3">Add Note</h3>
            <div className="relative">
              <textarea
                value={newNote}
                onChange={(e) => setNewNote(e.target.value)}
                placeholder="Type a note or use voice input..."
                className="input-field min-h-[60px] resize-none pr-10 w-full"
                rows={2}
              />
              {isSupported && (
                <button
                  onClick={isListening ? stopListening : startListening}
                  className={`absolute right-2 top-2 p-1.5 rounded-lg transition-colors ${
                    isListening ? 'text-brand-500 bg-brand-50' : 'text-navy-400 hover:text-navy-600'
                  }`}
                  title={isListening ? 'Stop recording' : 'Voice input'}
                >
                  {isListening && <div className="absolute inset-0 bg-brand-500/20 rounded-full voice-pulse" />}
                  <svg className="w-5 h-5 relative" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
                    <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
                  </svg>
                </button>
              )}
            </div>
            {isListening && (
              <div className="text-xs text-brand-500 mt-2 flex items-center gap-1">
                <div className="w-2 h-2 bg-brand-500 rounded-full animate-pulse" />
                Listening... speak now
              </div>
            )}
            <div className="flex items-center gap-2 mt-3">
              <select
                value={noteActivityType}
                onChange={e => setNoteActivityType(e.target.value)}
                className="input-field w-auto text-sm"
              >
                <option value="none">Note only</option>
                {Object.entries(ACTIVITY_TAGS).map(([key, { label, icon }]) => (
                  <option key={key} value={key}>{icon} {label}</option>
                ))}
              </select>
              <span className="text-xs text-navy-400 hidden sm:inline">
                {noteActivityType !== 'none' ? `Will also log as: ${ACTIVITY_TAGS[noteActivityType]?.label}` : 'Optional: tag as activity type'}
              </span>
              <button onClick={saveNote} disabled={savingNote || !newNote.trim()} className="btn-primary ml-auto">
                {savingNote ? '...' : 'Save'}
              </button>
            </div>
          </div>

          {/* Follow-up Scheduling */}
          <div className="card">
            <div className="flex justify-between items-center mb-3">
              <div>
                <h3 className="font-bold text-navy-900">Follow-up</h3>
                {account.follow_up_date && !showFollowUp && (
                  <p className="text-xs text-navy-500 mt-1">
                    Scheduled: <span className={`font-medium ${new Date(account.follow_up_date) < new Date() ? 'text-red-600' : 'text-amber-600'}`}>
                      {new Date(account.follow_up_date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                      {new Date(account.follow_up_date) < new Date() && ' (overdue)'}
                    </span>
                  </p>
                )}
              </div>
              {!showFollowUp && (
                <button onClick={() => { setShowFollowUp(true); setFollowUpDate(account.follow_up_date || ''); }} className="btn-ghost text-sm">
                  {account.follow_up_date ? 'Reschedule' : 'Schedule'}
                </button>
              )}
            </div>
            {showFollowUp && (
              <div className="space-y-3">
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="date"
                    value={followUpDate}
                    onChange={e => setFollowUpDate(e.target.value)}
                    min={new Date().toISOString().split('T')[0]}
                    className="input-field flex-1"
                  />
                  <div className="flex gap-1">
                    {[1, 3, 7, 14].map(days => (
                      <button
                        key={days}
                        onClick={() => {
                          const d = new Date();
                          d.setDate(d.getDate() + days);
                          setFollowUpDate(d.toISOString().split('T')[0]);
                        }}
                        className="btn-ghost text-xs px-2 py-1"
                      >
                        +{days}d
                      </button>
                    ))}
                  </div>
                </div>
                <input
                  placeholder="Notes (optional) e.g. Call about pricing quote"
                  value={followUpNotes}
                  onChange={e => setFollowUpNotes(e.target.value)}
                  className="input-field"
                />
                <div className="flex gap-2">
                  <button onClick={scheduleFollowUp} disabled={savingFollowUp || !followUpDate} className="btn-primary flex-1">
                    {savingFollowUp ? 'Saving...' : 'Set Follow-up'}
                  </button>
                  <button onClick={() => setShowFollowUp(false)} className="btn-ghost">Cancel</button>
                </div>
              </div>
            )}
          </div>

          {/* Notes & Activity Timeline */}
          <div className="card">
            <h3 className="font-bold text-navy-900 mb-4">Notes & Activity Timeline</h3>
            {notes.length === 0 && activities.length === 0 ? (
              <p className="text-navy-400 text-sm py-6 text-center">No notes or activities yet. Add your first note above!</p>
            ) : (
              <div className="space-y-4">
                {[
                  ...notes.map(n => ({ type: 'note' as const, date: n.created_at, data: n })),
                  ...activities.map(a => ({ type: 'activity' as const, date: a.created_at, data: a }))
                ]
                  .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                  .map((item, idx) => {
                    const isNote = item.type === 'note';
                    const note = isNote ? (item.data as Note) : null;
                    const activity = !isNote ? (item.data as Activity) : null;
                    const tagConfig = activity ? ACTIVITY_TAGS[activity.activity_type] || ACTIVITY_TAGS.other : null;
                    const canEdit = isNote && (note!.created_by_id === user.id || user.role !== 'rep');
                    const isEditing = isNote && editingNoteId === note!.id;

                    return (
                      <div key={`${item.type}-${isNote ? note!.id : activity!.id}`} className="flex gap-3 pb-4 border-b border-navy-50 last:border-0">
                        {/* Icon */}
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-sm ${
                          isNote ? 'bg-blue-100' : (tagConfig?.bg || 'bg-green-100')
                        }`}>
                          {isNote ? '📝' : tagConfig?.icon || '📋'}
                        </div>
                        {/* Content */}
                        <div className="flex-1 min-w-0">
                          <div className="flex justify-between items-start gap-2">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-xs font-medium text-navy-900">
                                {isNote ? `${note!.first_name} ${note!.last_name}` : `${activity!.first_name} ${activity!.last_name}`}
                              </span>
                              {!isNote && tagConfig && (
                                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${tagConfig.bg} text-navy-700`}>
                                  {tagConfig.icon} {tagConfig.label}
                                </span>
                              )}
                              {isNote && note!.is_voice_transcribed ? (
                                <span className="text-[10px] text-navy-400 bg-navy-50 px-1.5 py-0.5 rounded-full">🎤 Voice</span>
                              ) : null}
                            </div>
                            <div className="flex items-center gap-1 flex-shrink-0">
                              {canEdit && !isEditing && (
                                <button
                                  onClick={() => { setEditingNoteId(note!.id); setEditNoteContent(note!.content); }}
                                  className="text-[10px] text-navy-400 hover:text-navy-600 px-1.5 py-0.5 rounded hover:bg-navy-50"
                                >
                                  Edit
                                </button>
                              )}
                              <span className="text-xs text-navy-400">
                                {new Date(item.date).toLocaleDateString()} {new Date(item.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </span>
                            </div>
                          </div>
                          {/* Note content — editable or read-only */}
                          {isEditing ? (
                            <div className="mt-2 space-y-2">
                              <textarea
                                value={editNoteContent}
                                onChange={e => setEditNoteContent(e.target.value)}
                                className="input-field w-full min-h-[60px] resize-none text-sm"
                                rows={3}
                                autoFocus
                              />
                              <div className="flex gap-2">
                                <button onClick={updateNote} disabled={savingEditNote || !editNoteContent.trim()} className="btn-primary text-xs px-3 py-1">
                                  {savingEditNote ? 'Saving...' : 'Save'}
                                </button>
                                <button onClick={() => { setEditingNoteId(null); setEditNoteContent(''); }} className="btn-ghost text-xs px-3 py-1">
                                  Cancel
                                </button>
                              </div>
                            </div>
                          ) : (
                            <p className="text-sm text-navy-700 mt-1 whitespace-pre-wrap">
                              {isNote
                                ? note!.content
                                : activity!.description || `Logged a ${tagConfig?.label || activity!.activity_type}`
                              }
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function InfoRow({ label, value, href }: { label: string; value: string | null | undefined; href?: string }) {
  if (!value || value === 'null') return null;
  return (
    <div className="flex justify-between py-1.5 border-b border-navy-50">
      <span className="text-navy-500">{label}</span>
      {href ? (
        <a href={href} className="font-medium text-brand-600 hover:text-brand-700">{value}</a>
      ) : (
        <span className="font-medium text-navy-900 text-right">{value}</span>
      )}
    </div>
  );
}
