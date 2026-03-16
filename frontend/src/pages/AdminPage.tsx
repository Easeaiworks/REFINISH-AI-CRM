import { useState, useEffect } from 'react';
import { api } from '../services/api';
import { User } from '../types';

interface Props { user: User }

interface NotificationSettings {
  phone: string | null;
  notification_email: string | null;
  sms_enabled: boolean;
  email_enabled: boolean;
  daily_digest_time: string;
}

interface DigestPreview {
  dueFollowUps: { id: number; shop_name: string; follow_up_date: string }[];
  dormantAccounts: { id: number; shop_name: string; last_contacted_at: string | null }[];
  newNotes: { id: number; shop_name: string; author: string; created_at: string; content: string }[];
}

export default function AdminPage({ user }: Props) {
  const [users, setUsers] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<'users' | 'notifications' | 'data' | 'audit'>('users');
  const [showAddUser, setShowAddUser] = useState(false);
  const [newUser, setNewUser] = useState({ email: '', password: '', first_name: '', last_name: '', role: 'rep' });
  const [error, setError] = useState('');

  // Notification state
  const [notifSettings, setNotifSettings] = useState<NotificationSettings>({ phone: null, notification_email: null, sms_enabled: false, email_enabled: true, daily_digest_time: '07:30' });
  const [notifSaving, setNotifSaving] = useState(false);
  const [notifSuccess, setNotifSuccess] = useState('');
  const [digestPreview, setDigestPreview] = useState<DigestPreview | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [sendingDigest, setSendingDigest] = useState(false);

  // Data management state
  const [clearingData, setClearingData] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [dataMessage, setDataMessage] = useState('');

  useEffect(() => { loadUsers(); }, []);

  const loadUsers = async () => {
    try {
      const data = await api.get('/auth/users');
      setUsers(data.users);
    } catch (err) { console.error(err); }
  };

  const loadNotificationSettings = async () => {
    try {
      const data = await api.get('/notifications/settings');
      if (data.settings) setNotifSettings(data.settings);
    } catch (err) { console.error(err); }
  };

  const saveNotificationSettings = async () => {
    setNotifSaving(true);
    setNotifSuccess('');
    try {
      await api.put('/notifications/settings', notifSettings);
      setNotifSuccess('Settings saved!');
      setTimeout(() => setNotifSuccess(''), 3000);
    } catch (err: any) {
      setError(err.error || 'Failed to save');
    } finally {
      setNotifSaving(false);
    }
  };

  const loadDigestPreview = async () => {
    setLoadingPreview(true);
    try {
      const data = await api.get('/notifications/preview');
      setDigestPreview(data.preview);
    } catch (err) { console.error(err); }
    finally { setLoadingPreview(false); }
  };

  const sendDigestNow = async () => {
    setSendingDigest(true);
    try {
      const data = await api.post('/notifications/send-digest', {});
      setNotifSuccess(`Digest sent! ${data.results?.length || 0} notifications processed.`);
      setTimeout(() => setNotifSuccess(''), 5000);
    } catch (err: any) {
      setError(err.error || 'Failed to send digest');
    } finally {
      setSendingDigest(false);
    }
  };

  const clearAllSalesData = async () => {
    setClearingData(true);
    setDataMessage('');
    try {
      const data = await api.delete('/sales/all');
      setDataMessage(`Successfully deleted ${data.deleted} sales records.`);
      setConfirmClear(false);
      setTimeout(() => setDataMessage(''), 5000);
    } catch (err: any) {
      setError(err.error || 'Failed to clear sales data');
    } finally {
      setClearingData(false);
    }
  };

  const createUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await api.post('/auth/register', newUser);
      setShowAddUser(false);
      setNewUser({ email: '', password: '', first_name: '', last_name: '', role: 'rep' });
      loadUsers();
    } catch (err: any) {
      setError(err.error || 'Failed to create user');
    }
  };

  return (
    <div>
      <h1 className="text-2xl font-bold text-navy-900 mb-6">Admin Panel</h1>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-navy-100 rounded-lg p-1 w-fit">
        {[
          { key: 'users', label: 'User Management' },
          { key: 'notifications', label: 'Notifications' },
          { key: 'data', label: 'Data Management' },
          { key: 'audit', label: 'Audit Log' }
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => {
              setActiveTab(tab.key as any);
              if (tab.key === 'notifications') loadNotificationSettings();
            }}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === tab.key ? 'bg-white text-navy-900 shadow-sm' : 'text-navy-500 hover:text-navy-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'users' && (
        <div>
          <div className="flex justify-between items-center mb-4">
            <h2 className="font-bold text-navy-900">Team Members</h2>
            <button onClick={() => setShowAddUser(true)} className="btn-primary">+ Add User</button>
          </div>

          <div className="card overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-navy-100">
                  <th className="text-left py-3 px-4 text-xs font-medium text-navy-500 uppercase">Name</th>
                  <th className="text-left py-3 px-4 text-xs font-medium text-navy-500 uppercase">Email</th>
                  <th className="text-left py-3 px-4 text-xs font-medium text-navy-500 uppercase">Role</th>
                  <th className="text-left py-3 px-4 text-xs font-medium text-navy-500 uppercase">Status</th>
                  <th className="text-left py-3 px-4 text-xs font-medium text-navy-500 uppercase">Last Login</th>
                </tr>
              </thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.id} className="border-b border-navy-50">
                    <td className="py-3 px-4 font-medium text-navy-900">{u.first_name} {u.last_name}</td>
                    <td className="py-3 px-4 text-sm text-navy-600">{u.email}</td>
                    <td className="py-3 px-4">
                      <span className={`badge ${u.role === 'admin' ? 'bg-purple-100 text-purple-800' : u.role === 'manager' ? 'bg-blue-100 text-blue-800' : 'bg-navy-100 text-navy-700'}`}>
                        {u.role}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <span className={`badge ${u.is_active ? 'badge-active' : 'badge-cold'}`}>
                        {u.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-sm text-navy-500">
                      {u.last_login ? new Date(u.last_login).toLocaleDateString() : 'Never'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {showAddUser && (
            <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
              <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6">
                <h3 className="text-lg font-bold text-navy-900 mb-4">Add Team Member</h3>
                {error && <div className="bg-red-50 text-red-700 text-sm px-4 py-3 rounded-lg mb-4">{error}</div>}
                <form onSubmit={createUser} className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <input required placeholder="First Name" value={newUser.first_name}
                      onChange={e => setNewUser(u => ({...u, first_name: e.target.value}))} className="input-field" />
                    <input required placeholder="Last Name" value={newUser.last_name}
                      onChange={e => setNewUser(u => ({...u, last_name: e.target.value}))} className="input-field" />
                  </div>
                  <input required type="email" placeholder="Email" value={newUser.email}
                    onChange={e => setNewUser(u => ({...u, email: e.target.value}))} className="input-field" />
                  <input required type="password" placeholder="Password" value={newUser.password}
                    onChange={e => setNewUser(u => ({...u, password: e.target.value}))} className="input-field" />
                  <select value={newUser.role} onChange={e => setNewUser(u => ({...u, role: e.target.value}))} className="input-field">
                    <option value="rep">Sales Rep</option>
                    <option value="manager">Manager</option>
                    <option value="admin">Admin</option>
                  </select>
                  <div className="flex gap-3 pt-2">
                    <button type="button" onClick={() => setShowAddUser(false)} className="btn-secondary flex-1">Cancel</button>
                    <button type="submit" className="btn-primary flex-1">Create</button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'notifications' && (
        <div className="space-y-6">
          {/* Notification Settings */}
          <div className="card">
            <h2 className="font-bold text-navy-900 mb-4">Your Notification Settings</h2>
            <p className="text-sm text-navy-500 mb-6">Configure how you receive your daily actionables digest. Reps get follow-ups due, dormant accounts, and new notes from teammates.</p>

            {notifSuccess && (
              <div className="bg-green-50 text-green-700 text-sm px-4 py-3 rounded-lg mb-4 border border-green-200">{notifSuccess}</div>
            )}
            {error && (
              <div className="bg-red-50 text-red-700 text-sm px-4 py-3 rounded-lg mb-4 border border-red-200">{error}</div>
            )}

            <div className="space-y-4 max-w-lg">
              {/* SMS Settings */}
              <div className="p-4 rounded-xl border border-navy-100 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium text-navy-900">SMS Notifications</div>
                    <div className="text-xs text-navy-500">Get a text with your daily actionables</div>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={notifSettings.sms_enabled}
                      onChange={e => setNotifSettings(s => ({ ...s, sms_enabled: e.target.checked }))}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-navy-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-brand-500"></div>
                  </label>
                </div>
                {notifSettings.sms_enabled && (
                  <input
                    type="tel"
                    placeholder="Phone number (e.g. +16135551234)"
                    value={notifSettings.phone || ''}
                    onChange={e => setNotifSettings(s => ({ ...s, phone: e.target.value }))}
                    className="input-field"
                  />
                )}
              </div>

              {/* Email Settings */}
              <div className="p-4 rounded-xl border border-navy-100 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium text-navy-900">Email Notifications</div>
                    <div className="text-xs text-navy-500">Receive a morning email digest</div>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={notifSettings.email_enabled}
                      onChange={e => setNotifSettings(s => ({ ...s, email_enabled: e.target.checked }))}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-navy-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-brand-500"></div>
                  </label>
                </div>
                {notifSettings.email_enabled && (
                  <input
                    type="email"
                    placeholder="Notification email"
                    value={notifSettings.notification_email || ''}
                    onChange={e => setNotifSettings(s => ({ ...s, notification_email: e.target.value }))}
                    className="input-field"
                  />
                )}
              </div>

              {/* Digest Time */}
              <div className="p-4 rounded-xl border border-navy-100">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium text-navy-900">Digest Time</div>
                    <div className="text-xs text-navy-500">When to send your daily digest (weekdays)</div>
                  </div>
                  <input
                    type="time"
                    value={notifSettings.daily_digest_time || '07:30'}
                    onChange={e => setNotifSettings(s => ({ ...s, daily_digest_time: e.target.value }))}
                    className="input-field w-auto"
                  />
                </div>
              </div>

              <button onClick={saveNotificationSettings} disabled={notifSaving} className="btn-primary w-full">
                {notifSaving ? 'Saving...' : 'Save Notification Settings'}
              </button>
            </div>
          </div>

          {/* Digest Preview */}
          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="font-bold text-navy-900">Digest Preview</h2>
                <p className="text-xs text-navy-500">See what your next daily digest would contain</p>
              </div>
              <div className="flex gap-2">
                <button onClick={loadDigestPreview} disabled={loadingPreview} className="btn-secondary text-sm">
                  {loadingPreview ? 'Loading...' : 'Preview My Digest'}
                </button>
                {user.role === 'admin' && (
                  <button onClick={sendDigestNow} disabled={sendingDigest} className="btn-primary text-sm">
                    {sendingDigest ? 'Sending...' : 'Send Digest Now'}
                  </button>
                )}
              </div>
            </div>

            {digestPreview && (
              <div className="space-y-4">
                <div className="p-4 rounded-xl bg-amber-50 border border-amber-200">
                  <h3 className="font-medium text-amber-800 mb-2">Follow-ups Due ({digestPreview.dueFollowUps.length})</h3>
                  {digestPreview.dueFollowUps.length === 0 ? (
                    <p className="text-sm text-amber-600">No follow-ups due today!</p>
                  ) : (
                    <ul className="space-y-1">
                      {digestPreview.dueFollowUps.map(f => (
                        <li key={f.id} className="text-sm text-amber-700 flex justify-between">
                          <span className="font-medium">{f.shop_name}</span>
                          <span className="text-amber-500">{f.follow_up_date}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className="p-4 rounded-xl bg-red-50 border border-red-200">
                  <h3 className="font-medium text-red-800 mb-2">Dormant Accounts ({digestPreview.dormantAccounts.length})</h3>
                  {digestPreview.dormantAccounts.length === 0 ? (
                    <p className="text-sm text-red-600">All accounts are up to date!</p>
                  ) : (
                    <ul className="space-y-1">
                      {digestPreview.dormantAccounts.map(a => (
                        <li key={a.id} className="text-sm text-red-700 flex justify-between">
                          <span className="font-medium">{a.shop_name}</span>
                          <span className="text-red-500">{a.last_contacted_at ? `Last: ${new Date(a.last_contacted_at).toLocaleDateString()}` : 'Never contacted'}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className="p-4 rounded-xl bg-blue-50 border border-blue-200">
                  <h3 className="font-medium text-blue-800 mb-2">New Team Notes ({digestPreview.newNotes.length})</h3>
                  {digestPreview.newNotes.length === 0 ? (
                    <p className="text-sm text-blue-600">No new notes from teammates</p>
                  ) : (
                    <ul className="space-y-2">
                      {digestPreview.newNotes.map(n => (
                        <li key={n.id} className="text-sm text-blue-700">
                          <div className="flex justify-between">
                            <span className="font-medium">{n.shop_name}</span>
                            <span className="text-blue-500 text-xs">{n.author}</span>
                          </div>
                          <p className="text-blue-600 text-xs mt-0.5">{n.content}</p>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'data' && (
        <div className="space-y-6">
          <div className="card">
            <h2 className="font-bold text-navy-900 mb-2">Sales Data Management</h2>
            <p className="text-sm text-navy-500 mb-6">
              Clear imported sales data so you can re-import with the correct settings. This removes all sales records from the database but does not affect accounts, notes, or activities.
            </p>

            {dataMessage && (
              <div className="bg-green-50 text-green-700 text-sm px-4 py-3 rounded-lg mb-4 border border-green-200">{dataMessage}</div>
            )}
            {error && activeTab === 'data' && (
              <div className="bg-red-50 text-red-700 text-sm px-4 py-3 rounded-lg mb-4 border border-red-200">{error}</div>
            )}

            {!confirmClear ? (
              <button
                onClick={() => setConfirmClear(true)}
                className="px-6 py-3 bg-red-500 text-white font-medium rounded-xl hover:bg-red-600 transition-colors"
              >
                Clear All Sales Data
              </button>
            ) : (
              <div className="p-4 bg-red-50 border border-red-200 rounded-xl space-y-3">
                <p className="text-red-800 font-medium">Are you sure? This will permanently delete ALL imported sales records.</p>
                <p className="text-sm text-red-600">This cannot be undone. You will need to re-import your AccountEdge CSV after clearing.</p>
                <div className="flex gap-3">
                  <button
                    onClick={clearAllSalesData}
                    disabled={clearingData}
                    className="px-6 py-2 bg-red-600 text-white font-medium rounded-lg hover:bg-red-700 transition-colors"
                  >
                    {clearingData ? 'Deleting...' : 'Yes, Delete All Sales Data'}
                  </button>
                  <button
                    onClick={() => setConfirmClear(false)}
                    className="px-6 py-2 bg-white text-navy-700 font-medium rounded-lg border border-navy-200 hover:bg-navy-50 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'audit' && (
        <div className="card">
          <h2 className="font-bold text-navy-900 mb-4">Audit Log</h2>
          <p className="text-navy-500 text-sm">All changes to accounts, notes, and sales are logged for security.</p>
          <p className="text-navy-400 text-sm mt-2">Audit viewer coming in next release.</p>
        </div>
      )}
    </div>
  );
}
