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

interface ManagedUser {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  role: string;
  is_active: boolean;
  last_login: string | null;
  created_at: string;
}

export default function AdminPage({ user }: Props) {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [activeTab, setActiveTab] = useState<'users' | 'notifications' | 'data' | 'audit'>('users');
  const [showAddUser, setShowAddUser] = useState(false);
  const [newUser, setNewUser] = useState({ email: '', password: '', first_name: '', last_name: '', role: 'rep' });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // User management state
  const [editingUser, setEditingUser] = useState<ManagedUser | null>(null);
  const [resetPasswordUser, setResetPasswordUser] = useState<ManagedUser | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [actionLoading, setActionLoading] = useState<number | null>(null);
  const [showCreatePassword, setShowCreatePassword] = useState(false);
  const [showResetPassword, setShowResetPassword] = useState(false);

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

  // Google Drive auto-import state
  interface GDriveStatus { configured: boolean; lastRun: any; cronSchedule: string; folderId: string | null }
  interface ImportLogEntry { id: number; status: string; files_processed: number; records_imported: number; unmatched_count: number; details: any; error_message: string | null; triggered_by: string; created_at: string }
  const [gdriveStatus, setGdriveStatus] = useState<GDriveStatus | null>(null);
  const [importHistory, setImportHistory] = useState<ImportLogEntry[]>([]);
  const [importRunning, setImportRunning] = useState(false);
  const [importResult, setImportResult] = useState<string>('');

  useEffect(() => { loadUsers(); }, []);

  const loadUsers = async () => {
    try {
      const data = await api.get('/auth/users');
      setUsers(data.users);
    } catch (err) { console.error(err); }
  };

  const showSuccess = (msg: string) => {
    setSuccess(msg);
    setTimeout(() => setSuccess(''), 4000);
  };

  const showError = (msg: string) => {
    setError(msg);
    setTimeout(() => setError(''), 5000);
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
      showError(err.error || 'Failed to save');
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
      showError(err.error || 'Failed to send digest');
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
      showError(err.error || 'Failed to clear sales data');
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
      setShowCreatePassword(false);
      setNewUser({ email: '', password: '', first_name: '', last_name: '', role: 'rep' });
      showSuccess('User created successfully');
      loadUsers();
    } catch (err: any) {
      showError(err.error || 'Failed to create user');
    }
  };

  const handleResetPassword = async () => {
    if (!resetPasswordUser || !newPassword) return;
    setActionLoading(resetPasswordUser.id);
    try {
      const data = await api.put(`/auth/users/${resetPasswordUser.id}/reset-password`, { password: newPassword });
      showSuccess(data.message);
      setResetPasswordUser(null);
      setNewPassword('');
      setShowResetPassword(false);
    } catch (err: any) {
      showError(err.error || 'Failed to reset password');
    } finally {
      setActionLoading(null);
    }
  };

  const handleToggleActive = async (u: ManagedUser) => {
    setActionLoading(u.id);
    try {
      const data = await api.put(`/auth/users/${u.id}/toggle-active`, {});
      showSuccess(data.message);
      loadUsers();
    } catch (err: any) {
      showError(err.error || 'Failed to update user status');
    } finally {
      setActionLoading(null);
    }
  };

  const handleRoleChange = async (u: ManagedUser, newRole: string) => {
    setActionLoading(u.id);
    try {
      const data = await api.put(`/auth/users/${u.id}/role`, { role: newRole });
      showSuccess(data.message);
      loadUsers();
    } catch (err: any) {
      showError(err.error || 'Failed to change role');
    } finally {
      setActionLoading(null);
    }
  };

  const handleUpdateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;
    setActionLoading(editingUser.id);
    try {
      await api.put(`/auth/users/${editingUser.id}`, {
        first_name: editingUser.first_name,
        last_name: editingUser.last_name,
        email: editingUser.email,
      });
      showSuccess(`Updated ${editingUser.first_name} ${editingUser.last_name}`);
      setEditingUser(null);
      loadUsers();
    } catch (err: any) {
      showError(err.error || 'Failed to update user');
    } finally {
      setActionLoading(null);
    }
  };

  const loadGDriveStatus = async () => {
    try {
      const data = await api.get('/gdrive-import/status');
      setGdriveStatus(data);
    } catch (err) { console.error(err); }
  };

  const loadImportHistory = async () => {
    try {
      const data = await api.get('/gdrive-import/history');
      setImportHistory(data.history || []);
    } catch (err) { console.error(err); }
  };

  const runImportNow = async () => {
    setImportRunning(true);
    setImportResult('');
    try {
      const data = await api.post('/gdrive-import/run', {});
      if (data.success) {
        setImportResult(`Imported ${data.totalImported} records from ${data.filesProcessed} file(s)${data.totalUnmatched ? ` (${data.totalUnmatched} unmatched)` : ''}`);
        showSuccess('Google Drive import completed successfully');
      } else {
        setImportResult(`Import failed: ${data.error}`);
        showError(data.error || 'Import failed');
      }
      loadGDriveStatus();
      loadImportHistory();
    } catch (err: any) {
      showError(err.error || 'Failed to run import');
      setImportResult(`Error: ${err.error || err.message}`);
    } finally {
      setImportRunning(false);
    }
  };

  const isAdmin = user.role === 'admin';

  return (
    <div>
      <h1 className="text-xl sm:text-2xl font-bold text-navy-900 mb-4 sm:mb-6">Admin Panel</h1>

      {/* Global success/error banners */}
      {success && (
        <div className="bg-green-50 text-green-700 text-sm px-4 py-3 rounded-lg mb-4 border border-green-200 flex items-center justify-between">
          <span>{success}</span>
          <button onClick={() => setSuccess('')} className="text-green-400 hover:text-green-600 text-xs ml-3">dismiss</button>
        </div>
      )}
      {error && (
        <div className="bg-red-50 text-red-700 text-sm px-4 py-3 rounded-lg mb-4 border border-red-200 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError('')} className="text-red-400 hover:text-red-600 text-xs ml-3">dismiss</button>
        </div>
      )}

      {/* Tabs — scrollable on mobile */}
      <div className="overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0 mb-4 sm:mb-6">
        <div className="flex gap-1 bg-navy-100 rounded-lg p-1 w-fit min-w-max">
          {[
            { key: 'users', label: 'Users', labelFull: 'User Management' },
            { key: 'notifications', label: 'Alerts', labelFull: 'Notifications' },
            ...(isAdmin ? [{ key: 'data', label: 'Data', labelFull: 'Data Management' }] : []),
            { key: 'audit', label: 'Audit', labelFull: 'Audit Log' }
          ].map(tab => (
            <button
              key={tab.key}
              onClick={() => {
                setActiveTab(tab.key as any);
                if (tab.key === 'notifications') loadNotificationSettings();
                if (tab.key === 'data') { loadGDriveStatus(); loadImportHistory(); }
              }}
              className={`px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-medium transition-colors whitespace-nowrap ${
                activeTab === tab.key ? 'bg-white text-navy-900 shadow-sm' : 'text-navy-500 hover:text-navy-700'
              }`}
            >
              <span className="sm:hidden">{tab.label}</span>
              <span className="hidden sm:inline">{tab.labelFull}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ═══ USERS TAB ═══ */}
      {activeTab === 'users' && (
        <div>
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-4 gap-2">
            <div>
              <h2 className="font-bold text-navy-900">Team Members</h2>
              <p className="text-xs text-navy-400 mt-0.5">
                {isAdmin ? 'Manage users, reset passwords, and control access.' : 'View your team members.'}
              </p>
            </div>
            {isAdmin && (
              <button onClick={() => setShowAddUser(true)} className="btn-primary text-sm">+ Add User</button>
            )}
          </div>

          {/* Desktop table */}
          <div className="hidden sm:block card overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-navy-100">
                  <th className="text-left py-3 px-4 text-xs font-medium text-navy-500 uppercase">Name</th>
                  <th className="text-left py-3 px-4 text-xs font-medium text-navy-500 uppercase">Email</th>
                  <th className="text-left py-3 px-4 text-xs font-medium text-navy-500 uppercase">Role</th>
                  <th className="text-left py-3 px-4 text-xs font-medium text-navy-500 uppercase">Status</th>
                  <th className="text-left py-3 px-4 text-xs font-medium text-navy-500 uppercase hidden lg:table-cell">Last Login</th>
                  {isAdmin && (
                    <th className="text-right py-3 px-4 text-xs font-medium text-navy-500 uppercase">Actions</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.id} className={`border-b border-navy-50 ${!u.is_active ? 'opacity-50' : ''}`}>
                    <td className="py-3 px-4 font-medium text-navy-900">
                      {u.first_name} {u.last_name}
                      {u.id === user.id && <span className="text-xs text-brand-500 ml-1">(you)</span>}
                    </td>
                    <td className="py-3 px-4 text-sm text-navy-600">{u.email}</td>
                    <td className="py-3 px-4">
                      {isAdmin && u.id !== user.id ? (
                        <select
                          value={u.role}
                          onChange={(e) => handleRoleChange(u, e.target.value)}
                          disabled={actionLoading === u.id}
                          className="text-xs font-medium rounded-full px-2.5 py-1 border border-navy-200 bg-white cursor-pointer"
                        >
                          <option value="rep">Rep</option>
                          <option value="manager">Manager</option>
                          <option value="admin">Admin</option>
                        </select>
                      ) : (
                        <span className={`badge ${u.role === 'admin' ? 'bg-purple-100 text-purple-800' : u.role === 'manager' ? 'bg-blue-100 text-blue-800' : 'bg-navy-100 text-navy-700'}`}>
                          {u.role}
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <span className={`badge ${u.is_active ? 'badge-active' : 'bg-red-100 text-red-800'}`}>
                        {u.is_active ? 'Active' : 'Revoked'}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-sm text-navy-500 hidden lg:table-cell">
                      {u.last_login ? new Date(u.last_login).toLocaleDateString() : 'Never'}
                    </td>
                    {isAdmin && (
                      <td className="py-3 px-4 text-right">
                        {u.id !== user.id && (
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => setEditingUser({ ...u })}
                              className="text-xs text-navy-500 hover:text-navy-700 px-2 py-1 rounded hover:bg-navy-50"
                              title="Edit user details"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => { setResetPasswordUser(u); setNewPassword(''); }}
                              className="text-xs text-brand-600 hover:text-brand-800 px-2 py-1 rounded hover:bg-brand-50"
                              title="Reset password"
                            >
                              Reset PW
                            </button>
                            <button
                              onClick={() => handleToggleActive(u)}
                              disabled={actionLoading === u.id}
                              className={`text-xs px-2 py-1 rounded ${
                                u.is_active
                                  ? 'text-red-600 hover:text-red-800 hover:bg-red-50'
                                  : 'text-green-600 hover:text-green-800 hover:bg-green-50'
                              }`}
                              title={u.is_active ? 'Revoke access' : 'Restore access'}
                            >
                              {actionLoading === u.id ? '...' : u.is_active ? 'Revoke' : 'Restore'}
                            </button>
                          </div>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile card view */}
          <div className="sm:hidden space-y-2">
            {users.map(u => (
              <div key={u.id} className={`card !p-4 ${!u.is_active ? 'opacity-50' : ''}`}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-bold text-navy-900 text-sm">
                      {u.first_name} {u.last_name}
                      {u.id === user.id && <span className="text-xs text-brand-500 ml-1">(you)</span>}
                    </div>
                    <div className="text-xs text-navy-500 mt-0.5">{u.email}</div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className={`badge text-[10px] ${u.role === 'admin' ? 'bg-purple-100 text-purple-800' : u.role === 'manager' ? 'bg-blue-100 text-blue-800' : 'bg-navy-100 text-navy-700'}`}>
                      {u.role}
                    </span>
                    <span className={`badge text-[10px] ${u.is_active ? 'badge-active' : 'bg-red-100 text-red-800'}`}>
                      {u.is_active ? 'Active' : 'Revoked'}
                    </span>
                  </div>
                </div>
                {isAdmin && u.id !== user.id && (
                  <div className="flex items-center gap-2 mt-3 pt-3 border-t border-navy-100">
                    <button
                      onClick={() => setEditingUser({ ...u })}
                      className="text-xs text-navy-600 hover:text-navy-800 px-2 py-1 rounded bg-navy-50"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => { setResetPasswordUser(u); setNewPassword(''); }}
                      className="text-xs text-brand-600 hover:text-brand-800 px-2 py-1 rounded bg-brand-50"
                    >
                      Reset PW
                    </button>
                    <select
                      value={u.role}
                      onChange={(e) => handleRoleChange(u, e.target.value)}
                      disabled={actionLoading === u.id}
                      className="text-xs rounded px-2 py-1 border border-navy-200 bg-white"
                    >
                      <option value="rep">Rep</option>
                      <option value="manager">Manager</option>
                      <option value="admin">Admin</option>
                    </select>
                    <button
                      onClick={() => handleToggleActive(u)}
                      disabled={actionLoading === u.id}
                      className={`text-xs px-2 py-1 rounded ml-auto ${
                        u.is_active
                          ? 'text-red-600 bg-red-50'
                          : 'text-green-600 bg-green-50'
                      }`}
                    >
                      {actionLoading === u.id ? '...' : u.is_active ? 'Revoke' : 'Restore'}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Add User Modal */}
          {showAddUser && (
            <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
              <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6">
                <h3 className="text-lg font-bold text-navy-900 mb-4">Add Team Member</h3>
                <form onSubmit={createUser} className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <input required placeholder="First Name" value={newUser.first_name}
                      onChange={e => setNewUser(u => ({...u, first_name: e.target.value}))} className="input-field" />
                    <input required placeholder="Last Name" value={newUser.last_name}
                      onChange={e => setNewUser(u => ({...u, last_name: e.target.value}))} className="input-field" />
                  </div>
                  <input required type="email" placeholder="Email" value={newUser.email}
                    onChange={e => setNewUser(u => ({...u, email: e.target.value}))} className="input-field" />
                  <div className="relative">
                    <input required type={showCreatePassword ? 'text' : 'password'} placeholder="Temporary Password (6+ chars)" value={newUser.password}
                      onChange={e => setNewUser(u => ({...u, password: e.target.value}))} className="input-field pr-16" minLength={6} />
                    <button type="button" onClick={() => setShowCreatePassword(v => !v)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-navy-500 hover:text-navy-700 px-2 py-1 rounded bg-navy-50 hover:bg-navy-100 transition-colors">
                      {showCreatePassword ? 'Hide' : 'Show'}
                    </button>
                  </div>
                  <select value={newUser.role} onChange={e => setNewUser(u => ({...u, role: e.target.value}))} className="input-field">
                    <option value="rep">Sales Rep</option>
                    <option value="manager">Manager</option>
                    <option value="admin">Admin</option>
                  </select>
                  <p className="text-xs text-navy-400">The user will need to be given their temporary password. They can log in immediately.</p>
                  <div className="flex gap-3 pt-2">
                    <button type="button" onClick={() => setShowAddUser(false)} className="btn-secondary flex-1">Cancel</button>
                    <button type="submit" className="btn-primary flex-1">Create User</button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* Reset Password Modal */}
          {resetPasswordUser && (
            <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
              <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6">
                <h3 className="text-lg font-bold text-navy-900 mb-2">Reset Password</h3>
                <p className="text-sm text-navy-500 mb-4">
                  Set a new password for <strong>{resetPasswordUser.first_name} {resetPasswordUser.last_name}</strong> ({resetPasswordUser.email})
                </p>
                <div className="relative mb-4">
                  <input
                    type={showResetPassword ? 'text' : 'password'}
                    placeholder="New password (6+ characters)"
                    value={newPassword}
                    onChange={e => setNewPassword(e.target.value)}
                    className="input-field pr-16"
                    minLength={6}
                    autoFocus
                  />
                  <button type="button" onClick={() => setShowResetPassword(v => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-navy-500 hover:text-navy-700 px-2 py-1 rounded bg-navy-50 hover:bg-navy-100 transition-colors">
                    {showResetPassword ? 'Hide' : 'Show'}
                  </button>
                </div>
                <p className="text-xs text-navy-400 mb-4">You will need to share this password with the user directly.</p>
                <div className="flex gap-3">
                  <button onClick={() => setResetPasswordUser(null)} className="btn-secondary flex-1">Cancel</button>
                  <button
                    onClick={handleResetPassword}
                    disabled={!newPassword || newPassword.length < 6 || actionLoading === resetPasswordUser.id}
                    className="btn-primary flex-1"
                  >
                    {actionLoading === resetPasswordUser.id ? 'Resetting...' : 'Reset Password'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Edit User Modal */}
          {editingUser && (
            <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
              <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6">
                <h3 className="text-lg font-bold text-navy-900 mb-4">Edit User</h3>
                <form onSubmit={handleUpdateUser} className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <input required placeholder="First Name" value={editingUser.first_name}
                      onChange={e => setEditingUser(u => u ? {...u, first_name: e.target.value} : null)} className="input-field" />
                    <input required placeholder="Last Name" value={editingUser.last_name}
                      onChange={e => setEditingUser(u => u ? {...u, last_name: e.target.value} : null)} className="input-field" />
                  </div>
                  <input required type="email" placeholder="Email" value={editingUser.email}
                    onChange={e => setEditingUser(u => u ? {...u, email: e.target.value} : null)} className="input-field" />
                  <div className="flex gap-3 pt-2">
                    <button type="button" onClick={() => setEditingUser(null)} className="btn-secondary flex-1">Cancel</button>
                    <button type="submit" disabled={actionLoading === editingUser.id} className="btn-primary flex-1">
                      {actionLoading === editingUser.id ? 'Saving...' : 'Save Changes'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ═══ NOTIFICATIONS TAB ═══ */}
      {activeTab === 'notifications' && (
        <div className="space-y-6">
          <div className="card">
            <h2 className="font-bold text-navy-900 mb-4">Your Notification Settings</h2>
            <p className="text-sm text-navy-500 mb-6">Configure how you receive your daily actionables digest.</p>

            {notifSuccess && (
              <div className="bg-green-50 text-green-700 text-sm px-4 py-3 rounded-lg mb-4 border border-green-200">{notifSuccess}</div>
            )}

            <div className="space-y-4 max-w-lg">
              <div className="p-4 rounded-xl border border-navy-100 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium text-navy-900">SMS Notifications</div>
                    <div className="text-xs text-navy-500">Get a text with your daily actionables</div>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input type="checkbox" checked={notifSettings.sms_enabled}
                      onChange={e => setNotifSettings(s => ({ ...s, sms_enabled: e.target.checked }))} className="sr-only peer" />
                    <div className="w-11 h-6 bg-navy-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-brand-500"></div>
                  </label>
                </div>
                {notifSettings.sms_enabled && (
                  <input type="tel" placeholder="Phone number (e.g. +16135551234)" value={notifSettings.phone || ''}
                    onChange={e => setNotifSettings(s => ({ ...s, phone: e.target.value }))} className="input-field" />
                )}
              </div>

              <div className="p-4 rounded-xl border border-navy-100 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium text-navy-900">Email Notifications</div>
                    <div className="text-xs text-navy-500">Receive a morning email digest</div>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input type="checkbox" checked={notifSettings.email_enabled}
                      onChange={e => setNotifSettings(s => ({ ...s, email_enabled: e.target.checked }))} className="sr-only peer" />
                    <div className="w-11 h-6 bg-navy-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-brand-500"></div>
                  </label>
                </div>
                {notifSettings.email_enabled && (
                  <input type="email" placeholder="Notification email" value={notifSettings.notification_email || ''}
                    onChange={e => setNotifSettings(s => ({ ...s, notification_email: e.target.value }))} className="input-field" />
                )}
              </div>

              <div className="p-4 rounded-xl border border-navy-100">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium text-navy-900">Digest Time</div>
                    <div className="text-xs text-navy-500">When to send your daily digest (weekdays)</div>
                  </div>
                  <input type="time" value={notifSettings.daily_digest_time || '07:30'}
                    onChange={e => setNotifSettings(s => ({ ...s, daily_digest_time: e.target.value }))} className="input-field w-auto" />
                </div>
              </div>

              <button onClick={saveNotificationSettings} disabled={notifSaving} className="btn-primary w-full">
                {notifSaving ? 'Saving...' : 'Save Notification Settings'}
              </button>
            </div>
          </div>

          <div className="card">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-4 gap-2">
              <div>
                <h2 className="font-bold text-navy-900">Digest Preview</h2>
                <p className="text-xs text-navy-500">See what your next daily digest would contain</p>
              </div>
              <div className="flex gap-2">
                <button onClick={loadDigestPreview} disabled={loadingPreview} className="btn-secondary text-sm">
                  {loadingPreview ? 'Loading...' : 'Preview My Digest'}
                </button>
                {isAdmin && (
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

      {/* ═══ DATA TAB (admin only) ═══ */}
      {activeTab === 'data' && isAdmin && (
        <div className="space-y-6">

          {/* Google Drive Auto-Import */}
          <div className="card">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-4 gap-2">
              <div>
                <h2 className="font-bold text-navy-900">Google Drive Auto-Import</h2>
                <p className="text-xs text-navy-500 mt-0.5">
                  Automatically imports AccountEdge CSV files from your shared Google Drive folder.
                </p>
              </div>
              {gdriveStatus?.configured && (
                <button
                  onClick={runImportNow}
                  disabled={importRunning}
                  className="btn-primary text-sm whitespace-nowrap"
                >
                  {importRunning ? 'Importing...' : 'Run Import Now'}
                </button>
              )}
            </div>

            {importResult && (
              <div className={`text-sm px-4 py-3 rounded-lg mb-4 border ${
                importResult.startsWith('Error') || importResult.startsWith('Import failed')
                  ? 'bg-red-50 text-red-700 border-red-200'
                  : 'bg-green-50 text-green-700 border-green-200'
              }`}>
                {importResult}
              </div>
            )}

            {gdriveStatus === null ? (
              <div className="text-sm text-navy-400">Loading status...</div>
            ) : !gdriveStatus.configured ? (
              <div className="p-4 rounded-xl bg-amber-50 border border-amber-200">
                <p className="text-amber-800 font-medium mb-2">Not configured yet</p>
                <p className="text-sm text-amber-700 mb-3">
                  To enable automatic imports, you need to set up a Google Cloud service account and add these environment variables to Render:
                </p>
                <div className="space-y-1 text-xs font-mono bg-amber-100 rounded-lg p-3 text-amber-900">
                  <div>GOOGLE_SERVICE_ACCOUNT_JSON={"{"} ... {"}"}</div>
                  <div>GDRIVE_FOLDER_ID=your_folder_id_here</div>
                  <div>GDRIVE_IMPORT_CRON=0 10 * * 1-5 <span className="text-amber-600 font-sans">(optional, default: 10AM weekdays)</span></div>
                </div>
                <p className="text-xs text-amber-600 mt-3">See the setup guide in the project README for step-by-step instructions.</p>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="p-3 rounded-xl bg-green-50 border border-green-200">
                    <div className="text-xs text-green-600 font-medium">Status</div>
                    <div className="text-sm font-bold text-green-800 mt-0.5">Connected</div>
                  </div>
                  <div className="p-3 rounded-xl bg-navy-50 border border-navy-200">
                    <div className="text-xs text-navy-500 font-medium">Schedule</div>
                    <div className="text-sm font-bold text-navy-800 mt-0.5">{gdriveStatus.cronSchedule || '10AM weekdays'}</div>
                  </div>
                  <div className="p-3 rounded-xl bg-navy-50 border border-navy-200">
                    <div className="text-xs text-navy-500 font-medium">Last Run</div>
                    <div className="text-sm font-bold text-navy-800 mt-0.5">
                      {gdriveStatus.lastRun
                        ? new Date(gdriveStatus.lastRun.created_at).toLocaleString()
                        : 'Never'}
                    </div>
                  </div>
                </div>

                {gdriveStatus.lastRun && (
                  <div className="text-xs text-navy-500">
                    Last result: {gdriveStatus.lastRun.status === 'success'
                      ? `${gdriveStatus.lastRun.records_imported} records from ${gdriveStatus.lastRun.files_processed} file(s)`
                      : `Error: ${gdriveStatus.lastRun.error_message}`}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Import History */}
          {importHistory.length > 0 && (
            <div className="card">
              <h2 className="font-bold text-navy-900 mb-3">Import History</h2>
              <div className="space-y-2">
                {importHistory.slice(0, 10).map(entry => (
                  <div key={entry.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 py-2 border-b border-navy-50 last:border-0">
                    <div className="flex items-center gap-2">
                      <span className={`inline-block w-2 h-2 rounded-full ${
                        entry.status === 'success' ? 'bg-green-500' : entry.status === 'running' ? 'bg-amber-500 animate-pulse' : 'bg-red-500'
                      }`} />
                      <span className="text-sm text-navy-800">
                        {entry.status === 'success'
                          ? `${entry.records_imported} records from ${entry.files_processed} file(s)`
                          : entry.status === 'running'
                            ? 'Running...'
                            : entry.error_message || 'Failed'}
                      </span>
                      {entry.unmatched_count > 0 && (
                        <span className="text-xs text-amber-600">({entry.unmatched_count} unmatched)</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-navy-400">
                      <span className={`px-1.5 py-0.5 rounded ${entry.triggered_by === 'manual' ? 'bg-brand-50 text-brand-600' : 'bg-navy-50 text-navy-500'}`}>
                        {entry.triggered_by || 'cron'}
                      </span>
                      <span>{new Date(entry.created_at).toLocaleString()}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="card">
            <h2 className="font-bold text-navy-900 mb-2">Sales Data Management</h2>
            <p className="text-sm text-navy-500 mb-6">
              Clear imported sales data so you can re-import with the correct settings. This removes all sales records but does not affect accounts, notes, or activities.
            </p>

            {dataMessage && (
              <div className="bg-green-50 text-green-700 text-sm px-4 py-3 rounded-lg mb-4 border border-green-200">{dataMessage}</div>
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
                <div className="flex flex-col sm:flex-row gap-3">
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

      {/* ═══ AUDIT TAB ═══ */}
      {activeTab === 'audit' && (
        <div className="card">
          <h2 className="font-bold text-navy-900 mb-4">Audit Log</h2>
          <p className="text-navy-500 text-sm">All changes to accounts, notes, sales, and user management are logged for security.</p>
          <p className="text-navy-400 text-sm mt-2">Audit viewer coming in next release.</p>
        </div>
      )}
    </div>
  );
}
