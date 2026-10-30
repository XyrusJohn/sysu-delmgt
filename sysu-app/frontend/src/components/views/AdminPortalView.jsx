import React, { useState } from "react";
import { useUsers } from "../../hooks/useUsers";

/**
 * UserRow Component
 * Individual row for the administrative user table.
 */
const UserRow = ({ user, onEdit, onDelete }) => {
  const roleLabels = {
    super_admin: "Super Admin",
    admin: "Admin",
    dispatcher: "Dispatcher",
    viewer: "Viewer",
    qr_generator: "QR Generator",
    driver: "Driver",
  };

  return (
    <tr className="hover:bg-db-item-hover transition-colors border-b border-db-border/50">
      <td className="px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-db-bg border border-db-border flex items-center justify-center text-xs font-bold text-db-text3">
            {(user.displayName || user.username || "?")[0].toUpperCase()}
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-bold text-db-text truncate max-w-[200px]">
              {user.displayName || user.name || user.username || "Unknown User"}
            </span>
            <span className="text-[10px] text-db-text3 font-mono">
              {user.username || user.id}
            </span>
          </div>
        </div>
      </td>
      <td className="px-6 py-4">
        <span
          className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${
            user.role === "super_admin"
              ? "bg-purple-500/10 text-purple-400 border-purple-500/30"
              : user.role === "admin"
                ? "bg-blue-500/10 text-blue-400 border-blue-500/30"
                : "bg-db-panel text-db-text3 border-db-border"
          }`}
        >
          {roleLabels[user.role] || user.role || "Viewer"}
        </span>
      </td>
      <td className="px-6 py-4 text-right">
        <div className="flex justify-end gap-2">
          <button
            onClick={() => onEdit(user)}
            className="px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-db-text2 hover:text-sysu-red border border-db-border hover:border-sysu-red/40 rounded-lg transition-all bg-db-bg"
          >
            Edit
          </button>
          <button
            onClick={() => onDelete(user.id)}
            className="px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-db-text3 hover:text-red-500 border border-db-border hover:border-red-500/40 rounded-lg transition-all bg-db-bg"
          >
            Delete
          </button>
        </div>
      </td>
    </tr>
  );
};

/**
 * AdminPortalView Component
 * The central hub for managing system users and their permissions.
 */
const AdminPortalView = () => {
  const { users, loading, error } = useUsers();
  const [searchQuery, setSearchQuery] = useState("");

  const filteredUsers = users.filter((u) => {
    const search = searchQuery.toLowerCase();
    return (
      (u.displayName || "").toLowerCase().includes(search) ||
      (u.username || "").toLowerCase().includes(search) ||
      (u.role || "").toLowerCase().includes(search)
    );
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-db-text3 italic">
        Loading user records...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full text-sysu-red italic">
        Error: {error}
      </div>
    );
  }

  return (
    <div className="p-6 h-full flex flex-col">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-db-text font-display">
            User Management
          </h1>
          <p className="text-xs text-db-text3 mt-1">
            Control system access and administrative roles
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-db-text3 pointer-events-none"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              placeholder="Search users..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-64 h-10 bg-db-bg border border-db-border hover:border-sysu-gold/40 focus:border-sysu-red rounded-xl pl-9 pr-4 text-sm text-db-text outline-none transition-all"
            />
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-hidden bg-db-panel/30 border border-db-border rounded-2xl backdrop-blur-sm">
        <table className="w-full border-collapse text-left">
          <thead className="sticky top-0 z-10 bg-db-panel text-db-text3 text-[10px] font-black uppercase tracking-widest border-b border-db-border">
            <tr>
              <th className="px-6 py-3">User Profile</th>
              <th className="px-6 py-3">Role</th>
              <th className="px-6 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-db-border/50">
            {filteredUsers.length > 0 ? (
              filteredUsers.map((user) => (
                <UserRow
                  key={user.id}
                  user={user}
                  onEdit={undefined}
                  onDelete={undefined}
                />
              ))
            ) : (
              <tr>
                <td
                  colSpan="3"
                  className="px-6 py-12 text-center text-db-text3 italic"
                >
                  No users found matching your search.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default AdminPortalView;
